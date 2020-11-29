import BasicRom from 'jsbeeb/roms/BASIC.ROM';
import {decode} from 'base2048';

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

// Extract tokens, keywords and flags from BASIC ROM. This will supercede the next two array definitions!
export const keywords = (() => {
    const keywords = [];
    for (const match of BasicRom.substr(0x71, 0x2fc).matchAll(/([A-Z$(]+)(..)/gs)) {
        keywords.push({
            keyword: match[1],
            token: match[2].codePointAt(0) & 0xff,
            flags: match[2].codePointAt(1) & 0xff
        });
    }
    return keywords;
})();

export const tokens = (() => {
    const result = new Array(0x80).fill(null);
    for (const keyword of keywords)
        result[keyword.token - 0x80] = keyword.keyword;
    return result;
})();

// TODO - merge with byte token array, pay attention to flags wrt spacing

const Chars = {
    Quote: '"'.charCodeAt(0),
    FirstToken: 0x80,
    LineNumberToken: 0x8d,
    Dot: '.'.charCodeAt(0)
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
        if (charCode === Chars.Quote)
            withinString = !withinString;
        if (isUpperCase(charCode) && !withinString) {
            buffer += String.fromCodePoint(charCode);
        } else {
            output += ((charCode === Chars.Dot) && !withinString && buffer !== "") ? findKeyword(buffer) :
                buffer + String.fromCodePoint(charCode);
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

    onCharacter(charCode) {
        this.output += String.fromCodePoint(charCode);
    }

    onToken(token) {
        this.output += tokens[token - Chars.FirstToken];
    }
}

function detokeniseInternal(text, handler) {
    let withinString = false;
    let lineNumberBuffer = null;
    const codePoints = [...text].map(char => char.charCodeAt(0) & 0xff);
    for (const charCode of codePoints) {
        if (charCode === Chars.Quote)
            withinString = !withinString;
        if (charCode === Chars.LineNumberToken) {
            // If we see the magic line number token we need to accumulate the
            // next three bytes.
            lineNumberBuffer = [];
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
        if (charCode >= Chars.FirstToken && !withinString)
            handler.onToken(charCode);
        else
            handler.onCharacter(charCode);
    }
}

export function detokenise(text) {
    const handler = new StringHandler();
    detokeniseInternal(text, handler);
    return handler.output;
}

export function forEachBasicLine(tokenised, lineHandler) {
    while (tokenised) {
        if (tokenised.charCodeAt(0) !== 0x0d)
            throw new Error("Bad program");
        const lineNumHigh = tokenised.charCodeAt(1);
        if (lineNumHigh === 0xff)
            break;
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

    onToken(token) {
        this.onCharacter(token);
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
        code = (code === null) ? input : code[1]; // if no clamp emoji, try the decoding the whole lot
        return String.fromCharCode.apply(null, decode(code.trim()));
    } catch (error) {
        return input;
    }
}

export function expandCode(text) {
    text = decode2048(text);
    text = debbreviate(text);
    text = detokenise(text);
    return text;
}
