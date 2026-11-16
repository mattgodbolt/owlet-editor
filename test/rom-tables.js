// The tables recorded from BBC BASIC II by tools/rom-oracle/record.mjs, and how a line's invalid tokens are judged
// against them.
import {highlightLine, programProblems} from "../src/parser/highlight";
import {lexLine, romBytes} from "../src/parser/lexer";
import {isUnread, unreadRanges} from "../tools/rom-oracle/unread.mjs";
import MasterVerdicts from "./rom-verdicts-master.json";
import RomVerdicts from "./rom-verdicts.json";

export const verdicts = new Map(RomVerdicts.map(([text, verdict]) => [text, verdict]));
export const masterVerdicts = new Map(MasterVerdicts.map(([text, verdict]) => [text, verdict]));

// The invalid spans, as [start, end], that the ROM says are wrong to show as invalid: it ran the line without error
// and read them. Our lexer's bytes are the ROM's tokenisation (test/rom-tokens.json checks that).
export function falseInvalid(text, invalid, table = verdicts) {
    if (table.get(text) !== "ok") return [];
    const ranges = unreadRanges(text, romBytes(lexLine(text)));
    return invalid.filter(([start, end]) => !isUnread(ranges, start, end));
}

// The spans of the line, as [start, end], that are marked invalid.
export const invalidSpans = text => {
    const {tokens} = highlightLine(text);
    return tokens.flatMap((token, i) =>
        token.type.startsWith("invalid")
            ? [[token.offset, i + 1 < tokens.length ? tokens[i + 1].offset : text.length]]
            : [],
    );
};

// The rows of a recorded table where the recogniser is wrong: a line the ROM runs has red the ROM read that is not on
// purpose (`stricter` lists the lines where it is), or a line it stops at has none (`gaps` lists the lines the
// recogniser misses). A line that only ends too soon is not marked, which is what lets it be typed.
export function wrongRows(rows, {stricter = [], gaps = []} = {}) {
    const table = new Map(rows.map(([text, verdict]) => [text, verdict]));
    return rows.flatMap(([text, verdict]) => {
        const marked = invalidSpans(text);
        const problems = programProblems(text);
        if (verdict === "ok") {
            // Text BASIC skips can be unfinished, as it can be wrong (see the README).
            const unfinished = problems.filter(problem => problem.unfinished);
            const ends = unfinished.map(({start, end}) => [start, end]);
            // What is red on purpose says so, with a message.
            const onPurpose = problems.filter(problem => problem.stricter);
            const unexplained = marked.filter(
                ([start, end]) => !onPurpose.some(p => p.start <= start && end <= p.end),
            );
            return falseInvalid(text, marked, table).length > 0 === stricter.includes(text) &&
                falseInvalid(text, unexplained, table).length === 0 &&
                falseInvalid(text, ends, table).length === 0
                ? []
                : [[text, verdict]];
        }
        const unfinished = problems.length > 0 && problems.every(problem => problem.unfinished);
        return marked.length || unfinished || gaps.includes(text) ? [] : [[text, verdict]];
    });
}

// The rows where the recogniser words the error differently from the ROM, with both; it may give none.
export function wrongMessages(rows, otherWording = []) {
    return rows.flatMap(([text, verdict]) => {
        const {message} = programProblems(text).find(problem => !problem.stricter) || {};
        return verdict === "ok" || !message || message === verdict || otherWording.includes(text)
            ? []
            : [[text, verdict, message]];
    });
}
