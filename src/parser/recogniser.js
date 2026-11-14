// Reads a line of BBC BASIC II as the interpreter does, by recursive descent over the lexer's tokens, and marks the
// token at which BASIC would stop with an error: one per statement, then on to the next colon, as BASIC reports only
// the first. Where there is no rule for a statement, anything is accepted.
import {Assembler} from "./assembler.js";
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

export class Failure {
    constructor(token) {
        this.token = token;
    }
}

export class Recogniser {
    constructor(text, inAssembler) {
        this.lexer = new Lexer(text);
        this.assembler = new Assembler(this);
        this.inAssembler = inAssembler;
        this.depth = 0;
        this.last = null;
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

    fail(token = this.peek()) {
        throw new Failure(token);
    }

    expectPunct(text) {
        if (!this.isPunct(text)) this.fail();
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
                if (!this.atEnd()) this.fail();
            } catch (e) {
                if (!(e instanceof Failure)) throw e;
                this.mark(e.token, statementStart);
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
    mark(token, statementStart) {
        const atEnd = token.kind === "end" || token.text === ":" || token.kw?.keyword === "ELSE";
        if (atEnd && this.last && this.last.start >= statementStart.start) token = this.last;
        const tokens = this.lexer.tokens;
        const before = tokens[tokens.lastIndexOf(token) - 1];
        const after = token === this.peek() ? this.peek(1) : null;
        const adjacent = (first, second) => first && second && first.end === second.start;
        (before && before.abbreviation && adjacent(before, token) ? before : token).invalid = true;
        // Both halves of an operator from another language, such as == or **.
        for (const [first, second] of [
            [before, token],
            [token, after],
        ]) {
            if (adjacent(first, second) && ForeignOperator.test(first.text + second.text))
                first.invalid = second.invalid = true;
        }
    }

    nested(read) {
        if (++this.depth > MaxDepth) this.fail();
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
        if (token.kw.token < FirstStatementToken) this.fail();
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
            this.next();
            this.expression();
            count++;
        }
        if (count < fewest || count > most) this.fail();
        if (!this.isPunct(")")) this.fail(this.atEnd() ? opener : this.peek());
        this.next();
    }

    name() {
        if (!this.is("name")) this.fail();
        this.next();
        if (this.isPunct("(") && this.adjacent()) this.bracket(this.next());
    }

    // Something that can be assigned to: X, X(1), $X, ?X, X?1, ?X!1. Only one ? or ! follows the first (X?1?2=3 is a
    // Mistake).
    variable() {
        if (this.isPunct("$")) {
            this.next();
            return this.primary();
        }
        if (this.isPunct("?", "!")) {
            this.next();
            this.primary();
        } else this.name();
        if (this.isPunct("?", "!") && this.adjacent()) {
            this.next();
            this.primary();
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
            this.primary();
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
            if (this.isPunct("-", "+")) this.fail();
            return this.primary();
        }
        if (this.isPunct("(")) return this.bracket(this.next(), 1, 1);
        if (token.kind === "number" || (token.kind === "string" && token.closed))
            return void this.next();
        if (token.kind === "hex" && token.text.length > 1) return void this.next();
        if (token.kind === "name") return this.name();
        if (token.kind !== "keyword" || token.kw.token >= FirstStatementToken) this.fail();
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
        this.fail(token);
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
        if (this.isPunct("(")) this.bracket(this.next());
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
            if (this.is("string") && this.peek().closed) this.next();
            else this.variable();
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
        if (!this.isKeyword("GOTO", "GOSUB")) this.fail();
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
        this.variable();
        this.expectPunct("=");
        this.expression();
        if (!this.isKeyword("TO")) this.fail();
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
            if (!this.is("name")) this.fail();
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
            if (!this.isPunct(")")) this.fail(this.atEnd() ? opener : this.peek());
            this.next();
        }
        this.statement();
    }

    PROC() {
        this.call();
    }

    variables() {
        this.variable();
        while (this.isPunct(",")) {
            this.next();
            this.variable();
        }
    }

    LOCAL() {
        this.variables();
    }

    // READ takes empty items (READ A,,B) and none at all.
    READ() {
        while (!this.atEnd()) {
            if (!this.isPunct(",")) this.variable();
            if (!this.atEnd()) this.expectPunct(",");
        }
    }

    CALL() {
        this.expression();
        while (this.isPunct(",")) {
            this.next();
            this.variable();
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
