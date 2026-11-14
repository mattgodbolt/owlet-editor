// The tables recorded from BBC BASIC II by tools/rom-oracle/record.mjs, and how a line's invalid tokens are judged
// against them.
import {lexLine, romBytes} from "../src/parser/lexer";
import {isUnread, unreadRanges} from "../tools/rom-oracle/unread.mjs";
import RomVerdicts from "./rom-verdicts.json";

export const verdicts = new Map(RomVerdicts.map(([text, verdict]) => [text, verdict]));

// The invalid spans, as [start, end], that the ROM says are wrong to show as invalid: it ran the line without error
// and read them. Our lexer's bytes are the ROM's tokenisation (test/rom-tokens.json checks that).
export function falseInvalid(text, invalid) {
    if (verdicts.get(text) !== "ok") return [];
    const ranges = unreadRanges(text, romBytes(lexLine(text)));
    return invalid.filter(([start, end]) => !isUnread(ranges, start, end));
}
