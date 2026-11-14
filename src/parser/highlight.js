// The recogniser's tokens as Monaco token types, the same names the Monarch grammar in bbcbasic.js uses, so that
// everything that reads tokens works with either.
import {BracketCollisions} from "./lexer.js";
import {Recogniser} from "./recogniser.js";

const Operators = new Set("+ - * / ^ = <> < > <= >= $ ? ; , ! '".split(" "));
const PunctTypes = {
    "(": "delimiter.parenthesis",
    ")": "delimiter.parenthesis",
    "[": "delimiter.square",
    "]": "delimiter.square",
};
// What a part is to bracket matching: a "(" however it is spelt, a ")", or the "[" or "]" of an assembler block,
// which is the only pair that spans lines.
const Open = 1;
const Close = 2;
const Block = 3;
const PunctBrackets = {"(": Open, ")": Close, "[": Block, "]": Block};
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
    for (DataPart.lastIndex = 0; DataPart.lastIndex < text.length;) {
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
            // The ( of MID$( is the bracket its ) closes, so only the keyword before it is coloured as one (#170). The
            // . of an abbreviation (LE.) is one too, but still coloured as part of the keyword.
            if (!token.kw.keyword.endsWith("(")) return [[start, "keyword"]];
            return text.length > 1
                ? [
                      [start, "keyword"],
                      [
                          token.end - 1,
                          text.endsWith("(") ? "delimiter.parenthesis" : "keyword",
                          Open,
                      ],
                  ]
                : [[start, "keyword", Open]];
        case "name":
        case "fnname":
            return [[start, "variable"]];
        case "number":
            return [[start, /^\d+$/.test(text) ? "number" : "number.float"]];
        case "hex":
            return [[start, "number.hex"]];
        case "string":
            return stringParts(start, text);
        case "comment":
            return [[start, "comment"]];
        case "oscli":
            return [[start, "keyword.oscli.string"]];
        case "data":
            return dataParts(start, text);
        default:
            return [
                [
                    start,
                    PunctTypes[text] || (Operators.has(text) ? "operator" : "symbol"),
                    PunctBrackets[text],
                ],
            ];
    }
}

// The line's tokens as {offset, type, bracket}, and whether an assembler block is open at its end. `bracket` is set on
// a "(" and the ")" that closes it on the same line, where neither is invalid, and on a valid "[" or "]": those are
// the only text Monaco is to match brackets in. Neighbours of the same type and `bracket` are joined.
export function highlightLine(text, inAssembler = false) {
    const recogniser = new Recogniser(text, inAssembler);
    const open = recogniser.line();
    const tokens = [];
    const unclosed = [];
    for (const token of recogniser.tokens) {
        const collides = BracketCollisions.has(token.text);
        for (const [offset, tokenType, role] of parts(token)) {
            const type =
                collides && !tokenType.endsWith("string") ? `${tokenType}.string` : tokenType;
            const part = {offset, type, bracket: role === Block};
            if (role === Open) unclosed.push(part);
            else if (role === Close && unclosed.length)
                part.bracket = unclosed.pop().bracket = true;
            tokens.push(part);
        }
    }
    const joined = tokens.filter(
        (part, i) =>
            i === 0 || part.type !== tokens[i - 1].type || part.bracket !== tokens[i - 1].bracket,
    );
    return {tokens: joined, inAssembler: open};
}

// What each line's errors are, for editor markers: {line, start, end, message, unfinished, hole}. An unfinished line is
// shown at its last token and on to the end of the line, and one that something is missing from (a `hole`) at the token
// where it stops; `message` is the error BASIC would give, or null where the recogniser does not know it. A block
// that is never closed is one problem at its "[" ({unclosed: true}) in place of those of the lines after it, if it has any.
export function programProblems(text) {
    let inAssembler = false;
    let block = null;
    const problems = text.split(/\r?\n/).flatMap((lineText, i) => {
        const recogniser = new Recogniser(lineText, inAssembler);
        inAssembler = recogniser.line();
        if (recogniser.opener) block = {line: i + 1, token: recogniser.opener};
        const last = recogniser.tokens.findLast(token => token.kind !== "white");
        return recogniser.problems.map(({message, token, end, unfinished, hole}) => ({
            line: i + 1,
            start: unfinished && !hole ? last.start : token.start,
            end: unfinished && !hole ? lineText.length : end,
            message,
            unfinished,
            hole,
        }));
    });
    if (!inAssembler || !block) return problems;
    const {line, token} = block;
    const before = problems.filter(problem => problem.line <= line);
    if (before.length === problems.length) return problems;
    return [
        ...before,
        {
            line,
            start: token.start,
            end: token.end,
            message: null,
            unfinished: false,
            hole: false,
            unclosed: true,
        },
    ];
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

// `metadata(scopes, bracket)` is Monaco's encoding of a token: the theme's colours for the scopes, and whether Monaco
// looks for brackets in its text.
export function tokensProvider(languageId, metadata) {
    return {
        getInitialState: () => States[0],
        // What editor.tokenize() returns, with neighbours of the same type joined as the Monarch grammar joins them.
        tokenize(line, state) {
            const {tokens, inAssembler} = highlightLine(line, state.inAssembler);
            return {
                tokens: tokens
                    .filter(({type}, i) => i === 0 || type !== tokens[i - 1].type)
                    .map(({offset, type}) => ({
                        startIndex: offset,
                        scopes: `${type}.${languageId}`,
                    })),
                endState: States[Number(inAssembler)],
            };
        },
        // What the editor shows.
        tokenizeEncoded(line, state) {
            const {tokens, inAssembler} = highlightLine(line, state.inAssembler);
            return {
                tokens: Uint32Array.from(
                    tokens.flatMap(({offset, type, bracket}) => [
                        offset,
                        metadata(`${type}.${languageId}`, bracket),
                    ]),
                ),
                endState: States[Number(inAssembler)],
            };
        },
    };
}
