// The recogniser's tokens as Monaco token types, the same names the Monarch grammar in bbcbasic.js uses, so that
// everything that reads tokens works with either.
import {Recogniser} from "./recogniser.js";

const Operators = new Set("+ - * / ^ = <> < > <= >= $ ? ; , ! '".split(" "));
const PunctTypes = {
    "(": "delimiter.parenthesis",
    ")": "delimiter.parenthesis",
    "[": "delimiter.square",
    "]": "delimiter.square",
};
// White space, a comma, a string with no end, a string, or an item without quotes.
const DataPart = /([ \t\r]+)|(,)|("(?:[^"]|"")*$)|("[^"]*")|[^,]*[^, ]/y;

// [offset, type] for each part of a string: its quotes, and each "" in it, are string.quote.
function stringParts(offset, text) {
    const parts = [];
    for (const part of text.split(/(^"|""|"$)/)) {
        if (part) parts.push([offset, part[0] === '"' ? "string.quote" : "string"]);
        offset += part.length;
    }
    return parts;
}

function dataParts(offset, text) {
    const parts = [];
    for (DataPart.lastIndex = 0; DataPart.lastIndex < text.length; ) {
        const at = offset + DataPart.lastIndex;
        const [match, white, comma, unterminated, quoted] = DataPart.exec(text);
        if (white) parts.push([at, "white"]);
        else if (comma) parts.push([at, "symbol"]);
        else if (unterminated) parts.push([at, "string"]);
        else if (quoted) parts.push(...stringParts(at, match));
        else parts.push([at, "string.unquoted"]);
    }
    return parts;
}

function parts(token) {
    const {start, text} = token;
    if (token.invalid) return [[start, token.kind === "string" ? "invalid.string" : "invalid"]];
    if (token.type) return [[start, token.type]];
    switch (token.kind) {
        case "white":
            return [[start, "white"]];
        case "linenum":
            return [[start, "constant.linenum"]];
        case "keyword":
            // The ( of MID$( is the bracket its ) closes, so only the keyword before it is coloured as one (#170).
            return text.length > 1 && text.endsWith("(")
                ? [
                      [start, "keyword"],
                      [token.end - 1, "delimiter.parenthesis"],
                  ]
                : [[start, "keyword"]];
        case "name":
        case "fnname":
            return [[start, "variable"]];
        case "number":
            return [[start, /^\d+$/.test(text) ? "number" : "number.float"]];
        case "hex":
            return [[start, text.length > 1 ? "number.hex" : "invalid"]];
        case "string":
            return token.closed ? stringParts(start, text) : [[start, "invalid.string"]];
        case "comment":
            return [[start, "comment"]];
        case "oscli":
            return [[start, "keyword.oscli.string"]];
        case "data":
            return dataParts(start, text);
        default:
            return [[start, PunctTypes[text] || (Operators.has(text) ? "operator" : "symbol")]];
    }
}

// The line's tokens as {offset, type}, neighbours of the same type joined as the Monarch grammar joins them, and
// whether an assembler block is open at its end.
export function highlightLine(text, inAssembler = false) {
    const recogniser = new Recogniser(text, inAssembler);
    const open = recogniser.line();
    const tokens = [];
    for (const token of recogniser.tokens) {
        for (const [offset, type] of parts(token)) {
            if (tokens.length === 0 || tokens[tokens.length - 1].type !== type)
                tokens.push({offset, type});
        }
    }
    return {tokens, inAssembler: open};
}

// A Monaco tokens provider: the state between lines is whether an assembler block is open.
class State {
    constructor(inAssembler) {
        this.inAssembler = inAssembler;
    }

    clone() {
        return this;
    }

    equals(other) {
        return other.inAssembler === this.inAssembler;
    }
}

const States = [new State(false), new State(true)];

export function tokensProvider(languageId) {
    return {
        getInitialState: () => States[0],
        tokenize(line, state) {
            const {tokens, inAssembler} = highlightLine(line, state.inAssembler);
            return {
                tokens: tokens.map(({offset, type}) => ({
                    startIndex: offset,
                    scopes: `${type}.${languageId}`,
                })),
                endState: States[Number(inAssembler)],
            };
        },
    };
}
