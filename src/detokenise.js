import {byteChar, Flags, LineNumberToken} from "./tokens.js";
import {lexLine} from "./parser/lexer.js";

const FirstTokenByte = 0x80;
const QuoteByte = 0x22;
const DataLinefeed = "\u010A";
const LineNumberBytes = 3;
// What BASIC leaves as it is to the end of the line.
const RestOfLineKinds = new Set(["comment", "data", "oscli"]);

const keywordTables = new WeakMap();

// The first keyword of a token wins, so a token with two spellings (COLOUR and COLOR) expands to the first.
function keywordByToken(dialect) {
    let table = keywordTables.get(dialect);
    if (!table) {
        table = new Map();
        for (const kw of dialect.keywords) if (!table.has(kw.token)) table.set(kw.token, kw);
        keywordTables.set(dialect, table);
    }
    return table;
}

class StringHandler {
    constructor(dialect) {
        this.output = "";
        this.keywords = keywordByToken(dialect);
    }

    onLineNumber(lineNumber) {
        this.output += `${lineNumber}`;
    }

    onCharCode(charCode) {
        this.output += byteChar(charCode);
    }

    onCharacter(ch) {
        this.output += ch;
    }

    onSpace() {
        this.output += " ";
    }

    onToken(token) {
        const kw = this.keywords.get(token);
        if (kw) this.output += kw.keyword;
        else this.onCharCode(token);
    }
}

// Where the line's REM or DATA text or * command begins, as the lexer reads it.
function restOfLineStart(line, dialect) {
    const rest = lexLine(line, dialect).find(token => RestOfLineKinds.has(token.kind));
    return rest ? rest.start : Infinity;
}

function detokeniseLine(line, handler, dialect) {
    const restStart = restOfLineStart(line, dialect);
    let withinString = false;
    let identifier = undefined;
    let afterConditionalToken = false;
    let lineNumberBuffer = null;
    let offset = 0;
    for (const char of line) {
        const start = offset;
        offset += char.length;
        const codeUnit = char.charCodeAt(0);
        const charCode = codeUnit & 0xff;
        const ch = String.fromCodePoint(charCode);
        if (charCode === 10 && lineNumberBuffer === null) {
            // U+010A stands for the byte &0A (data), and only a real newline ends a line.
            handler.onCharacter(char === "\n" ? DataLinefeed : char);
            continue;
        }
        if (afterConditionalToken) {
            if (
                charCode >= FirstTokenByte ||
                (ch >= "A" && ch <= "Z") ||
                (ch >= "a" && ch <= "z") ||
                (ch >= "0" && ch <= "9") ||
                ch === "_"
            ) {
                handler.onSpace();
            }
            afterConditionalToken = false;
        }
        if (start >= restStart) {
            handler.onCharCode(charCode);
            continue;
        }
        if (charCode === QuoteByte) withinString = !withinString;
        if (!withinString && charCode === LineNumberToken) {
            // If we see the magic line number token we need to accumulate the
            // next three bytes.
            lineNumberBuffer = [];
            identifier = undefined;
            continue;
        }
        if (lineNumberBuffer !== null) {
            lineNumberBuffer.push(charCode);
            if (lineNumberBuffer.length === LineNumberBytes) {
                // With reference to https://xania.org/200711/bbc-basic-line-number-format-part-2
                const topBits = lineNumberBuffer[0] << 2;
                const lowBits = lineNumberBuffer[1] ^ (topBits & 0xc0);
                const highBits = lineNumberBuffer[2] ^ ((topBits << 2) & 0xc0);
                handler.onLineNumber((highBits << 8) | lowBits);
                lineNumberBuffer = null;
            }
            continue;
        }
        if (charCode >= FirstTokenByte) {
            if (withinString) {
                handler.onCharCode(charCode);
                continue;
            }
            if (identifier !== undefined) {
                handler.onSpace();
                identifier = undefined;
            }
            handler.onToken(charCode);
            if (handler.keywords.get(charCode)?.flags & Flags.Conditional)
                afterConditionalToken = true;
        } else if (charCode < 32 || charCode === 127) {
            identifier = undefined;
            handler.onCharCode(charCode);
        } else {
            handler.onCharacter(ch);
            if (
                (ch >= "A" && ch <= "Z") ||
                (ch >= "a" && ch <= "z") ||
                ch === "_" ||
                (identifier !== undefined && ch >= "0" && ch <= "9")
            ) {
                identifier = identifier === undefined ? ch : identifier + ch;
            } else {
                identifier = undefined;
            }
        }
    }
    if (lineNumberBuffer !== null) {
        // The line ended inside a line number: those bytes are not one.
        handler.onCharCode(LineNumberToken);
        for (const byte of lineNumberBuffer) handler.onCharCode(byte);
    }
}

function detokeniseInternal(text, handler, dialect) {
    text.split("\n").forEach((line, i) => {
        if (i > 0) handler.onCharacter("\n");
        detokeniseLine(line, handler, dialect);
    });
}

export function detokenise(text, dialect) {
    const handler = new StringHandler(dialect);
    detokeniseInternal(text, handler, dialect);
    return handler.output;
}

export function forEachBasicLine(tokenised, lineHandler) {
    while (tokenised) {
        if (tokenised.charCodeAt(0) !== 0x0d) throw new Error("Bad program");
        const lineNumHigh = tokenised.charCodeAt(1);
        if (lineNumHigh === 0xff) break;
        const lineNumLow = tokenised.charCodeAt(2);
        const lineLength = tokenised.charCodeAt(3);
        const lineNumber = (lineNumHigh << 8) | lineNumLow;
        const line = tokenised.substr(4, lineLength - 4);
        tokenised = tokenised.substr(lineLength);
        lineHandler(lineNumber, line);
    }
}

class PartialHandler extends StringHandler {
    onSpace() {}

    onToken(token) {
        this.onCharCode(token);
    }
}

export function partialDetokenise(rawText, dialect) {
    const lines = [];
    forEachBasicLine(rawText, (lineNum, line) => {
        const handler = new PartialHandler(dialect);
        detokeniseLine(line, handler, dialect);
        lines.push({num: lineNum, line: handler.output});
    });
    let lineno = 0;
    return lines.map(x => addLineNo((lineno += 10), x)).join("\n");
}

function addLineNo(lineno, x) {
    if (lineno === x.num) {
        // Omit the line number if it is the same as the implicit line number
        // since we want to avoid "Shrink" making a program with a mixture of
        // implicit and explicit line numbers larger.
        return x.line.trimStart();
    } else {
        return `${x.num}${x.line}`;
    }
}
