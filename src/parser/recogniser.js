// Reads a line of BBC BASIC II as the interpreter does, by recursive descent over the lexer's tokens, and marks the
// token at which BASIC would stop with an error: one per statement, then on to the next colon, as BASIC reports only
// the first. Where there is no rule for a statement, anything is accepted.
import {Assembler, Mnemonics} from "./assembler.js";
import {keywords} from "../tokens.js";
import {Lexer} from "./lexer.js";

const FirstStatementToken = 0xc6;
// Recursion deeper than this is an error: the 6502's stack gives out long before it.
const MaxDepth = 64;

const names = text => new Set(text.split(" "));
const NoArgument = names("PI TRUE FALSE POS VPOS COUNT ERL ERR TIME PAGE LOMEM HIMEM GET GET$");
const OneArgument = names(
    "ABS ACS ADVAL ASC ASN ATN CHR$ COS DEG EVAL EXP INKEY INKEY$ INT LEN LN LOG NOT RAD SGN SIN SQR TAN USR VAL " +
        "OPENIN OPENOUT OPENUP",
);
const ChannelFunction = names("BGET EOF EXT PTR");
const PseudoVariables = names("PTR PAGE TIME LOMEM HIMEM");
// The fewest and most arguments of the functions whose keyword ends in "(".
const BracketFunction = {
    "INSTR(": [2, 3],
    "LEFT$(": [2, 2],
    "MID$(": [2, 3],
    "RIGHT$(": [2, 2],
    "STRING$(": [2, 2],
    "POINT(": [2, 2],
};
// The number of expressions each of these statements takes.
const ExpressionCount = {
    ...Object.fromEntries(
        "CLEAR CLG CLS END ENDPROC NEW OLD REPORT RETURN RUN STOP"
            .split(" ")
            .map(name => [name, 0]),
    ),
    ...Object.fromEntries("CHAIN COLOUR MODE OSCLI UNTIL WIDTH".split(" ").map(name => [name, 1])),
    GCOL: 2,
    MOVE: 2,
    DRAW: 2,
    PLOT: 3,
    SOUND: 4,
    ENVELOPE: 14,
};
const ForeignOperator = /^(?:[=!]=|\*\*|><|=[<>]|[-+/*^]=|<<|>>)$/;
const Relations = names("= < > <= >= <>");
const Arithmetic = names("+ - * / ^");

// `unfinished` is an error only because the line ends: more text could still make it valid.
// What the ROM says when it does not find the punctuation, and when what should be an operand is a & with no digits or
// a string with no end.
const ExpectedPunct = {",": "Missing ,", "=": "Mistake", "#": "Missing #"};
const OperandErrors = {hex: "Bad HEX", string: 'Missing "'};

// The words a name at the end of a line might be the start of.
const Completions = [...new Set([...keywords.map(kw => kw.keyword), ...Mnemonics])];

export class Failure {
    constructor(message, token, unfinished) {
        this.message = message;
        this.token = token;
        this.unfinished = unfinished;
    }
}

export class Recogniser {
    constructor(text, inAssembler, probing = false) {
        this.lexer = new Lexer(text);
        this.assembler = new Assembler(this);
        this.inAssembler = inAssembler;
        this.startsInAssembler = inAssembler;
        this.probing = probing;
        this.depth = 0;
        this.last = null;
        // Each statement's error: {message, token, unfinished}, in the order of the line.
        this.problems = [];
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

    // `message` is the ROM's error. The error is unfinished if the line ends where the text is wrong.
    fail(message, token = this.peek(), unfinished = token.kind === "end") {
        throw new Failure(message, token, unfinished);
    }

    expectPunct(text, message = ExpectedPunct[text]) {
        if (!this.isPunct(text)) this.fail(message);
        return this.next();
    }

    // The end of a statement: the end of the line, a colon or ELSE.
    atEnd() {
        return this.is("end") || this.isPunct(":") || this.isKeyword("ELSE");
    }

    // Reads the whole line and marks its errors; returns whether an assembler block is open at its end.
    line() {
        this.elseIsBranch = false;
        if (this.inAssembler) this.inAssembler = this.assembler.block();
        while (!this.is("end")) {
            const statementStart = this.peek();
            try {
                this.depth = 0;
                this.statement();
                if (this.isKeyword("ELSE")) {
                    this.next();
                    // BASIC skips the rest of the line at an ELSE it runs into; only IF and ON jump past one.
                    if (!this.elseIsBranch) return this.skipLine();
                    if (this.is("linenum")) this.next();
                    continue;
                }
                if (!this.atEnd()) this.fail("Syntax error");
            } catch (e) {
                if (!(e instanceof Failure)) throw e;
                this.mark(e, statementStart);
                while (!this.atEnd()) this.next();
            }
            if (this.isPunct(":")) this.next();
        }
        return this.inAssembler;
    }

    skipLine() {
        while (!this.is("end")) this.next();
        return this.inAssembler;
    }

    // An error at the end of a statement is shown on its last token, and one straight after a name that BASIC did not
    // read as an abbreviation (H.TO, where HIMEM cannot be followed by a letter) on the name.
    mark(failure, statementStart) {
        let {token} = failure;
        const {message} = failure;
        const unfinished = failure.unfinished || this.completable(token, statementStart);
        const atEnd = token.kind === "end" || token.text === ":" || token.kw?.keyword === "ELSE";
        if (atEnd && this.last && this.last.start >= statementStart.start) token = this.last;
        const tokens = this.lexer.tokens;
        const before = tokens[tokens.lastIndexOf(token) - 1];
        const after = token === this.peek() ? this.peek(1) : null;
        const adjacent = (first, second) => first && second && first.end === second.start;
        const marked = before && before.abbreviation && adjacent(before, token) ? before : token;
        this.problems.push({message, token: marked, unfinished});
        if (unfinished) return;
        marked.invalid = true;
        // Both halves of an operator from another language, such as == or **.
        for (const [first, second] of [
            [before, token],
            [token, after],
        ]) {
            if (adjacent(first, second) && ForeignOperator.test(first.text + second.text))
                first.invalid = second.invalid = true;
        }
    }

    // Whether the name at the end of the line, or the keyword before it that it follows with no space (END, P), starts a
    // keyword or mnemonic that makes the statement valid.
    completable(token, statementStart) {
        const {text} = this.lexer;
        if (this.probing || token.kind !== "name" || text.slice(token.end).trim()) return false;
        const tokens = this.lexer.tokens;
        const before = tokens[tokens.indexOf(token) - 1];
        const starts = [token.start];
        if (before?.kind === "keyword" && before.end === token.start) starts.push(before.start);
        return starts.some(start => {
            const typed = text.slice(start).toUpperCase();
            return Completions.some(word => {
                if (word.length <= typed.length || !word.startsWith(typed)) return false;
                const probe = new Recogniser(
                    text.slice(0, start) + word,
                    this.startsInAssembler,
                    true,
                );
                probe.line();
                return probe.problems.every(
                    p => p.unfinished || p.token.start < statementStart.start,
                );
            });
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
            read();
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
            this.next();
            this.inAssembler = this.assembler.block();
            // After the block's "]" a statement can follow with no colon.
            return this.inAssembler || this.statement();
        }
        if (token.kind !== "keyword") return this.assignment();
        const {keyword} = token.kw;
        if (token.kw.token < FirstStatementToken) this.fail("Syntax error");
        this.next();
        // The lexer has made these the statement forms of the pseudo-variables.
        if (PseudoVariables.has(keyword)) return this.pseudoVariable(keyword);
        if (keyword in ExpressionCount) return this.expressions(ExpressionCount[keyword]);
        if (this[keyword]) return this[keyword]();
        while (!this.atEnd()) this.next();
    }

    pseudoVariable(keyword) {
        if (keyword === "PTR") {
            this.expectPunct("#");
            this.operand();
        }
        this.expectPunct("=");
        this.expression();
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
            const comma = this.next();
            // RND(1, is wrong however it goes on.
            if (count >= most && this.is("end")) this.fail("Missing )", comma, false);
            this.expression();
            count++;
        }
        if (count < fewest) this.fail("Missing ,");
        if (count > most) this.fail("Missing )", this.peek(), false);
        this.close(opener, count === most || most === Infinity ? "Missing )" : null);
    }

    // The ")" of a bracket; an unclosed one is shown at its "(".
    close(opener, message = "Missing )") {
        if (!this.isPunct(")"))
            this.fail(message, this.atEnd() ? opener : this.peek(), this.is("end"));
        this.next();
    }

    name(message = "Syntax error") {
        if (!this.is("name")) this.fail(message);
        this.next();
        if (this.isPunct("(") && this.adjacent()) this.bracket(this.next());
    }

    // Something that can be assigned to: X, X(1), $X, ?X, X?1, ?X!1. Only one ? or ! follows the first (X?1?2=3 is a
    // Mistake).
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
            this.unworded(() => this.primary());
        }
    }

    expression() {
        this.relation();
        while (this.isKeyword("AND", "OR", "EOR")) {
            this.next();
            this.relation();
        }
    }

    // BASIC compares only two values: X<Y<Z is an error.
    relation() {
        this.sum();
        if (this.peek().kind === "punct" && Relations.has(this.peek().text)) {
            this.next();
            this.sum();
        }
    }

    sum() {
        this.operand();
        while (
            (this.peek().kind === "punct" && Arithmetic.has(this.peek().text)) ||
            this.isKeyword("MOD", "DIV")
        ) {
            this.next();
            this.operand();
        }
    }

    // A ? or ! between two values must touch the first: X=D ?1 is an error.
    operand() {
        this.primary();
        while (this.isPunct("?", "!") && this.adjacent()) {
            this.next();
            this.unworded(() => this.primary());
        }
    }

    primary() {
        this.nested(() => this.unnestedPrimary());
    }

    unnestedPrimary() {
        const token = this.peek();
        if (this.isPunct("?", "!", "$")) {
            this.next();
            return this.primary();
        }
        // One sign only: BASIC rejects --1 and -+1.
        if (this.isPunct("-", "+")) {
            this.next();
            if (this.isPunct("-", "+")) this.fail("No such variable");
            return this.primary();
        }
        if (this.isPunct("(")) return this.bracket(this.next(), 1, 1);
        if (token.kind === "number" || (token.kind === "string" && token.closed))
            return void this.next();
        if (token.kind === "hex" && token.text.length > 1) return void this.next();
        if (token.kind === "name") return this.name();
        if (token.kind !== "keyword" || token.kw.token >= FirstStatementToken)
            this.fail(
                OperandErrors[token.kind] || "No such variable",
                token,
                this.unfinishedOperand(token),
            );
        this.next();
        const {keyword} = token.kw;
        if (NoArgument.has(keyword)) return;
        if (OneArgument.has(keyword)) return this.operand();
        if (ChannelFunction.has(keyword)) {
            this.expectPunct("#");
            return this.operand();
        }
        if (keyword in BracketFunction) return this.bracket(token, ...BracketFunction[keyword]);
        if (keyword === "RND") {
            if (this.isPunct("(") && this.adjacent()) this.bracket(this.next(), 1, 1);
            return;
        }
        if (keyword === "STR$") {
            if (this.isPunct("~")) this.next().type = "operator";
            return this.operand();
        }
        if (keyword === "FN") return this.call();
        if (keyword === "TO" && this.top()) return;
        this.fail("No such variable", token, false);
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
        if (this.isKeyword("TAB(")) return this.bracket(this.next(), 1, 2), true;
        if (this.isKeyword("SPC")) return this.next(), this.operand(), true;
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
        while (!this.atEnd()) {
            if (!this.separator("'", ",", ";", "~") && !this.printItem()) this.expression();
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
        while (!this.atEnd()) {
            if (this.separator("'", ",", ";") || this.printItem()) continue;
            const prompt = this.peek();
            if (prompt.kind !== "string") this.variable();
            else if (prompt.closed) this.next();
            else this.fail('Missing "', prompt, true);
        }
    }

    // Items need nothing between them (VDU 1 2), and one comma or semicolon may follow each (VDU 1,,2 is an error).
    VDU() {
        while (!this.atEnd()) {
            this.expression();
            this.separator(",", ";");
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
        if (!this.isKeyword("GOTO", "GOSUB")) this.fail("ON syntax");
        this.next();
        this.GOTO();
        // BASIC jumps as soon as it has found its target, so it never reads the rest of the list.
        while (!this.atEnd()) this.next();
        this.elseIsBranch = true;
    }

    IF() {
        this.elseIsBranch = true;
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
        if (!this.isKeyword("TO")) this.fail("No TO");
        this.next();
        this.expression();
        if (this.isKeyword("STEP")) {
            this.next();
            this.expression();
        }
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
        if (!this.isKeyword("FN", "PROC")) return void this.skipLine();
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
