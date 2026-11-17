/*

 BBC BASIC Keyword Byte Tokens

 Derived from rheolism's
 https://github.com/8bitkick/BBCMicroBot/blob/master/tools/bbcbasictokenise

 Array starts at byte token 0x80

*/

export const Flags = {
    None: 0,
    // Flags from the BASIC ROM's table.
    Conditional: 0x01,
    Middle: 0x02,
    Start: 0x04,
    FnProc: 0x08,
    LineNumber: 0x10,
    REM: 0x20,
    PseudoVariable: 0x40,
    // Additional Owlet flag, worked out below.  The value doesn't fit in a byte so can't collide.
    Expr: 0x100,
};

// Extract tokens, keywords and flags from BASIC ROM.
export const keywords = [
    {keyword: "AND", token: 0x80, flags: Flags.None},
    {keyword: "ABS", token: 0x94, flags: Flags.None},
    {keyword: "ACS", token: 0x95, flags: Flags.None},
    {keyword: "ADVAL", token: 0x96, flags: Flags.None},
    {keyword: "ASC", token: 0x97, flags: Flags.None},
    {keyword: "ASN", token: 0x98, flags: Flags.None},
    {keyword: "ATN", token: 0x99, flags: Flags.None},
    {keyword: "AUTO", token: 0xc6, flags: Flags.LineNumber},
    {keyword: "BGET", token: 0x9a, flags: Flags.Conditional},
    {keyword: "BPUT", token: 0xd5, flags: Flags.Conditional | Flags.Middle},
    {keyword: "COLOUR", token: 0xfb, flags: Flags.Middle},
    {keyword: "CALL", token: 0xd6, flags: Flags.Middle},
    {keyword: "CHAIN", token: 0xd7, flags: Flags.Middle},
    {keyword: "CHR$", token: 0xbd, flags: Flags.None},
    {keyword: "CLEAR", token: 0xd8, flags: Flags.Conditional},
    {keyword: "CLOSE", token: 0xd9, flags: Flags.Conditional | Flags.Middle},
    {keyword: "CLG", token: 0xda, flags: Flags.Conditional},
    {keyword: "CLS", token: 0xdb, flags: Flags.Conditional},
    {keyword: "COS", token: 0x9b, flags: Flags.None},
    {keyword: "COUNT", token: 0x9c, flags: Flags.Conditional},
    {keyword: "DATA", token: 0xdc, flags: Flags.REM},
    {keyword: "DEG", token: 0x9d, flags: Flags.None},
    {keyword: "DEF", token: 0xdd, flags: Flags.None},
    {keyword: "DELETE", token: 0xc7, flags: Flags.LineNumber},
    {keyword: "DIV", token: 0x81, flags: Flags.None},
    {keyword: "DIM", token: 0xde, flags: Flags.Middle},
    {keyword: "DRAW", token: 0xdf, flags: Flags.Middle},
    {keyword: "ENDPROC", token: 0xe1, flags: Flags.Conditional},
    {keyword: "END", token: 0xe0, flags: Flags.Conditional},
    {keyword: "ENVELOPE", token: 0xe2, flags: Flags.Middle},
    {keyword: "ELSE", token: 0x8b, flags: Flags.Start | Flags.LineNumber},
    {keyword: "EVAL", token: 0xa0, flags: Flags.None},
    {keyword: "ERL", token: 0x9e, flags: Flags.Conditional},
    {keyword: "ERROR", token: 0x85, flags: Flags.Start},
    {keyword: "EOF", token: 0xc5, flags: Flags.Conditional},
    {keyword: "EOR", token: 0x82, flags: Flags.None},
    {keyword: "ERR", token: 0x9f, flags: Flags.Conditional},
    {keyword: "EXP", token: 0xa1, flags: Flags.None},
    {keyword: "EXT", token: 0xa2, flags: Flags.Conditional},
    {keyword: "FOR", token: 0xe3, flags: Flags.Middle},
    {keyword: "FALSE", token: 0xa3, flags: Flags.Conditional},
    {keyword: "FN", token: 0xa4, flags: Flags.FnProc},
    {keyword: "GOTO", token: 0xe5, flags: Flags.Middle | Flags.LineNumber},
    {keyword: "GET$", token: 0xbe, flags: Flags.None},
    {keyword: "GET", token: 0xa5, flags: Flags.None},
    {keyword: "GOSUB", token: 0xe4, flags: Flags.Middle | Flags.LineNumber},
    {keyword: "GCOL", token: 0xe6, flags: Flags.Middle},
    {keyword: "HIMEM", token: 0x93, flags: Flags.Conditional | Flags.Middle | Flags.PseudoVariable},
    {keyword: "INPUT", token: 0xe8, flags: Flags.Middle},
    {keyword: "IF", token: 0xe7, flags: Flags.Middle},
    {keyword: "INKEY$", token: 0xbf, flags: Flags.None},
    {keyword: "INKEY", token: 0xa6, flags: Flags.None},
    {keyword: "INT", token: 0xa8, flags: Flags.None},
    {keyword: "INSTR(", token: 0xa7, flags: Flags.None},
    {keyword: "LIST", token: 0xc9, flags: Flags.LineNumber},
    {keyword: "LINE", token: 0x86, flags: Flags.None},
    {keyword: "LOAD", token: 0xc8, flags: Flags.Middle},
    {keyword: "LOMEM", token: 0x92, flags: Flags.Conditional | Flags.Middle | Flags.PseudoVariable},
    {keyword: "LOCAL", token: 0xea, flags: Flags.Middle},
    {keyword: "LEFT$(", token: 0xc0, flags: Flags.None},
    {keyword: "LEN", token: 0xa9, flags: Flags.None},
    {keyword: "LET", token: 0xe9, flags: Flags.Start},
    {keyword: "LOG", token: 0xab, flags: Flags.None},
    {keyword: "LN", token: 0xaa, flags: Flags.None},
    {keyword: "MID$(", token: 0xc1, flags: Flags.None},
    {keyword: "MODE", token: 0xeb, flags: Flags.Middle},
    {keyword: "MOD", token: 0x83, flags: Flags.None},
    {keyword: "MOVE", token: 0xec, flags: Flags.Middle},
    {keyword: "NEXT", token: 0xed, flags: Flags.Middle},
    {keyword: "NEW", token: 0xca, flags: Flags.Conditional},
    {keyword: "NOT", token: 0xac, flags: Flags.None},
    {keyword: "OLD", token: 0xcb, flags: Flags.Conditional},
    {keyword: "ON", token: 0xee, flags: Flags.Middle},
    {keyword: "OFF", token: 0x87, flags: Flags.None},
    {keyword: "OR", token: 0x84, flags: Flags.None},
    {keyword: "OPENIN", token: 0x8e, flags: Flags.None},
    {keyword: "OPENOUT", token: 0xae, flags: Flags.None},
    {keyword: "OPENUP", token: 0xad, flags: Flags.None},
    {keyword: "OSCLI", token: 0xff, flags: Flags.Middle},
    {keyword: "PRINT", token: 0xf1, flags: Flags.Middle},
    {keyword: "PAGE", token: 0x90, flags: Flags.Conditional | Flags.Middle | Flags.PseudoVariable},
    {keyword: "PTR", token: 0x8f, flags: Flags.Conditional | Flags.Middle | Flags.PseudoVariable},
    {keyword: "PI", token: 0xaf, flags: Flags.Conditional},
    {keyword: "PLOT", token: 0xf0, flags: Flags.Middle},
    {keyword: "POINT(", token: 0xb0, flags: Flags.None},
    {keyword: "PROC", token: 0xf2, flags: Flags.Middle | Flags.FnProc},
    {keyword: "POS", token: 0xb1, flags: Flags.Conditional},
    {keyword: "RETURN", token: 0xf8, flags: Flags.Conditional},
    {keyword: "REPEAT", token: 0xf5, flags: Flags.None},
    {keyword: "REPORT", token: 0xf6, flags: Flags.Conditional},
    {keyword: "READ", token: 0xf3, flags: Flags.Middle},
    {keyword: "REM", token: 0xf4, flags: Flags.REM},
    {keyword: "RUN", token: 0xf9, flags: Flags.Conditional},
    {keyword: "RAD", token: 0xb2, flags: Flags.None},
    {keyword: "RESTORE", token: 0xf7, flags: Flags.Middle | Flags.LineNumber},
    {keyword: "RIGHT$(", token: 0xc2, flags: Flags.None},
    {keyword: "RND", token: 0xb3, flags: Flags.Conditional},
    {keyword: "RENUMBER", token: 0xcc, flags: Flags.LineNumber},
    {keyword: "STEP", token: 0x88, flags: Flags.None},
    {keyword: "SAVE", token: 0xcd, flags: Flags.Middle},
    {keyword: "SGN", token: 0xb4, flags: Flags.None},
    {keyword: "SIN", token: 0xb5, flags: Flags.None},
    {keyword: "SQR", token: 0xb6, flags: Flags.None},
    {keyword: "SPC", token: 0x89, flags: Flags.None},
    {keyword: "STR$", token: 0xc3, flags: Flags.None},
    {keyword: "STRING$(", token: 0xc4, flags: Flags.None},
    {keyword: "SOUND", token: 0xd4, flags: Flags.Middle},
    {keyword: "STOP", token: 0xfa, flags: Flags.Conditional},
    {keyword: "TAN", token: 0xb7, flags: Flags.None},
    {keyword: "THEN", token: 0x8c, flags: Flags.Start | Flags.LineNumber},
    {keyword: "TO", token: 0xb8, flags: Flags.None},
    {keyword: "TAB(", token: 0x8a, flags: Flags.None},
    {keyword: "TRACE", token: 0xfc, flags: Flags.Middle | Flags.LineNumber},
    {keyword: "TIME", token: 0x91, flags: Flags.Conditional | Flags.Middle | Flags.PseudoVariable},
    {keyword: "TRUE", token: 0xb9, flags: Flags.Conditional},
    {keyword: "UNTIL", token: 0xfd, flags: Flags.Middle},
    {keyword: "USR", token: 0xba, flags: Flags.None},
    {keyword: "VDU", token: 0xef, flags: Flags.Middle},
    {keyword: "VAL", token: 0xbb, flags: Flags.None},
    {keyword: "VPOS", token: 0xbc, flags: Flags.Conditional},
    {keyword: "WIDTH", token: 0xfe, flags: Flags.Middle},
    {keyword: "PAGE", token: 0xd0, flags: Flags.None},
    {keyword: "PTR", token: 0xcf, flags: Flags.None},
    {keyword: "TIME", token: 0xd1, flags: Flags.None},
    {keyword: "LOMEM", token: 0xd2, flags: Flags.None},
    {keyword: "HIMEM", token: 0xd3, flags: Flags.None},
];

export const keywordByToken = new Map(keywords.map(kw => [kw.token, kw]));

// The tokens from here up are the statements, including the statement forms of PTR, PAGE, TIME, LOMEM and HIMEM.
export const FirstStatementToken = 0xc6;
export const isStatementKeyword = kw => kw.token >= FirstStatementToken;
export const LineNumberToken = 0x8d;
// A keyword can appear in a value if it is an operator (&80-&84) or a function or pseudo-variable (&8E up to the
// statements), except TO.
const LastOperatorToken = 0x84;
const FirstValueToken = 0x8e;
const ToToken = 0xb8;
for (const kw of keywords) {
    if (
        kw.token <= LastOperatorToken ||
        (kw.token >= FirstValueToken && kw.token < FirstStatementToken && kw.token !== ToToken)
    ) {
        kw.flags |= Flags.Expr;
    }
}
// The character Owlet writes for a byte that is not text: its own code point where that is a visible character, else
// the one 0x100 above it. That covers the control bytes, &7F-&9F, and &A0 and &AD, which would be a non-breaking space
// and a soft hyphen (invisible, and trim() removes the first). BASIC and the bot keep only the low eight bits, so
// either reads as the same byte.
const NoBreakSpaceByte = 0xa0;
const SoftHyphenByte = 0xad;
const needsOffset = byte =>
    (byte < 32 && byte !== 10) ||
    (byte >= 127 && byte < 160) ||
    byte === NoBreakSpaceByte ||
    byte === SoftHyphenByte;
export const byteChar = byte => String.fromCodePoint(needsOffset(byte) ? byte + 0x100 : byte);
export const tokenChar = kw => byteChar(kw.token);

// The last of AUTO DELETE LIST LOAD NEW OLD RENUMBER SAVE; BASIC IV's EDIT follows it.
export const LastCommandToken = 0xcd;

// By spelling, since the lexer reads the statement form of one of these as the row at the end of the table.
export const pseudoVariables = new Set(
    keywords.filter(kw => kw.flags & Flags.PseudoVariable).map(kw => kw.keyword),
);
export const isFnProc = kw => Boolean(kw.flags & Flags.FnProc);

const Chars = {
    FirstToken: 0x80,
    NewLine: "\n".charCodeAt(0),
    Quote: '"'.charCodeAt(0),
};

class StringHandler {
    constructor() {
        this.output = "";
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
        const kw = keywordByToken.get(token);
        if (kw) this.output += kw.keyword;
        else this.onCharCode(token);
    }
}

function detokeniseInternal(text, handler) {
    let withinString = false;
    let identifier = undefined;
    let leaveRestOfLine = false;
    let afterConditionalToken = false;
    let lineNumberBuffer = null;
    for (const char of text) {
        const codeUnit = char.charCodeAt(0);
        const charCode = codeUnit & 0xff;
        let ch = String.fromCodePoint(charCode);
        if (charCode === Chars.NewLine && codeUnit !== Chars.NewLine && lineNumberBuffer === null) {
            // U+010A stands for the byte &0A (data), and only a real newline ends a line.
            handler.onCharacter(char);
            continue;
        }
        if (charCode === 10) {
            // Newline.
            withinString = false;
            identifier = undefined;
            leaveRestOfLine = false;
        }
        if (afterConditionalToken) {
            if (
                charCode >= Chars.FirstToken ||
                (ch >= "A" && ch <= "Z") ||
                (ch >= "a" && ch <= "z") ||
                (ch >= "0" && ch <= "9") ||
                ch === "_"
            ) {
                handler.onSpace();
            }
            afterConditionalToken = false;
        }
        if (leaveRestOfLine) {
            handler.onCharCode(charCode);
            continue;
        }
        if (charCode === Chars.Quote) withinString = !withinString;
        if (!withinString && charCode === LineNumberToken) {
            // If we see the magic line number token we need to accumulate the
            // next three bytes.
            lineNumberBuffer = [];
            identifier = undefined;
            continue;
        }
        if (lineNumberBuffer !== null) {
            lineNumberBuffer.push(charCode);
            if (lineNumberBuffer.length === 3) {
                // With reference to https://xania.org/200711/bbc-basic-line-number-format-part-2
                const topBits = lineNumberBuffer[0] << 2;
                const lowBits = lineNumberBuffer[1] ^ (topBits & 0xc0);
                const highBits = lineNumberBuffer[2] ^ ((topBits << 2) & 0xc0);
                handler.onLineNumber((highBits << 8) | lowBits);
                lineNumberBuffer = null;
            }
            continue;
        }
        if (charCode >= Chars.FirstToken) {
            if (withinString) {
                handler.onCharCode(charCode);
                continue;
            }
            if (identifier === "REM" || identifier === "DATA") {
                leaveRestOfLine = true;
                handler.onCharCode(charCode);
                continue;
            }
            if (identifier !== undefined) {
                handler.onSpace();
                identifier = undefined;
            }
            handler.onToken(charCode);
            const tokenFlags = keywordByToken.get(charCode)?.flags ?? 0;
            if (tokenFlags & Flags.Conditional) {
                afterConditionalToken = true;
            }
            if (tokenFlags & Flags.REM) {
                // Note: "REM" flag is also set for DATA token!
                // FIXME: What about untokenised REM or DATA?
                // FIXME: Probably also turn on for * commands.
                leaveRestOfLine = true;
            }
        } else if ((charCode < 32 && charCode !== 10) || charCode === 127) {
            identifier = undefined;
            handler.onCharCode(charCode);
        } else {
            if (
                identifier === "REM" ||
                identifier === "DATA" ||
                (ch === "." && "DAT".startsWith(identifier))
            ) {
                // Untokenised REM or DATA or abbreviated DATA.
                leaveRestOfLine = true;
            }
            handler.onCharacter(ch);
            if (
                (ch >= "A" && ch <= "Z") ||
                (ch >= "a" && ch <= "z") ||
                ch === "_" ||
                (identifier !== undefined && ch >= "0" && ch <= "9")
            ) {
                if (identifier === undefined) {
                    identifier = ch;
                } else {
                    identifier += ch;
                }
            } else {
                identifier = undefined;
            }
        }
    }
}

export function detokenise(text) {
    const handler = new StringHandler();
    detokeniseInternal(text, handler);
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

export function partialDetokenise(rawText) {
    const lines = [];
    forEachBasicLine(rawText, (lineNum, line) => {
        const handler = new PartialHandler();
        detokeniseInternal(line, handler);
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

// Compatibility with pre-tokenizer keyboard buffer method
//
// Only some token values make it through.
//
// It seems that U+00D0-U+00DA, U+00E0-U+00EA, U+00F0-U+00FA work;
// U+0090-U+009A. U+00A0-U+00AA map to a byte value 16 lower (so U+0090 -> AND
// which has byte token &80).
//
// The bot discards higher bits, so e.g. U+0190 -> AND too. All ranges incl.
export function backwardCompat(text) {
    let output = "";
    const codePoints = [...text].map(char => char.charCodeAt(0));
    for (const charCode of codePoints) {
        let newCode = charCode & 0xff;
        // U+0090-U+009A. U+00A0-U+00AA map to byte 16 lower
        let ranges16 = (newCode >= 0x90 && newCode <= 0x9a) || (newCode >= 0xa0 && newCode <= 0xaa);
        if (ranges16) {
            newCode = newCode - 16;
        }

        output += String.fromCodePoint(newCode);
    }
    return output;
}
