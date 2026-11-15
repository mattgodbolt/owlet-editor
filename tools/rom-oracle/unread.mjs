// The parts of a statement that BASIC never reads when it runs it, found from BASIC II's own tokenisation of it
// (rom.tokenise), so that the oracle does not take a statement that runs without error as vouching for them. They
// are the rest of the line after REM, DATA, DEF, ELSE, ON ERROR and the first target of ON GOTO; the statements after
// GOTO, GOSUB, END, STOP and THEN followed by a line number (the prelude's GOSUB target is END); and the branch of an IF that is not taken. An IF is
// taken when its condition is 1, X or TRUE (all the generator writes), not when it is 0 or FALSE, and is otherwise
// unknown, so then neither branch counts as read.
import {keywords} from "../../src/tokens.js";

const Token = Object.fromEntries(keywords.map(kw => [kw.keyword, kw.token]));
const nameByToken = new Map(keywords.map(kw => [kw.token, kw.keyword]));
const LineNumberToken = 0x8d;
const FirstStatementToken = 0xc6;
const Quote = 0x22;
const Colon = 0x3a;
const Comma = 0x2c;
const RestOfLine = new Set([Token.REM, Token.DATA, Token.DEF]);
const EndsLine = new Set([Token.GOTO, Token.GOSUB, Token.END, Token.STOP]);
const True = ["1", "X", "TRUE"];
const False = ["0", "FALSE"];

// The offset in the text of each byte of its tokenisation, and of the end; null if they cannot be lined up.
function align(text, bytes) {
    const offsets = [];
    let pos = 0;
    let inString = false;
    for (let i = 0; i < bytes.length; ++i) {
        offsets.push(pos);
        const byte = bytes[i];
        if (byte === Quote) inString = !inString;
        if (inString || byte < 0x80 || text.charCodeAt(pos) >= 0x80) {
            if (byte < 0x80 && text.charCodeAt(pos) !== byte) return null;
            pos++;
        } else if (byte === LineNumberToken) {
            offsets.push(pos, pos, pos);
            i += 3;
            pos += text.slice(pos).match(/^\d*/)[0].length;
        } else {
            const name = nameByToken.get(byte);
            if (!name) return null;
            let length = text.startsWith(name, pos) ? name.length : 0;
            for (let n = 1; !length && n < name.length; ++n) {
                if (text[pos + n] === "." && name.startsWith(text.slice(pos, pos + n)))
                    length = n + 1;
            }
            if (!length) return null;
            pos += length;
        }
    }
    offsets.push(pos);
    return pos === text.length ? offsets : null;
}

// [start, end) ranges of the text that BASIC does not read, or null if the tokenisation does not line up.
export function unreadRanges(text, bytes) {
    const offsets = align(text, bytes);
    if (!offsets) return null;
    const ranges = [];
    const rest = i => ranges.push([offsets[i], text.length]);
    const isSpace = i => bytes[i] === 0x20;
    const skipSpaces = i => {
        while (isSpace(i)) ++i;
        return i;
    };
    // The index of the next byte at or after i that is outside a string and one of the given ones, or bytes.length.
    const find = (i, ...wanted) => {
        let inString = false;
        for (; i < bytes.length; ++i) {
            if (bytes[i] === LineNumberToken && !inString) i += 3;
            else if (bytes[i] === Quote) inString = !inString;
            else if (!inString && wanted.includes(bytes[i])) return i;
        }
        return bytes.length;
    };
    const textOf = (from, to) => text.slice(offsets[from], offsets[to]).trim();
    for (let i = 0; i < bytes.length;) {
        i = skipSpaces(i);
        const first = bytes[i];
        const end = find(i, Colon, Token.ELSE);
        if (RestOfLine.has(first) || first === Token.ELSE) return (rest(i + 1), ranges);
        if (EndsLine.has(first) || first === LineNumberToken) return (rest(end), ranges);
        if (first === Token.ON) {
            const next = skipSpaces(i + 1);
            if (bytes[next] === Token.ERROR && bytes[skipSpaces(next + 1)] !== Token.OFF)
                return (rest(next + 1), ranges);
            const jump = find(i, Token.GOTO, Token.GOSUB);
            if (jump < end) {
                const index = textOf(i + 1, jump);
                return (
                    rest(True.includes(index) ? find(jump, Comma, Colon, Token.ELSE) : jump + 1),
                    ranges
                );
            }
        }
        if (first === Token.IF) {
            const then = find(i, Token.THEN, Colon);
            const branch =
                bytes[then] === Token.THEN
                    ? then + 1
                    : bytes.findIndex((byte, j) => j > i && byte >= FirstStatementToken);
            if (branch < 0) return ranges;
            const condition = textOf(i + 1, bytes[then] === Token.THEN ? then : branch);
            if (True.includes(condition)) {
                i = branch;
                continue;
            }
            const elseAt = find(branch, Token.ELSE);
            if (False.includes(condition)) {
                ranges.push([offsets[branch], offsets[elseAt]]);
                i = elseAt + 1;
                continue;
            }
            return (rest(branch), ranges);
        }
        if (bytes[end] === Token.ELSE) return (rest(end + 1), ranges);
        i = end + 1;
    }
    return ranges;
}

export const isUnread = (ranges, start, end) =>
    (ranges || []).some(([from, to]) => from <= start && end <= to);
