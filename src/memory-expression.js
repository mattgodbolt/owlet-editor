// Evaluates the BASIC numeric expressions the memory tools take as addresses, such as `D%`, `P%-1` or `PAGE+&10`.

export class ExpressionError extends Error {}

const Tokens =
    /\s*(?:(0[xX][0-9A-Fa-f]+|&[0-9A-Fa-f]+|\$[0-9A-Fa-f]+(?![\w`%$])|\d+\.?\d*(?:E[+-]?\d+)?|\.\d+(?:E[+-]?\d+)?)|([A-Za-z_`][\w`]*[%$]?|@%)|(\S))/y;

// Lowest binding first, as BASIC has them.
const BinaryLevels = [["OR", "EOR"], ["AND"], ["+", "-"], ["*", "/", "DIV", "MOD"]];
const Keywords = new Set(BinaryLevels.flat());
const AddressMask = 0xffff;

const toInteger = value => Math.trunc(value) | 0;

function parseNumber(text) {
    if (/^0[xX]/.test(text)) return parseInt(text.slice(2), 16) | 0;
    if (text[0] === "&" || text[0] === "$") return parseInt(text.slice(1), 16) | 0;
    return Number(text);
}

function operate(operator, left, right) {
    switch (operator) {
        case "OR":
            return toInteger(left) | toInteger(right);
        case "EOR":
            return toInteger(left) ^ toInteger(right);
        case "AND":
            return toInteger(left) & toInteger(right);
        case "+":
            return left + right;
        case "-":
            return left - right;
        case "*":
            return left * right;
        case "/":
            if (right === 0) throw new ExpressionError("Division by zero");
            return left / right;
        default: {
            const divisor = toInteger(right);
            if (divisor === 0) throw new ExpressionError("Division by zero");
            const dividend = toInteger(left);
            return operator === "DIV" ? toInteger(dividend / divisor) : dividend % divisor;
        }
    }
}

function tokenise(text) {
    const tokens = [];
    Tokens.lastIndex = 0;
    for (let match = Tokens.exec(text); match; match = Tokens.exec(text)) {
        const [, number, name, other] = match;
        if (number !== undefined)
            tokens.push({kind: "number", text: number, value: parseNumber(number)});
        else if (name !== undefined)
            tokens.push({kind: Keywords.has(name) ? "operator" : "name", text: name});
        else tokens.push({kind: "operator", text: other});
    }
    return tokens;
}

/**
 * The value of `text` as BBC BASIC would work it out, truncated to an integer. It takes numbers (`123`, `&1F00`, and
 * as hex also `$1F00` and `0x1F00`), names, the operators `+ - * / DIV MOD AND OR EOR` at BASIC's precedences,
 * brackets, unary minus, and BASIC's indirection: `?A` is the byte at A, `!A` the four-byte word, and `A?3` and `A!4`
 * those at A+3 and A+4. `names(name)` gives a name's number, or undefined where there is no such variable;
 * `peek(address)` a byte of memory. Throws an ExpressionError, with a message like BASIC's, where BASIC would stop.
 */
export function evaluate(text, {names, peek}) {
    const tokens = tokenise(text);
    let at = 0;
    const isOperator = (...texts) =>
        tokens[at]?.kind === "operator" && texts.includes(tokens[at].text);

    const byte = address => peek(toInteger(address) & AddressMask);
    const word = address =>
        byte(address) |
        (byte(address + 1) << 8) |
        (byte(address + 2) << 16) |
        (byte(address + 3) << 24);

    function primary() {
        const token = tokens[at++];
        if (!token) throw new ExpressionError("Missing number");
        if (token.kind === "number") return token.value;
        if (token.kind === "name") {
            if (token.text.endsWith("$"))
                throw new ExpressionError(`Type mismatch: ${token.text} is a string`);
            const value = names(token.text);
            if (value === undefined) throw new ExpressionError(`No such variable: ${token.text}`);
            return value;
        }
        switch (token.text) {
            case "(": {
                const value = binary(0);
                if (!isOperator(")")) throw new ExpressionError("Missing )");
                ++at;
                return value;
            }
            case "-":
                return -indirected();
            case "+":
                return indirected();
            case "?":
                return byte(indirected());
            case "!":
                return word(indirected());
            default:
                throw new ExpressionError(`Syntax error at "${token.text}"`);
        }
    }

    function indirected() {
        let value = primary();
        while (isOperator("?", "!")) {
            const read = tokens[at++].text === "?" ? byte : word;
            value = read(toInteger(value) + toInteger(primary()));
        }
        return value;
    }

    function binary(level) {
        if (level === BinaryLevels.length) return indirected();
        let left = binary(level + 1);
        while (isOperator(...BinaryLevels[level])) {
            const operator = tokens[at++].text;
            left = operate(operator, left, binary(level + 1));
        }
        return left;
    }

    const value = binary(0);
    if (at < tokens.length) throw new ExpressionError(`Syntax error at "${tokens[at].text}"`);
    return Math.trunc(value);
}
