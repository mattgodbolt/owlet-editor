// Reads a line of BBC BASIC II as the interpreter does, by recursive descent over the lexer's tokens, and marks the
// token at which BASIC would stop with an error: one per statement, then on to the next colon, as BASIC reports only
// the first. Where there is no rule for a statement, anything is accepted.
import {Assembler, mnemonicsFor} from "./assembler.js";
import {isFnProc, isStatementKeyword, pseudoVariables} from "../tokens.js";
import {BasicIIDialect, canStartStatement} from "./dialect.js";
import {Lexer} from "./lexer.js";

// Recursion deeper than this is an error: the 6502's stack gives out long before it.
const MaxDepth = 64;
export const SpaceBeforeKeywordCode = "space-before-keyword";
const IgnoredInOnListCode = "ignored-in-on-list";
export const SpacedKeywords = [
    "TO",
    "STEP",
    "AND",
    "DIV",
    "EOR",
    "MOD",
    "OR",
    "GOTO",
    "GOSUB",
    "PROC",
    "ELSE",
];

const StrayElse =
    "ELSE is not after an IF or ON that has no ELSE yet: BASIC accepts it and ignores the rest of the line";

const OnTargets = {
    lineNumber:
        "BASIC ignores everything after the line number here, up to the next comma (20E1 is line 20, not 200)",
    expression: "BASIC ignores everything after the expression here, up to the next comma",
    procedure: "BASIC ignores everything after the procedure call here, up to the next comma",
};

const names = text => new Set(text.split(" "));
export const NoArgument = names(
    "PI TRUE FALSE POS VPOS COUNT ERL ERR TIME PAGE LOMEM HIMEM GET GET$",
);
export const OneArgument = names(
    "ABS ACS ADVAL ASC ASN ATN CHR$ COS DEG EVAL EXP INKEY INKEY$ INT LEN LN LOG NOT RAD SGN SIN SQR TAN USR VAL " +
        "OPENIN OPENOUT OPENUP",
);
export const ChannelFunction = names("BGET EOF EXT PTR");
// The fewest and most arguments of the functions whose keyword ends in "(".
export const BracketFunction = {
    "INSTR(": [2, 3],
    "LEFT$(": [2, 2],
    "MID$(": [2, 3],
    "RIGHT$(": [2, 2],
    "STRING$(": [2, 2],
    "POINT(": [2, 2],
};
// The number of expressions each of these statements takes.
export const ExpressionCount = {
    ...Object.fromEntries(
        "CLEAR CLG CLS END ENDPROC NEW OLD REPORT RETURN RUN STOP"
            .split(" ")
            .map(name => [name, 0]),
    ),
    ...Object.fromEntries(
        "CHAIN COLOUR COLOR MODE OSCLI UNTIL WIDTH".split(" ").map(name => [name, 1]),
    ),
    GCOL: 2,
    MOVE: 2,
    DRAW: 2,
    PLOT: 3,
    SOUND: 4,
    ENVELOPE: 14,
};
const NotCode = names("comment data oscli");
export const TextKeyword = names("REM DATA");
// Operators from other languages, with what BASIC calls those it has (null for the rest).
export const ForeignOperators = new Map([
    ["==", "="],
    ["!=", "<>"],
    ["**", "^"],
    ["><", "<>"],
    ["=<", "<="],
    ["=>", ">="],
    ...["-=", "+=", "/=", "*=", "^=", "<<", ">>"].map(operator => [operator, null]),
]);
const Relations = names("= < > <= >= <>");
const Arithmetic = names("+ - * / ^");
// What a value is, where BASIC would give "Type mismatch" if the line ran and it were the other; undefined is not known.
const Str = "a string";
const Num = "a number";
const StringArgument = names("ASC LEN VAL OPENIN OPENOUT OPENUP");
const AnyArgument = names("EVAL");
const UnknownResult = names("EVAL TIME");
const typeOfName = text => (text.endsWith("$") ? Str : Num);
const typeOfKeyword = keyword =>
    UnknownResult.has(keyword) ? undefined : typeOfName(keyword.replace(/\($/, ""));

// `unfinished` is an error only because the line ends: more text could still make it valid.
// What the ROM says when it does not find the punctuation, and when what should be an operand is a & with no digits or
// a string with no end.
const ExpectedPunct = {",": "Missing ,", "=": "Mistake", "#": "Missing #"};
const OperandErrors = {hex: "Bad HEX", string: 'Missing "'};
// BASIC IV words one of its errors differently.
const BadHexIV = "Bad Hex";
const TooMany = "Too many arguments before )";
const MissingAfterOperand = new Set([...Object.values(OperandErrors), BadHexIV]);

// The words a name at the end of a line might be the start of.
// TOP is not in the table: BASIC reads it as TO and a P.
const CompletionWords = new Map();
function completions(assembling, dialect) {
    const key = `${dialect.basicIV} ${assembling}`;
    if (!CompletionWords.has(key)) {
        const keywords = [...new Set([...dialect.keywords.map(kw => kw.keyword), "TOP"])];
        CompletionWords.set(
            key,
            assembling ? [...new Set([...keywords, ...mnemonicsFor(dialect)])] : keywords,
        );
    }
    return CompletionWords.get(key);
}

const AnotherArgument = "a comma or a closing )";

// What might be typed before a ) to supply what is missing: an operand, or more arguments.
const Fillers = ["1", "A", "A$", ",1", "1,1", ",1,1"];

export const ColorSpelling = "COLOR";
const ColourSpelling = "COLOUR";

// `at` is the token that was next when BASIC stopped.
class Failure {
    constructor(message, token, unfinished, at, explanation, code) {
        this.message = message;
        this.token = token;
        this.unfinished = unfinished;
        this.at = at;
        this.explanation = explanation;
        this.code = code;
    }
}

// Whether the text starts with one statement that BASIC reads to its end, with no error and not too soon.
function readsStatement(text, dialect) {
    const probe = new Recogniser(text, false, dialect, true);
    try {
        probe.statement();
        return probe.atEnd();
    } catch (e) {
        if (e instanceof Failure) return false;
        throw e;
    }
}

export class Recogniser {
    constructor(text, inAssembler, dialect, probing = false) {
        this.dialect = dialect;
        this.lexer = new Lexer(text, dialect);
        this.basicIV = dialect.basicIV;
        this.assembler = new Assembler(this);
        this.inAssembler = inAssembler;
        // Whether the assembler is reading the statements of a block.
        this.assembling = false;
        this.startsInAssembler = inAssembler;
        this.probing = probing;
        this.depth = 0;
        this.last = null;
        // The "[" that opened the assembler block this line leaves open, if it did.
        this.opener = null;
        // Each statement's error: {message, token, unfinished}, in the order of the line.
        this.problems = [];
        // Where the names that were read as COLOR (the Model B's alias for COLOUR) start.
        this.colors = [];
    }

    get tokens() {
        return this.lexer.tokens;
    }

    peek(n = 0) {
        return this.lexer.peek(n);
    }

    next() {
        const token = this.lexer.next();
        if (token.kind !== "end") this.last = token;
        return token;
    }

    is(kind, ...texts) {
        const token = this.peek();
        return token.kind === kind && (texts.length === 0 || texts.includes(token.text));
    }

    isPunct(...texts) {
        return this.is("punct", ...texts);
    }

    isKeyword(...keywords) {
        const token = this.peek();
        return token.kind === "keyword" && keywords.includes(token.kw.keyword);
    }

    // Whether the next token follows the last with no space between.
    adjacent() {
        return !this.peek().spaced;
    }

    // `message` is the ROM's error, and `explanation` says what is wrong where the ROM's error alone would not. The
    // error is unfinished if the line ends where the text is wrong. `code` names the quick fix that mends it.
    fail(
        message,
        token = this.peek(),
        unfinished = token.kind === "end",
        explanation = undefined,
        code = undefined,
    ) {
        throw new Failure(message, token, unfinished, this.peek(), explanation, code);
    }

    expectPunct(text, message = ExpectedPunct[text]) {
        if (!this.isPunct(text)) this.fail(message);
        return this.next();
    }

    // The end of a statement: the end of the line, a colon or ELSE.
    atEnd() {
        return this.endsStatement(this.peek());
    }

    endsStatement(token) {
        if (token.kind === "punct") return token.text === ":";
        if (token.kind === "keyword") return token.kw.keyword === "ELSE";
        return token.kind === "end";
    }

    // Reads the whole line and marks its errors; returns whether an assembler block is open at its end.
    line() {
        this.waitingForElse = false;
        if (this.inAssembler) this.inAssembler = this.assembler.block();
        while (!this.is("end")) {
            const statementStart = this.peek();
            try {
                this.depth = 0;
                this.statement();
                if (this.isKeyword("ELSE")) {
                    const token = this.next();
                    // BASIC skips the rest of the line at an ELSE it runs into; an IF or ON jumps past the first one after it.
                    if (!this.waitingForElse) {
                        this.markStray(token);
                        return this.skipLine();
                    }
                    this.waitingForElse = false;
                    if (this.is("linenum")) this.next();
                    continue;
                }
                if (!this.atEnd()) this.failBeforeKeyword("Syntax error");
            } catch (e) {
                this.recover(e, statementStart, () => this.atEnd());
            }
            if (this.isPunct(":")) this.next();
        }
        return this.inAssembler;
    }

    // Marks the statement that failed, and skips what is left of it.
    recover(e, statementStart, atEnd, assembling = false) {
        if (!(e instanceof Failure)) throw e;
        const problem = this.mark(e, statementStart, assembling);
        while (!atEnd()) this.next();
        this.redden(problem);
    }

    // BASIC stops at the first error of a line, so an ELSE after one is never read.
    markStray(token) {
        if (this.problems.every(problem => problem.stricter)) this.stricter(token, StrayElse);
    }

    // Marks a token that BASIC accepts but that is almost certainly a mistake; the problem's text starts at `from`.
    stricter(token, message, code, from = token) {
        token.invalid = true;
        this.problems.push({
            message,
            token: from,
            end: token.end,
            unfinished: false,
            hole: false,
            stricter: true,
            code,
        });
    }

    skipLine() {
        while (!this.is("end")) this.next();
        return this.inAssembler;
    }

    // An error at the end of a statement is shown on its last token, and one straight after a name that BASIC did not
    // read as an abbreviation (H.TO, where HIMEM cannot be followed by a letter) on the name.
    mark(failure, statementStart, assembling) {
        let {token} = failure;
        const {message, explanation, code} = failure;
        const ended = failure.unfinished || this.completable(token, statementStart, assembling);
        const hole = !ended && this.repairable(failure, statementStart);
        const unfinished = ended || hole;
        const atEnd = token.kind === "end" || token.text === ":" || token.kw?.keyword === "ELSE";
        const movedBack = atEnd && this.last !== null && this.last.start >= statementStart.start;
        // What is missing goes after the marked token, rather than in its place, where the mark moved back from the end
        // of the statement, and always for a string's closing quote and the digits after a &.
        const missingAfter = movedBack || MissingAfterOperand.has(message);
        if (movedBack) token = this.last;
        const tokens = this.lexer.tokens;
        const before = tokens[tokens.lastIndexOf(token) - 1];
        const after = token === this.peek() ? this.peek(1) : null;
        const adjacent = (first, second) => first && second && first.end === second.start;
        const marked = before && before.abbreviation && adjacent(before, token) ? before : token;
        const problem = {
            message,
            token: marked,
            end: marked.end,
            unfinished,
            hole,
            missingAfter,
            ...(explanation && {explanation}),
            ...(code && {code}),
        };
        this.problems.push(problem);
        if (unfinished) return problem;
        marked.invalid = true;
        // Both halves of an operator from another language, such as == or **.
        for (const [first, second] of [
            [before, token],
            [token, after],
        ]) {
            if (adjacent(first, second) && ForeignOperators.has(first.text + second.text))
                first.invalid = second.invalid = true;
        }
        return problem;
    }

    // BASIC never reads past the token it stopped at, so the rest of the statement, up to the next colon or ELSE (or
    // the "]" that closes an assembler block), is as wrong as that token; text that is not code stays as it is.
    redden(problem) {
        if (problem.unfinished) return;
        const stop = this.peek().start;
        let spaces = [];
        for (const token of this.lexer.tokens) {
            if (token.start <= problem.token.start || token.start >= stop) continue;
            if (token.kind === "white") spaces.push(token);
            else if (!NotCode.has(token.kind) && !TextKeyword.has(token.kw?.keyword)) {
                for (const space of spaces) space.invalid = true;
                token.invalid = true;
                problem.end = token.end;
            }
            if (token.kind !== "white") spaces = [];
        }
    }

    // Whether the name or keyword at the end of the line, or the keyword before a name that follows it with no space
    // (END, P), starts a longer keyword, or a mnemonic in an assembler block, that makes the statement valid (MOD is
    // MODE, TO is TOP).
    completable(token, statementStart, assembling) {
        const {text} = this.lexer;
        if (
            this.probing ||
            !["name", "keyword"].includes(token.kind) ||
            text.slice(token.end).trim()
        )
            return false;
        const tokens = this.lexer.tokens;
        const before = tokens[tokens.indexOf(token) - 1];
        const starts = [token.start];
        if (before?.kind === "keyword" && before.end === token.start) starts.push(before.start);
        return starts.some(start => {
            const typed = text.slice(start).toUpperCase();
            return completions(assembling, this.dialect).some(word => {
                if (word.length <= typed.length || !word.startsWith(typed)) return false;
                return this.valid(text.slice(0, start) + word, statementStart, text.length);
            });
        });
    }

    // Whether the text, a probe of the line with something added, has no error from the statement at `statementStart`
    // up to the next colon or ELSE after `from`, other than one where the line ends too soon unless `complete` is set.
    valid(candidate, statementStart, from, complete = false) {
        const probe = new Recogniser(candidate, this.startsInAssembler, this.dialect, true);
        probe.line();
        const stop =
            probe.tokens.find(
                token =>
                    token.start >= from &&
                    (token.kind === "punct" ? token.text === ":" : token.kw?.keyword === "ELSE"),
            )?.start ?? candidate.length;
        const inRange = start => start >= statementStart.start && start < stop;
        return (
            probe.problems.every(p => (p.unfinished && !complete) || !inRange(p.token.start)) &&
            !probe.tokens.some(token => token.invalid && inRange(token.start))
        );
    }

    // Whether the statement stopped at a ) with something missing before it: the argument an editor that closes
    // brackets has not been given yet (LEFT$(B$)). Text typed in front of existing text is not one: GOTO:PRINT is red,
    // as BASIC stops there, and no typing at the end of the line mends it.
    repairable({at}, statementStart) {
        if (this.probing || at.kind !== "punct" || at.text !== ")") return false;
        const head = this.lexer.text.slice(0, at.start);
        const tail = this.lexer.text.slice(at.start);
        return Fillers.some(filler => {
            const space = /[\w`$%]$/.test(head) && /^[\w`]/.test(filler) ? " " : "";
            const candidate = head + space + filler + tail;
            return this.valid(candidate, statementStart, candidate.length - tail.length);
        });
    }

    // Reads what the ROM words differently from the same text elsewhere (the arguments of a call, whose DEF may take
    // none; the operand after a ? or !, which a number cannot have), so an error in it has no message.
    unworded(read) {
        try {
            read();
        } catch (e) {
            if (e instanceof Failure) e.message = null;
            throw e;
        }
    }

    nested(read) {
        if (++this.depth > MaxDepth) this.fail(null, this.peek(), false);
        try {
            return read();
        } finally {
            this.depth--;
        }
    }

    statement() {
        this.nested(() => this.unnestedStatement());
    }

    unnestedStatement() {
        const token = this.peek();
        if (this.atEnd()) return;
        if (token.kind === "oscli") return void this.next();
        // BASIC reads * as a command wherever it starts a statement, though the tokeniser may not have seen one start
        // there (IFX REPEAT*FX15).
        if (this.isPunct("*")) return void this.lexer.raw(/.*/y, "oscli");
        if (this.isPunct("=")) {
            this.next();
            return this.expression();
        }
        if (this.isPunct("[")) {
            this.opener = this.next();
            this.inAssembler = this.assembler.block();
            // After the block's "]" a statement can follow with no colon.
            return this.inAssembler || this.statement();
        }
        if (token.kind === "name" && this.readsAsColor(token)) return this.statement();
        if (token.kind !== "keyword") return this.assignment();
        const {keyword} = token.kw;
        // EDIT is a command only to the prompt, so a program that reaches it stops there on BASIC IV, as on a line that
        // starts with any other command.
        if (!canStartStatement(this.dialect, token.kw) || keyword === "EDIT")
            this.fail("Syntax error");
        this.next();
        // The lexer has made these the statement forms of the pseudo-variables; EXT can only be BASIC IV's EXT#.
        if (pseudoVariables.has(keyword) || keyword === "EXT") return this.pseudoVariable(keyword);
        if (keyword in ExpressionCount) return this.expressions(ExpressionCount[keyword]);
        if (this[keyword]) return this[keyword]();
        while (!this.atEnd()) this.next();
    }

    // Whether the name that starts a statement is COLOR and an expression, which the dialect then reads as the keyword
    // (and the next statement() reads on from). That is only so where the name could not be read as itself: COLORS=7
    // assigns to a variable, and COLOR alone is a variable still to be typed.
    readsAsColor(name) {
        if (!this.dialect.usColor || !name.text.startsWith(ColorSpelling)) return false;
        const rest = this.lexer.source.slice(name.start);
        if (readsStatement(rest, BasicIIDialect)) return false;
        const colour = ColourSpelling + rest.slice(ColorSpelling.length);
        if (!readsStatement(colour, this.dialect)) return false;
        this.colors.push(name.start);
        this.lexer.relex(name);
        return true;
    }

    pseudoVariable(keyword) {
        if (keyword === "PTR" || keyword === "EXT") {
            this.expectPunct("#");
            this.operand();
        }
        this.timeString(keyword);
        this.expectPunct("=");
        this.expression();
    }

    // BASIC IV reads TIME$, the clock as a string, as one word, with the $ straight after TIME.
    timeString(keyword) {
        if (this.basicIV && keyword === "TIME" && this.isPunct("$") && this.adjacent())
            this.next().type = "keyword";
    }

    assignment() {
        this.variable();
        this.expectPunct("=");
        this.expression();
    }

    expressions(count) {
        for (let n = 0; n < count; n++) {
            if (n > 0) this.expectPunct(",");
            this.expression();
        }
    }

    // The arguments of a bracket, then its ")"; an unclosed bracket is shown at its "(".
    bracket(opener, fewest = 1, most = Infinity) {
        let count = 1;
        this.expression();
        while (this.isPunct(",")) {
            // BASIC stops at the comma before an argument too many, whatever follows it.
            if (count === most)
                this.fail(
                    "Missing )",
                    this.peek(),
                    false,
                    this.closedLater() ? TooMany : undefined,
                );
            this.next();
            this.expression();
            count++;
        }
        if (count < fewest) this.fail("Missing ,");
        this.close(
            opener,
            count === most || most === Infinity ? "Missing )" : null,
            count < most ? AnotherArgument : "a closing )",
        );
    }

    // Whether a ")" in the statement closes the bracket the next token is in.
    closedLater() {
        let depth = 0;
        for (let n = 0; ; n++) {
            const token = this.peek(n);
            if (this.assembling ? this.assembler.endsStatement(token) : this.endsStatement(token))
                return false;
            if (token.text === "(" || token.kw?.keyword.endsWith("(")) depth++;
            else if (token.text === ")" && depth-- === 0) return true;
        }
    }

    // The ")" of a bracket; an unclosed one is shown at its "(", and `needed` is what may follow the last argument.
    close(opener, message = "Missing )", needed = AnotherArgument) {
        if (this.isPunct(")")) return void this.next();
        if (!this.atEnd()) this.fail(message);
        this.fail(message, opener, this.is("end"), `Expected ${needed} after ${this.last.text}`);
    }

    name(message = "Syntax error") {
        if (!this.is("name")) this.fail(message);
        this.next();
        if (this.isPunct("(") && this.adjacent()) this.bracket(this.next());
    }

    // Something that can be assigned to: X, X(1), $X, ?X, X?1, ?X!1, X?Y?Z (but X?1?2=3 is a Mistake).
    variable(message) {
        if (this.isPunct("$")) {
            this.next();
            return this.primary();
        }
        if (this.isPunct("?", "!")) {
            this.next();
            this.primary();
        } else this.name(message);
        if (this.isPunct("?", "!") && this.adjacent()) {
            this.next();
            this.unworded(() => this.operand());
        }
    }

    expression() {
        this.relation();
        while (this.isKeyword("AND", "OR", "EOR")) {
            const operator = this.next();
            this.numeric(operator, this.type, "before");
            this.relation();
            this.numeric(operator, this.type, "after");
            this.type = Num;
        }
    }

    // BASIC raises "Type mismatch" when it runs a line (not when it reads it) that gives a string to something that
    // wants a number, or the other way round, so these are stricter than the ROM.
    mismatch(token, message) {
        if (!token.invalid) this.stricter(token, `Type mismatch: ${message}`);
    }

    numeric(operator, type, side) {
        const what = operator.kw ? operator.kw.keyword : operator.text;
        if (type === Str)
            this.mismatch(operator, `${what} needs numbers, but ${type} is ${side} it`);
    }

    // BASIC compares only two values: X<Y<Z is an error.
    relation() {
        this.sum();
        if (this.peek().kind === "punct" && Relations.has(this.peek().text)) {
            const left = this.type;
            const operator = this.next();
            this.sum();
            if (left && this.type && left !== this.type)
                this.mismatch(
                    operator,
                    `${operator.text} cannot compare ${left} with ${this.type}`,
                );
            this.type = Num;
        }
    }

    sum() {
        this.operand();
        let left = this.type;
        while (
            (this.peek().kind === "punct" && Arithmetic.has(this.peek().text)) ||
            this.isKeyword("MOD", "DIV")
        ) {
            const operator = this.next();
            const adds = operator.text === "+";
            if (!adds) this.numeric(operator, left, "before");
            this.operand();
            if (!adds) this.numeric(operator, this.type, "after");
            else if (left && this.type && left !== this.type)
                this.mismatch(operator, `+ cannot add ${this.type} to ${left}`);
            left = adds ? (left === this.type ? left : undefined) : Num;
        }
        this.type = left;
    }

    // A ? or ! between two values must touch the first, which must be a variable: X=D ?1 and X=1?D are errors. What
    // follows is an operand in turn, so X?Y?Z is fine and X?1?Z is not. Returns whether a ? or ! can follow.
    operand() {
        const variable = this.primary();
        if (!variable || !this.isPunct("?", "!") || !this.adjacent()) return variable;
        this.next();
        this.unworded(() => this.operand());
        this.type = undefined;
        return false;
    }

    primary() {
        return this.nested(() => this.unnestedPrimary());
    }

    unnestedPrimary() {
        const token = this.peek();
        this.type = undefined;
        if (this.isPunct("?", "!", "$")) {
            this.next();
            this.primary();
            this.type = token.text === "$" ? Str : Num;
            return token.text !== "$";
        }
        // One sign only: BASIC rejects --1 and -+1.
        if (this.isPunct("-", "+")) {
            this.next();
            if (this.isPunct("-", "+")) this.fail("No such variable");
            return this.primary();
        }
        if (this.isPunct("(")) return this.bracket(this.next(), 1, 1);
        if (token.kind === "number" || (token.kind === "string" && token.closed)) {
            this.next();
            this.type = token.kind === "string" ? Str : Num;
            return;
        }
        if (token.kind === "hex" && token.text.length > 1) {
            this.next();
            this.type = Num;
            return;
        }
        if (token.kind === "name") {
            this.name();
            this.type = typeOfName(token.text);
            return true;
        }
        if (token.kind !== "keyword" || isStatementKeyword(token.kw))
            this.fail(this.operandError(token), token, this.unfinishedOperand(token));
        this.next();
        const {keyword} = token.kw;
        this.timeString(keyword);
        const result = typeOfKeyword(keyword);
        if (NoArgument.has(keyword)) return void (this.type = result);
        if (OneArgument.has(keyword)) return this.argument(token, result);
        if (ChannelFunction.has(keyword)) {
            this.expectPunct("#");
            const variable = this.operand();
            this.type = Num;
            return variable;
        }
        if (keyword in BracketFunction) {
            this.bracket(token, ...BracketFunction[keyword]);
            return void (this.type = result);
        }
        if (keyword === "RND") {
            if (this.isPunct("(") && this.adjacent()) this.bracket(this.next(), 1, 1);
            return void (this.type = Num);
        }
        if (keyword === "STR$") {
            if (this.isPunct("~")) this.next().type = "operator";
            return this.argument(token, Str);
        }
        if (keyword === "FN") return (this.call(), void (this.type = undefined));
        if (keyword === "TO" && this.top()) return void (this.type = Num);
        this.fail("No such variable", token);
    }

    // The operand of a function that takes one value, and what the function gives.
    argument(token, result) {
        const keyword = token.kw.keyword;
        const wanted = StringArgument.has(keyword) ? Str : Num;
        const variable = this.operand();
        if (!AnyArgument.has(keyword) && this.type && this.type !== wanted)
            this.mismatch(token, `${keyword} needs ${wanted}, but is given ${this.type}`);
        this.type = result;
        return variable;
    }

    operandError(token) {
        if (token.kind === "hex" && this.basicIV) return BadHexIV;
        return OperandErrors[token.kind] || "No such variable";
    }

    // The end of the line, or text that can still be finished: a string with no end yet, or a & with no digits.
    unfinishedOperand(token) {
        return (
            token.kind === "end" ||
            (token.end === this.lexer.text.length && ["string", "hex"].includes(token.kind))
        );
    }

    // TO followed by P is TOP where a value is expected.
    top() {
        const after = this.peek();
        if (after.kind !== "name" || after.text[0] !== "P" || !this.adjacent()) return false;
        this.lexer.split(after, 1);
        this.last.top = true;
        this.next().type = "keyword";
        return true;
    }

    // Whether "(" after a space is the call's depends on the DEF: FNg (1) is fine if FNg has a parameter.
    call() {
        if (this.is("fnname")) this.next();
        if (this.isPunct("(")) this.unworded(() => this.bracket(this.next()));
    }

    // TAB( and SPC, which only PRINT and INPUT take.
    printItem() {
        if (this.isKeyword("TAB(")) return (this.bracket(this.next(), 1, 2), true);
        if (this.isKeyword("SPC")) return (this.next(), this.operand(), true);
        return false;
    }

    separator(...texts) {
        if (!this.isPunct(...texts)) return false;
        this.next().type = "operator";
        return true;
    }

    PRINT() {
        if (this.isPunct("#")) {
            this.next();
            this.expressions(1);
            while (this.isPunct(",")) {
                this.next();
                this.expression();
            }
            return;
        }
        // An item is a value, and can directly follow another (PRINT X"a"); ~ (hex) can start any item.
        for (;;) {
            if (this.separator("'", ",", ";", "~") || this.printItem()) continue;
            if (this.atEnd()) return;
            this.expression();
        }
    }

    INPUT() {
        if (this.isPunct("#")) {
            this.next();
            this.expression();
            while (this.isPunct(",")) {
                this.next();
                this.variable();
            }
            return;
        }
        if (this.isKeyword("LINE")) this.next();
        for (;;) {
            if (this.separator("'", ",", ";") || this.printItem()) continue;
            if (this.atEnd()) return;
            const prompt = this.peek();
            if (prompt.kind !== "string") this.variable();
            else if (prompt.closed) this.next();
            else this.fail('Missing "', prompt, true);
        }
    }

    // Items need nothing between them (VDU 1 2), and one comma or semicolon may follow each (VDU 1,,2 is an error). BASIC IV
    // also ends an item with a |, which sends nine zeros.
    VDU() {
        while (!this.atEnd()) {
            this.expression();
            if (this.basicIV) this.separator(",", ";", "|");
            else this.separator(",", ";");
        }
    }

    // A line number, or an expression that gives one; GOSUB is the same.
    GOTO() {
        if (this.is("linenum")) this.next();
        else this.expression();
    }

    RESTORE() {
        if (!this.atEnd()) this.GOTO();
    }

    TRACE() {
        if (this.isKeyword("ON", "OFF")) this.next();
        else this.GOTO();
    }

    ON() {
        if (this.isKeyword("ERROR")) {
            this.next();
            if (this.isKeyword("OFF")) return void this.next();
            return this.statement();
        }
        this.expression();
        if (!this.isKeyword(...this.dialect.onBranches)) this.failBeforeKeyword("ON syntax");
        const procedures = this.next().kw.keyword === "PROC";
        let from = this.peek().start;
        let target = this.onTarget(procedures);
        this.waitingForElse = true;
        for (;;) {
            // BASIC counts the commas of the list in the raw text, so past a comma inside a string we cannot tell
            // which target it is reading and mark nothing more.
            if (this.stringComma(from)) break;
            this.ignoredAfter(target);
            if (this.stringComma(from)) break;
            if (!this.isPunct(",")) return;
            this.next();
            from = this.peek().start;
            if (procedures && !this.isKeyword("PROC")) break;
            // BASIC reads only the target it counts to, so a later one that does not parse is not an error.
            try {
                if (procedures) this.next();
                target = this.onTarget(procedures);
            } catch (e) {
                if (!(e instanceof Failure)) throw e;
                break;
            }
        }
        while (!this.atEnd()) this.next();
    }

    // Whether a string with a comma in it lies between `from` and the next token.
    stringComma(from) {
        const text = this.lexer.text.slice(from, this.peek().start);
        return (text.match(/"(?:[^"]|"")*"/g) ?? []).some(string => string.includes(","));
    }

    // Reads a target of an ON list and returns what it is.
    onTarget(procedures) {
        if (procedures) {
            this.call();
            return OnTargets.procedure;
        }
        const target = this.is("linenum") ? OnTargets.lineNumber : OnTargets.expression;
        this.GOTO();
        return target;
    }

    // BASIC jumps once it has a target and skips the others by their commas, so what follows a target up to the next
    // comma is never read. The first of it is marked, as it is after an assembler instruction.
    ignoredAfter(target) {
        if (this.atEnd() || this.isPunct(",")) return;
        const token = this.peek();
        const code = this.spaceFix(token);
        const keyword = SpacedKeywords.find(word => token.text.startsWith(word));
        const message = code
            ? `${token.text} is read as a name, not the keyword ${keyword}: BASIC recognises a keyword only at the start of a word, and there is no space before this one. ${target}; probably a space was meant before ${keyword}`
            : `${target}; probably a space or comma is missing`;
        this.stricter(this.next(), message, code ?? IgnoredInOnListCode);
        while (!this.atEnd() && !this.isPunct(",")) this.next();
    }

    IF() {
        this.waitingForElse = true;
        this.expression();
        if (this.isKeyword("THEN")) {
            this.next();
            if (this.is("linenum")) return void this.next();
        }
        this.statement();
    }

    FOR() {
        this.variable(null);
        this.expectPunct("=");
        this.expression();
        if (!this.isKeyword("TO")) this.failBeforeKeyword("No TO");
        this.next();
        this.expression();
        if (this.isKeyword("STEP")) {
            this.next();
            this.expression();
        }
    }

    // BASIC reads a keyword after a number such as 2E4 as part of a name: fails at the token, with the quick fix that
    // inserts a space before the keyword if there is one.
    failBeforeKeyword(message) {
        const token = this.peek();
        this.fail(message, token, undefined, undefined, this.spaceFix(token));
    }

    // The quick fix code for a name that starts with a keyword, if a space before it leaves the statement with no
    // error (other than a line that ends too soon).
    spaceFix(token) {
        if (
            this.probing ||
            token.kind !== "name" ||
            !SpacedKeywords.some(keyword => token.text.startsWith(keyword)) ||
            (token.text.startsWith("ELSE") && !this.waitingForElse)
        )
            return undefined;
        const {text} = this.lexer;
        const candidate = `${text.slice(0, token.start)} ${text.slice(token.start)}`;
        return this.valid(candidate, token, token.start) ? SpaceBeforeKeywordCode : undefined;
    }

    NEXT() {
        while (this.is("name") || this.isPunct(",")) this.next();
    }

    REPEAT() {
        this.statement();
    }

    DIM() {
        do {
            if (this.isPunct(",")) this.next();
            if (!this.is("name")) this.fail(null);
            this.next();
            if (this.isPunct("(") && this.adjacent()) this.bracket(this.next());
            else this.expression();
        } while (this.isPunct(","));
    }

    // BASIC only reads a DEF when it looks for the FN or PROC it defines.
    DEF() {
        const token = this.peek();
        if (token.kind !== "keyword" || !isFnProc(token.kw)) return void this.skipLine();
        this.next();
        if (this.is("fnname")) this.next();
        if (this.isPunct("(")) {
            const opener = this.next();
            this.variables();
            this.close(opener);
        }
        this.statement();
    }

    PROC() {
        this.call();
    }

    variables() {
        this.variable(null);
        while (this.isPunct(",")) {
            this.next();
            this.variable(null);
        }
    }

    LOCAL() {
        this.variables();
    }

    // READ takes empty items (READ A,,B) and none at all.
    READ() {
        while (!this.atEnd()) {
            if (!this.isPunct(",")) this.variable(null);
            if (!this.atEnd()) this.expectPunct(",", "Syntax error");
        }
    }

    CALL() {
        this.expression();
        while (this.isPunct(",")) {
            this.next();
            this.variable("No such variable");
        }
    }

    LET() {
        this.assignment();
    }

    CLOSE() {
        this.expectPunct("#");
        this.expression();
    }

    BPUT() {
        this.expectPunct("#");
        this.expression();
        this.expectPunct(",");
        this.expression();
    }
}

Recogniser.prototype.GOSUB = Recogniser.prototype.GOTO;

// Reads a line that stops where the text does, and notes the keywords BASIC looks for there and whether a statement
// can start there, for completions.
export class ExpectingRecogniser extends Recogniser {
    constructor(text, inAssembler, dialect) {
        super(text, inAssembler, dialect);
        this.words = new Set();
        this.statementNext = false;
    }

    isKeyword(...keywords) {
        if (this.peek().kind === "end") for (const keyword of keywords) this.words.add(keyword);
        return super.isKeyword(...keywords);
    }

    statement() {
        if (this.peek().kind === "end") this.statementNext = true;
        super.statement();
    }
}
