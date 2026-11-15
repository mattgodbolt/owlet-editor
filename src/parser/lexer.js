// BBC BASIC II's tokeniser, ported: it finds keywords where the ROM does, with the ROM's start-of-statement and
// line-number flags, so that each token is what BASIC will see when it runs the line. It also splits the text BASIC
// leaves alone (names, numbers, strings, punctuation) into the pieces the interpreter reads.
import {Flags, keywordByToken, keywords, LineNumberToken, tokenChar} from "../tokens.js";

// Typed text matches the first entry of the table with each spelling; PAGE, PTR, TIME, LOMEM and HIMEM come again at
// the end of the table with their statement tokens, which the tokeniser makes by adding 0x40.
const typed = keywords.filter((kw, i) => keywords.findIndex(k => k.keyword === kw.keyword) === i);
const byFirstLetter = new Map();
for (const kw of typed)
    byFirstLetter.set(kw.keyword[0], [...(byFirstLetter.get(kw.keyword[0]) || []), kw]);
const StatementFormOffset = 0x40;

const byChar = new Map(keywords.map(kw => [tokenChar(kw), kw]));

// Monaco compares bracket text lower-cased, so a raw opener such as LEFT$( (U+00C0) also matches the raw token that is
// its lower-case form (END, U+00E0), which has to be tagged as a string to keep it out of bracket matching.
export const BracketCollisions = new Set(
    keywords
        .filter(kw => kw.keyword.endsWith("("))
        .map(kw => tokenChar(kw).toLowerCase())
        .filter(lower => byChar.has(lower) && !byChar.get(lower).keyword.endsWith("(")),
);
// A line number BASIC has already encoded: its token, as Owlet shows that byte, then three bytes.
const EncodedLineNumber = /\u018d[\s\S]{3}/y;

const Pattern = {
    white: /[ \t\r]+/y,
    digits: /\d+/y,
    // The tokeniser skips a run of digits and dots; the interpreter reads a number from it, then another.
    mantissa: /\d+\.?\d*|\.\d*/y,
    exponent: /E[-+]?\d*/y,
    // BASIC takes ` (a pound sign on the BBC) as a letter.
    nameRun: /[\w`]+/y,
    name: /[\w`]+[%$]?|@%/y,
    hex: /&[0-9A-F]*/y,
    // "" in a string is a quote.
    string: /"(?:[^"]|"")*"?/y,
    relation: /<[=>]?|>=?/y,
};
const isNameChar = c => c !== undefined && /[\w`]/.test(c);

// The first keyword the text at i spells in full or abbreviates, with the end of its spelling; null if there is none,
// or it is Conditional and a name character follows (then BASIC reads a name).
function matchKeyword(text, i) {
    for (const kw of byFirstLetter.get(text[i]) || []) {
        const word = kw.keyword;
        let length = 1;
        while (length < word.length && text[i + length] === word[length]) length++;
        if (length === word.length || text[i + length] === ".") {
            const end = i + length + (length === word.length ? 0 : 1);
            return kw.flags & Flags.Conditional && isNameChar(text[end]) ? null : {kw, end};
        }
    }
    return null;
}

// Tokens are {kind, start, end}, with kw (the table entry, which for a statement form of a pseudo-variable is the
// statement token's) for a keyword. Kinds: white, linenum, keyword, name, fnname, number, hex, string, punct, comment
// (after REM), data (after DATA), oscli (a * command). A string has `closed`, a token after white space `spaced`.
export class Lexer {
    constructor(text) {
        this.text = text;
        this.pos = 0;
        // BASIC reads a number at the start of a line as a line number, and so one after a keyword that leaves the
        // flag alone (TAB(10 at the start of a line refers to line 10).
        this.start = true;
        this.lineNumber = true;
        this.restOfLine = null;
        this.nameEnd = 0;
        this.tokens = [];
        this.queue = [];
        const white = this.match(Pattern.white);
        if (white) this.push("white", white);
        const number = this.match(Pattern.digits);
        if (number) this.push("linenum", number, {own: true});
    }

    match(pattern) {
        pattern.lastIndex = this.pos;
        return pattern.test(this.text) ? pattern.lastIndex : 0;
    }

    push(kind, end, extra) {
        const token = {kind, start: this.pos, end, text: this.text.slice(this.pos, end), ...extra};
        this.tokens.push(token);
        this.pos = end;
        return token;
    }

    // The token n ahead of the next, without reading past it.
    peek(n = 0) {
        while (this.queue.length <= n) this.queue.push(this.read());
        return this.queue[n];
    }

    next() {
        return this.queue.length ? this.queue.shift() : this.read();
    }

    // The text from the next token that matches the pattern as one token of the given kind, whatever the tokeniser
    // made of it, or null if it does not match: the assembler reads a comment or a label so, and the interpreter a
    // * command.
    raw(pattern, kind) {
        const next = this.peek();
        pattern.lastIndex = next.start;
        if (!pattern.test(this.text)) return null;
        this.pos = next.start;
        const at = this.tokens.lastIndexOf(next);
        if (at >= 0) this.tokens.splice(at);
        this.queue = [];
        return this.push(kind, pattern.lastIndex);
    }

    // Splits a token, which must be the next, that the interpreter reads as two: the P of TOP from the name it begins,
    // a mnemonic from its operand. The interpreter reads digits after the split as a number.
    split(token, at) {
        if (at >= token.text.length) return;
        const text = token.text.slice(at);
        const rest = {
            kind: /^\d/.test(text) ? "number" : token.kind,
            start: token.start + at,
            end: token.end,
            text,
        };
        token.end = rest.start;
        token.text = token.text.slice(0, at);
        this.tokens.splice(this.tokens.lastIndexOf(token) + 1, 0, rest);
        this.queue.splice(1, 0, rest);
    }

    read() {
        const spaced = !this.restOfLine && this.match(Pattern.white);
        if (spaced) this.push("white", spaced);
        const token = this.readToken();
        if (spaced) token.spaced = true;
        return token;
    }

    middle() {
        this.start = false;
        this.lineNumber = false;
    }

    keyword(kw, end, raw = false) {
        const statementForm = kw.flags & Flags.PseudoVariable && this.start && !raw;
        const token = this.push("keyword", end, {
            kw: statementForm ? keywordByToken.get(kw.token + StatementFormOffset) : kw,
            raw,
        });
        if (kw.flags & Flags.REM) this.restOfLine = kw.keyword === "REM" ? "comment" : "data";
        const name = kw.flags & Flags.FnProc && this.match(Pattern.nameRun);
        if (name) this.push("fnname", name);
        if (kw.flags & Flags.Middle) this.middle();
        if (kw.flags & Flags.Start) {
            this.start = true;
            this.lineNumber = false;
        }
        if (kw.flags & Flags.LineNumber) this.lineNumber = true;
        return token;
    }

    readToken() {
        const {text, pos} = this;
        const c = text[pos];
        let end;
        if (pos >= text.length) return {kind: "end", start: pos, end: pos};
        if (this.restOfLine) return this.push(this.restOfLine, text.length);
        if (c === '"') {
            const close = this.match(Pattern.string);
            return this.push("string", close, {
                closed: /^"(?:[^"]|"")*"$/.test(text.slice(pos, close)),
            });
        }
        if (c === "&") return this.push("hex", this.match(Pattern.hex));
        if (c === ":") {
            this.start = true;
            this.lineNumber = false;
            return this.push("punct", pos + 1);
        }
        if (c === ",") return this.push("punct", pos + 1);
        if (c === "*" && this.start) return this.push("oscli", text.length);
        if (this.lineNumber && (end = this.match(Pattern.digits))) return this.push("linenum", end);
        if ((end = this.match(EncodedLineNumber))) return this.push("linenum", end, {raw: true});
        if ((end = this.match(Pattern.mantissa))) {
            // An E is an exponent unless it begins a keyword (1EOR2). The tokeniser skips the whole run of name
            // characters from the E, so what the exponent leaves of it is a name: 1E0TO2 is 1E0, then TO2.
            const token = this.push("number", end);
            if (text[end] === "E" && !matchKeyword(text, end)) {
                const run = this.match(Pattern.nameRun);
                token.end = this.pos = this.match(Pattern.exponent);
                token.text = text.slice(pos, token.end);
                this.nameEnd = run;
            }
            this.middle();
            return token;
        }
        if (this.nameEnd > pos) return this.push("name", this.match(Pattern.name));
        if (byChar.has(c)) return this.keyword(byChar.get(c), pos + 1, true);
        const keyword = matchKeyword(text, pos);
        if (keyword) return this.keyword(keyword.kw, keyword.end);
        if ((end = this.match(Pattern.name))) {
            this.middle();
            // A name and a dot that abbreviate a Conditional keyword were not read as one because a letter or digit
            // followed.
            const abbreviated = text[end] === "." && matchKeyword(`${text.slice(pos, end)}.`, 0);
            return this.push("name", end, {
                abbreviation: Boolean(abbreviated && abbreviated.kw.flags & Flags.Conditional),
            });
        }
        this.middle();
        return this.push("punct", this.match(Pattern.relation) || pos + 1);
    }
}

// Every token of a line, white space included.
export function lexLine(text) {
    const lexer = new Lexer(text);
    while (lexer.next().kind !== "end");
    return lexer.tokens;
}

// The bytes BASIC stores for the line's tokens after its own number: what the ROM's tokeniser makes of it.
export function romBytes(tokens) {
    return tokens.flatMap(token => {
        if (token.kind === "linenum" && token.own) return [];
        if (token.kind === "keyword" && !token.raw) return [token.kw.token];
        if (token.kind === "linenum" && !token.raw) {
            const n = Number(token.text);
            const high = n >> 8;
            return [
                LineNumberToken,
                ((n & 0xc0) >> 2) ^ ((high & 0xc0) >> 4) ^ 0x54,
                (n & 0x3f) | 0x40,
                (high & 0x3f) | 0x40,
            ];
        }
        return [...token.text].map(c => c.codePointAt(0) & 0xff);
    });
}
