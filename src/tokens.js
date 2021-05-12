import {decode} from "base2048";

/*

 BBC BASIC Keyword Byte Tokens

 Derived from twitter.com/rheolism
 https://github.com/8bitkick/BBCMicroBot/blob/master/tools/bbcbasictokenise

 To twitter these inclusive ranges count as 1 character (everything else as 2):
 U+0000-U+10FF
 U+2000-U+200D # various spaces
 U+2010-U+201F # various punctuation
 U+2032-U+2037 # various prime marks

 Array starts at byte token 0x80

*/

// Extract tokens, keywords and flags from BASIC ROM.
export const keywords = (() => {
    const keywords = [
        {keyword: "AND", token: 128, flags: 0},
        {keyword: "ABS", token: 148, flags: 0},
        {keyword: "ACS", token: 149, flags: 0},
        {keyword: "ADVAL", token: 150, flags: 0},
        {keyword: "ASC", token: 151, flags: 0},
        {keyword: "ASN", token: 152, flags: 0},
        {keyword: "ATN", token: 153, flags: 0},
        {keyword: "AUTO", token: 198, flags: 16},
        {keyword: "BGET", token: 154, flags: 1},
        {keyword: "BPUT", token: 213, flags: 3},
        {keyword: "COLOUR", token: 251, flags: 2},
        {keyword: "CALL", token: 214, flags: 2},
        {keyword: "CHAIN", token: 215, flags: 2},
        {keyword: "CHR$", token: 189, flags: 0},
        {keyword: "CLEAR", token: 216, flags: 1},
        {keyword: "CLOSE", token: 217, flags: 3},
        {keyword: "CLG", token: 218, flags: 1},
        {keyword: "CLS", token: 219, flags: 1},
        {keyword: "COS", token: 155, flags: 0},
        {keyword: "COUNT", token: 156, flags: 1},
        {keyword: "DATA", token: 220, flags: 32},
        {keyword: "DEG", token: 157, flags: 0},
        {keyword: "DEF", token: 221, flags: 0},
        {keyword: "DELETE", token: 199, flags: 16},
        {keyword: "DIV", token: 129, flags: 0},
        {keyword: "DIM", token: 222, flags: 2},
        {keyword: "DRAW", token: 223, flags: 2},
        {keyword: "ENDPROC", token: 225, flags: 1},
        {keyword: "END", token: 224, flags: 1},
        {keyword: "ENVELOPE", token: 226, flags: 2},
        {keyword: "ELSE", token: 139, flags: 20},
        {keyword: "EVAL", token: 160, flags: 0},
        {keyword: "ERL", token: 158, flags: 1},
        {keyword: "ERROR", token: 133, flags: 4},
        {keyword: "EOF", token: 197, flags: 1},
        {keyword: "EOR", token: 130, flags: 0},
        {keyword: "ERR", token: 159, flags: 1},
        {keyword: "EXP", token: 161, flags: 0},
        {keyword: "EXT", token: 162, flags: 1},
        {keyword: "FOR", token: 227, flags: 2},
        {keyword: "FALSE", token: 163, flags: 1},
        {keyword: "FN", token: 164, flags: 8},
        {keyword: "GOTO", token: 229, flags: 18},
        {keyword: "GET$", token: 190, flags: 0},
        {keyword: "GET", token: 165, flags: 0},
        {keyword: "GOSUB", token: 228, flags: 18},
        {keyword: "GCOL", token: 230, flags: 2},
        {keyword: "HIMEM", token: 147, flags: 67},
        {keyword: "INPUT", token: 232, flags: 2},
        {keyword: "IF", token: 231, flags: 2},
        {keyword: "INKEY$", token: 191, flags: 0},
        {keyword: "INKEY", token: 166, flags: 0},
        {keyword: "INT", token: 168, flags: 0},
        {keyword: "INSTR(", token: 167, flags: 0},
        {keyword: "LIST", token: 201, flags: 16},
        {keyword: "LINE", token: 134, flags: 0},
        {keyword: "LOAD", token: 200, flags: 2},
        {keyword: "LOMEM", token: 146, flags: 67},
        {keyword: "LOCAL", token: 234, flags: 2},
        {keyword: "LEFT$(", token: 192, flags: 0},
        {keyword: "LEN", token: 169, flags: 0},
        {keyword: "LET", token: 233, flags: 4},
        {keyword: "LOG", token: 171, flags: 0},
        {keyword: "LN", token: 170, flags: 0},
        {keyword: "MID$(", token: 193, flags: 0},
        {keyword: "MODE", token: 235, flags: 2},
        {keyword: "MOD", token: 131, flags: 0},
        {keyword: "MOVE", token: 236, flags: 2},
        {keyword: "NEXT", token: 237, flags: 2},
        {keyword: "NEW", token: 202, flags: 1},
        {keyword: "NOT", token: 172, flags: 0},
        {keyword: "OLD", token: 203, flags: 1},
        {keyword: "ON", token: 238, flags: 2},
        {keyword: "OFF", token: 135, flags: 0},
        {keyword: "OR", token: 132, flags: 0},
        {keyword: "OPENIN", token: 142, flags: 0},
        {keyword: "OPENOUT", token: 174, flags: 0},
        {keyword: "OPENUP", token: 173, flags: 0},
        {keyword: "OSCLI", token: 255, flags: 2},
        {keyword: "PRINT", token: 241, flags: 2},
        {keyword: "PAGE", token: 144, flags: 67},
        {keyword: "PTR", token: 143, flags: 67},
        {keyword: "PI", token: 175, flags: 1},
        {keyword: "PLOT", token: 240, flags: 2},
        {keyword: "POINT(", token: 176, flags: 0},
        {keyword: "PROC", token: 242, flags: 10},
        {keyword: "POS", token: 177, flags: 1},
        {keyword: "RETURN", token: 248, flags: 1},
        {keyword: "REPEAT", token: 245, flags: 0},
        {keyword: "REPORT", token: 246, flags: 1},
        {keyword: "READ", token: 243, flags: 2},
        {keyword: "REM", token: 244, flags: 32},
        {keyword: "RUN", token: 249, flags: 1},
        {keyword: "RAD", token: 178, flags: 0},
        {keyword: "RESTORE", token: 247, flags: 18},
        {keyword: "RIGHT$(", token: 194, flags: 0},
        {keyword: "RND", token: 179, flags: 1},
        {keyword: "RENUMBER", token: 204, flags: 16},
        {keyword: "STEP", token: 136, flags: 0},
        {keyword: "SAVE", token: 205, flags: 2},
        {keyword: "SGN", token: 180, flags: 0},
        {keyword: "SIN", token: 181, flags: 0},
        {keyword: "SQR", token: 182, flags: 0},
        {keyword: "SPC", token: 137, flags: 0},
        {keyword: "STR$", token: 195, flags: 0},
        {keyword: "STRING$(", token: 196, flags: 0},
        {keyword: "SOUND", token: 212, flags: 2},
        {keyword: "STOP", token: 250, flags: 1},
        {keyword: "TAN", token: 183, flags: 0},
        {keyword: "THEN", token: 140, flags: 20},
        {keyword: "TO", token: 184, flags: 0},
        {keyword: "TAB(", token: 138, flags: 0},
        {keyword: "TRACE", token: 252, flags: 18},
        {keyword: "TIME", token: 145, flags: 67},
        {keyword: "TRUE", token: 185, flags: 1},
        {keyword: "UNTIL", token: 253, flags: 2},
        {keyword: "USR", token: 186, flags: 0},
        {keyword: "VDU", token: 239, flags: 2},
        {keyword: "VAL", token: 187, flags: 0},
        {keyword: "VPOS", token: 188, flags: 1},
        {keyword: "WIDTH", token: 254, flags: 2},
        {keyword: "PAGE", token: 208, flags: 0},
        {keyword: "PTR", token: 207, flags: 0},
        {keyword: "TIME", token: 209, flags: 0},
        {keyword: "LOMEM", token: 210, flags: 0},
        {keyword: "HIMEM", token: 211, flags: 0},
    ];
    return keywords;
})();

export const tokens = (() => {
    const result = new Array(0x80).fill(null);
    for (const keyword of keywords) result[keyword.token - 0x80] = keyword.keyword;
    return result;
})();

export const flags = (() => {
    const result = new Array(0x80).fill(0);
    for (const keyword of keywords) result[keyword.token - 0x80] = keyword.flags;
    return result;
})();

export const Flags = {
    Conditional: 0x01,
    Middle: 0x02,
    Start: 0x04,
    FnProc: 0x08,
    LineNumber: 0x10,
    REM: 0x20,
    PseudoVariable: 0x40,
};

const Chars = {
    Quote: '"'.charCodeAt(0),
    FirstToken: 0x80,
    LineNumberToken: 0x8d,
    Dot: ".".charCodeAt(0),
};

function findKeyword(abbreviation) {
    for (const keyword of keywords) {
        if (keyword.keyword.indexOf(abbreviation) === 0 && abbreviation !== keyword.keyword) {
            return keyword.keyword;
        }
    }
    return abbreviation + ".";
}

function isUpperCase(c) {
    return c > 64 && c < 91;
}

export function debbreviate(text) {
    let output = "";
    let buffer = "";
    let withinString = false;
    const codePoints = [...text].map(char => char.charCodeAt(0) & 0xff);
    for (const charCode of codePoints) {
        if (charCode === Chars.Quote) withinString = !withinString;
        if (isUpperCase(charCode) && !withinString) {
            buffer += String.fromCodePoint(charCode);
        } else {
            output +=
                charCode === Chars.Dot && !withinString && buffer !== ""
                    ? findKeyword(buffer)
                    : buffer + String.fromCodePoint(charCode);
            buffer = "";
        }
    }
    return output + buffer;
}

class StringHandler {
    constructor() {
        this.output = "";
    }

    onLineNumber(lineNumber) {
        this.output += `${lineNumber}`;
    }

    onCharCode(charCode) {
        if ((charCode >= 127 && charCode < 160) || (charCode < 32 && charCode !== 10)) {
            charCode += 0x100;
        }
        this.output += String.fromCodePoint(charCode);
    }

    onCharacter(ch) {
        this.output += ch;
    }

    onSpace() {
        this.output += " ";
    }

    onToken(token) {
        this.output += tokens[token - Chars.FirstToken];
    }
}

function detokeniseInternal(text, handler) {
    let withinString = false;
    let inIdentifier = false;
    let leaveRestOfLine = false;
    let afterConditionalToken = false;
    let lineNumberBuffer = null;
    const codePoints = [...text].map(char => char.charCodeAt(0) & 0xff);
    for (const charCode of codePoints) {
        let ch = String.fromCodePoint(charCode);
        if (charCode === 10) {
            // Newline.
            withinString = false;
            inIdentifier = false;
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
        if (charCode === Chars.LineNumberToken) {
            // If we see the magic line number token we need to accumulate the
            // next three bytes.
            lineNumberBuffer = [];
            inIdentifier = false;
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
            }
            continue;
        }
        if (charCode >= Chars.FirstToken) {
            if (withinString) {
                handler.onCharCode(charCode);
                continue;
            }
            if (inIdentifier) {
                handler.onSpace();
                inIdentifier = false;
            }
            handler.onToken(charCode);
            let tokenFlags = flags[charCode - Chars.FirstToken];
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
            inIdentifier = false;
            handler.onCharCode(charCode);
        } else {
            handler.onCharacter(ch);
            inIdentifier =
                (ch >= "A" && ch <= "Z") ||
                (ch >= "a" && ch <= "z") ||
                ch == "_" ||
                (inIdentifier && ch >= "0" && ch <= "9");
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

function goesUpInTensOnly(sequence) {
    let prev = 0;
    for (const num of sequence) {
        if (num !== prev + 10) return false;
        prev = num;
    }
    return true;
}

class PartialHandler extends StringHandler {
    constructor() {
        super();
    }

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
    if (goesUpInTensOnly(lines.map(x => x.num))) {
        return lines.map(x => x.line.trimStart()).join("\n");
    } else {
        return lines.map(x => `${x.num}${x.line}`).join("\n");
    }
}

function decode2048(input) {
    try {
        let code = input.match(/🗜(\S*)/);
        code = code === null ? input : code[1]; // if no clamp emoji, try the decoding the whole lot
        return String.fromCharCode.apply(null, decode(code.trim()));
    } catch (error) {
        return input;
    }
}

export function expandCode(text) {
    if (text !== decode2048(text)) {
        return decode2048(text);
    }
    text = debbreviate(text);
    text = detokenise(text);
    return text;
}
