// Where each statement of the program is in the editor, by the line number and the offset into the line's tokenised
// bytes that BASIC reads it at, so that the statement BASIC is running can be found in the text.
import {Recogniser} from "./parser/recogniser";
import {romBytes} from "./parser/lexer";
import {tokeniseLines} from "./parser/highlight";
import {ImplicitLineNumberStep} from "./tokeniser";

// How the tokenisers split a line, once its leading spaces are trimmed, into its own number and the text they tokenise.
const OwnNumber = /^([0-9]+)?(.*)/;
const LineNumberBits = 0xffff;

// Notes where the recogniser starts each statement, nested ones included: after THEN, REPEAT, a DEF's name and an
// assembler block's "]".
class StatementStarts extends Recogniser {
    constructor(text, inAssembler, dialect) {
        super(text, inAssembler, dialect);
        this.starts = new Set();
    }

    statement() {
        if (!this.atEnd()) this.starts.add(this.peek().start);
        super.statement();
    }
}

// The offset into the tokenised line of each position in the text: a keyword or line number is fewer bytes than it
// has characters, and anything else is a byte for each.
function byteOffsets(tokens) {
    const offsets = [];
    let offset = 0;
    for (const token of tokens) {
        const length = romBytes([token]).length;
        const oneForOne = length === token.end - token.start;
        for (let at = token.start; at < token.end; ++at)
            offsets[at] = offset + (oneForOne ? at - token.start : 0);
        offset += length;
    }
    return offsets;
}

const isFiller = token => token.kind === "white" || (token.kind === "punct" && token.text === ":");

/**
 * The statements of one line's text (after its number), each as {offset, start, end}: where BASIC reads it in the
 * tokenised line, and the span of text it covers, without the spaces and colon after it. An ELSE is a statement of its
 * own, as BASIC runs one it comes to (by skipping the rest of the line), and so is the start of a line in an
 * assembler block, up to any statement after its "]".
 */
function lineStatements(recogniser, lexed) {
    const offsets = byteOffsets(lexed);
    const {tokens} = recogniser;
    const elses = tokens.filter(token => token.kind === "keyword" && token.kw.keyword === "ELSE");
    const first = tokens.find(token => !isFiller(token));
    if (!first) return [];
    const found = new Set([first.start, ...recogniser.starts, ...elses.map(token => token.start)]);
    const starts = [...found].filter(start => start in offsets).sort((a, b) => a - b);
    return starts.map((start, i) => {
        const next = i + 1 < starts.length ? starts[i + 1] : Infinity;
        const covered = tokens.filter(token => token.start >= start && token.start < next);
        const last = covered.findLast(token => !isFiller(token));
        return {offset: offsets[start], start, end: last ? last.end : start};
    });
}

/**
 * Each line of the program as the tokeniser puts it in memory, by its line number, which more than one line can have:
 * {editorLine, bytes, statements}, where a statement's columns are the editor's.
 * @param {string[]} lines the editor's lines
 * @returns {Map<number, {editorLine: number, bytes: number[], statements: {offset: number, startColumn: number,
 * endColumn: number}[]}[]>}
 */
export function programStatements(lines, dialect) {
    const trimmed = lines.map(line => line.trimStart());
    const split = trimmed.map(line => line.match(OwnNumber));
    const texts = split.map(([, , text]) => text);
    const lexed = tokeniseLines(texts, dialect);
    const byNumber = new Map();
    let inAssembler = false;
    texts.forEach((text, i) => {
        const recogniser = new StatementStarts(text, inAssembler, dialect);
        inAssembler = recogniser.line();
        if (!trimmed[i]) return;
        const [, ownNumber] = split[i];
        const number =
            (ownNumber ? parseInt(ownNumber) : ImplicitLineNumberStep * (i + 1)) & LineNumberBits;
        const column = lines[i].length - text.length + 1;
        const entry = {
            editorLine: i + 1,
            bytes: romBytes(lexed[i]),
            statements: lineStatements(recogniser, lexed[i]).map(({offset, start, end}) => ({
                offset,
                startColumn: column + start,
                endColumn: column + end,
            })),
        };
        byNumber.set(number, [...(byNumber.get(number) || []), entry]);
    });
    return byNumber;
}

const sameBytes = (a, b) => a.length === b.length && a.every((byte, i) => byte === b[i]);

/**
 * The editor's range of the statement BASIC reads at `offset` into line `number`, whose bytes in memory are `bytes`:
 * the last statement that starts at or before it. Null where no line of the editor tokenises to those bytes, as when
 * the line has been edited since the program was run.
 */
export function statementAt(program, {number, bytes, offset}) {
    const line = (program.get(number) || []).find(entry => sameBytes(entry.bytes, bytes));
    if (!line || line.statements.length === 0) return null;
    const statement = line.statements.findLast(s => s.offset <= offset) || line.statements[0];
    return {
        lineNumber: line.editorLine,
        startColumn: statement.startColumn,
        endColumn: statement.endColumn,
    };
}
