// Evaluates the BASIC numeric expressions the memory tools take as addresses, such as `D%`, `P%-1` or `PAGE+&10`.

export class ExpressionError extends Error {}

const Tokens =
    /\s*(?:(&[0-9A-Fa-f]+|\$[0-9A-Fa-f]+|\d+\.?\d*(?:E[+-]?\d+)?|\.\d+)|([A-Za-z_`][\w`]*[%$]?)|(.))/gy;

// Lowest binding first, as BASIC has them.
const BinaryLevels = [["OR", "EOR"], ["AND"], ["+", "-"], ["*", "/", "DIV", "MOD"]];

const toInteger = value => Math.trunc(value);

function operate(operator, left, right) {
    switch (operator) {
        case "OR":
            return left | right;
        case "EOR":
            return left ^ right;
        case "AND":
            return left & right;
        case "+":
            return left + right;
        case "-":
            return left - right;
        case "*":
            return left * right;
        default:
            if (right === 0) throw new ExpressionError("Division by zero");
            if (operator === "/") return left / right;
            return operator === "DIV" ? toInteger(left / right) : left % right;
    }
}

function tokenise(text) {
    const tokens = [];
    Tokens.lastIndex = 0;
    while (Tokens.lastIndex < text.length) {
        const start = Tokens.lastIndex;
        const match = Tokens.exec(text);
        if (!match) break;
        const [, number, name, other] = match;
        if (number !== undefined) {
            const hex = number[0] === "&" || number[0] === "$";
            tokens.push({
                kind: "number",
                text: number,
                value: hex ? parseInt(number.slice(1), 16) : Number(number),
            });
        } else if (name !== undefined) {
            tokens.push({
                kind: BinaryLevels.flat().includes(name) ? "operator" : "name",
                text: name,
            });
        } else if (other.trim() !== "") {
            tokens.push({kind: "operator", text: other});
        } else if (Tokens.lastIndex === start) break;
    }
    return tokens;
}

/**
 * The value of `text`, an expression of numbers (`123`, `&1F00`, `$1F00`), names, the operators `+ - * / DIV MOD AND
 * OR EOR`, brackets, and BASIC's indirection: `?A` is the byte at A, `!A` the word, and `A?3` and `A!4` those at A+3
 * and A+4. `names(name)` gives a name's number, or undefined where there is no such variable; `peek(address)` a byte.
 */
export function evaluate(text, {names, peek}) {
    const tokens = tokenise(text);
    let at = 0;
    const next = () => tokens[at];
    const isOperator = (...texts) => next()?.kind === "operator" && texts.includes(next().text);

    const word = address =>
        peek(address) |
        (peek(address + 1) << 8) |
        (peek(address + 2) << 16) |
        (peek(address + 3) << 24);

    function primary() {
        const token = tokens[at++];
        if (!token) throw new ExpressionError("Missing number");
        if (token.kind === "number") return token.value;
        if (token.kind === "name") {
            if (token.text.endsWith("$"))
                throw new ExpressionError(`Type mismatch: ${token.text} is text`);
            const value = names(token.text);
            if (value === undefined) throw new ExpressionError(`No such variable: ${token.text}`);
            return value;
        }
        if (token.text === "(") {
            const value = binary(0);
            if (!isOperator(")")) throw new ExpressionError("Missing )");
            ++at;
            return value;
        }
        if (token.text === "-") return -indirected();
        if (token.text === "+") return indirected();
        if (token.text === "?") return peek(toInteger(indirected()) & 0xffff);
        if (token.text === "!") return word(toInteger(indirected()) & 0xffff);
        throw new ExpressionError(`Syntax error at "${token.text}"`);
    }

    function indirected() {
        let value = primary();
        while (isOperator("?", "!")) {
            const bytes = tokens[at++].text === "?" ? 1 : 4;
            const address = (toInteger(value) + toInteger(primary())) & 0xffff;
            value = bytes === 1 ? peek(address) : word(address);
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
    return toInteger(value);
}
