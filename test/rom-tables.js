// The tables recorded from BBC BASIC II by tools/rom-oracle/record.mjs, and how a line's invalid tokens are judged
// against them.
import {BasicIIDialect} from "../src/parser/dialect";
import {highlightLine, programProblems, readLines} from "../src/parser/highlight";
import {lexLine, romBytes} from "../src/parser/lexer";
import {isUnread, unreadRanges} from "../tools/rom-oracle/unread.mjs";
import {readRows} from "../tools/rom-oracle/tables.mjs";

export const RomVerdicts = readRows("verdicts");
export const MasterVerdicts = readRows("verdicts-master");
export const RomTokens = readRows("tokens");
export const MasterTokens = readRows("tokens-master");

// The recorded rows where the editor's Model B is lenient on purpose (the README): it reads a COLOR that starts a
// statement as COLOUR where that is all it can be, as the Master does and BASIC II's ROM does not.
export const LenientThanRom = [
    "COLOR 1",
    "COLOR1",
    "COLOR.",
    "COLOR 1:COLOR.",
    "COLOR 1:ED.",
    "COLOR7",
    "COLOR X",
    "COLORS",
    "COLOR 7:COLOR 1",
    "IFC%COLORC%ELSECOLORD%:NEXT",
    "X=1:REP.COLORX:P.;X:X=X+1:U.X>7",
    "ONERRORCOLOR7:GOTO1000",
    "LETCOLOR=3:COLORCOLOR",
];

export const verdicts = new Map(RomVerdicts.map(([text, verdict]) => [text, verdict]));
export const masterVerdicts = new Map(MasterVerdicts.map(([text, verdict]) => [text, verdict]));

// The invalid spans, as [start, end], that the ROM says are wrong to show as invalid: it ran the line without error
// and read them. Our lexer's bytes are the ROM's tokenisation (test/rom/tokens checks that). The recorded rows are
// the ROM's, so they are read by the ROM's own dialect: the editor's can be more lenient (the README says where).
export function falseInvalid(text, invalid, table = verdicts, dialect = BasicIIDialect) {
    if (table.get(text) !== "ok") return [];
    const ranges = unreadRanges(text, romBytes(lexLine(text, dialect)));
    return invalid.filter(([start, end]) => !isUnread(ranges, start, end));
}

// The spans of the line, as [start, end], that are marked invalid.
export const invalidSpans = (text, dialect = BasicIIDialect) => {
    const {tokens} = highlightLine(text, false, dialect);
    return tokens.flatMap((token, i) =>
        token.type.startsWith("invalid")
            ? [[token.offset, i + 1 < tokens.length ? tokens[i + 1].offset : text.length]]
            : [],
    );
};

// The rows of a recorded table where the recogniser is wrong: a line the ROM runs has red the ROM read that is not on
// purpose (`stricter` lists the lines where it is), or a line it stops at has none (`gaps` lists the lines the
// recogniser misses, and `lenient` those it accepts on purpose, which must have none). A line that only ends too soon is not marked, which is what lets it be typed.
export function wrongRows(
    rows,
    {stricter = [], gaps = [], lenient = [], dialect = BasicIIDialect} = {},
) {
    const table = new Map(rows.map(([text, verdict]) => [text, verdict]));
    return rows.flatMap(([text, verdict]) => {
        const marked = invalidSpans(text, dialect);
        const problems = programProblems(text, readLines(text, dialect));
        if (verdict === "ok") {
            // Text BASIC skips can be unfinished, as it can be wrong (see the README).
            const unfinished = problems.filter(problem => problem.unfinished);
            const ends = unfinished.map(({start, end}) => [start, end]);
            // What is red on purpose says so, with a message.
            const onPurpose = problems.filter(problem => problem.stricter);
            const unexplained = marked.filter(
                ([start, end]) => !onPurpose.some(p => p.start <= start && end <= p.end),
            );
            return falseInvalid(text, marked, table, dialect).length > 0 ===
                stricter.includes(text) &&
                falseInvalid(text, unexplained, table, dialect).length === 0 &&
                falseInvalid(text, ends, table, dialect).length === 0
                ? []
                : [[text, verdict]];
        }
        const unfinished = problems.length > 0 && problems.every(problem => problem.unfinished);
        const stops = marked.length > 0 || unfinished;
        if (lenient.includes(text)) return stops ? [[text, verdict]] : [];
        return stops || gaps.includes(text) ? [] : [[text, verdict]];
    });
}

// The rows where the recogniser words the error differently from the ROM, with both; it may give none.
export function wrongMessages(rows, otherWording = [], dialect = BasicIIDialect) {
    return rows.flatMap(([text, verdict]) => {
        const {message} =
            programProblems(text, readLines(text, dialect)).find(problem => !problem.stricter) ||
            {};
        return verdict === "ok" || !message || message === verdict || otherWording.includes(text)
            ? []
            : [[text, verdict, message]];
    });
}
