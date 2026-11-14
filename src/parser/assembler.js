// The assembler between [ and ], as BBC BASIC II reads it: each statement is an optional label, then a mnemonic or
// directive, then its operand. A "\" comment can start a statement, and a ";" comment can follow a complete
// instruction; either runs to the next colon.
//
// Stricter than the ROM, on purpose: BASIC ignores the rest of a statement after a complete instruction, but a keyword
// there that an expression cannot use is marked, since it is almost always a mistake (NOP PRINT).

const words = text => new Set(text.split(" "));
const Implied = words(
    "BRK CLC CLD CLI CLV DEX DEY INX INY NOP PHA PHP PLA PLP RTI RTS SEC SED SEI TAX TAY TSX TXA TXS TYA",
);
const Shifts = words("ASL LSR ROL ROR");
// Mnemonics whose operand can be immediate, indirect or indexed.
const Addressed = words("ADC AND BIT CMP CPX CPY DEC EOR INC LDA LDX LDY ORA SBC STA STX STY");
// And those whose operand is only an address, after which BASIC reads nothing.
const Address = words("BCC BCS BEQ BMI BNE BPL BVC BVS JMP JSR");
// BASIC takes the index register in lower case only after these.
const LowerCaseIndex = {LDX: "y", STX: "y", LDY: "x", STY: "x"};

export class Assembler {
    constructor(recogniser) {
        this.recogniser = recogniser;
    }

    // Reads assembler statements up to the "]" that ends the block, or the end of the line; returns whether the block
    // is still open.
    block() {
        const r = this.recogniser;
        for (;;) {
            if (r.is("end")) return true;
            if (r.isPunct("]")) {
                r.next();
                return false;
            }
            if (r.isPunct(":")) {
                r.next();
                continue;
            }
            const start = r.peek();
            try {
                this.statement();
            } catch (e) {
                if (!r.isFailure(e)) throw e;
                r.mark(e.token, start);
                while (!r.is("end") && !r.isPunct(":", "]")) r.next();
            }
        }
    }

    statement() {
        const r = this.recogniser;
        if (this.comment("\\")) return;
        this.label();
        if (r.is("end") || r.isPunct(":", "]") || this.comment("\\")) return;
        this.operand(this.mnemonic());
        if (this.comment(";", "\\")) return;
        while (!r.is("end") && !r.isPunct(":", "]")) {
            const token = r.next();
            if (token.kind === "keyword" && !r.isExpressionKeyword(token)) token.invalid = true;
        }
    }

    // A comment runs to the next colon, whatever the tokeniser made of it.
    comment(...starts) {
        const r = this.recogniser;
        if (!r.isPunct(...starts)) return false;
        r.lexer.rawTo("comment");
        return true;
    }

    // A dot and a name, which the lexer reads as the number "." and the name.
    label() {
        const r = this.recogniser;
        if (!r.is("number", ".")) return;
        const dot = r.next();
        if (!r.is("name") || !r.adjacent()) r.fail(dot);
        dot.type = r.next().type = "type.identifier";
    }

    // Reads the mnemonic or directive, which BASIC takes in either case, and returns it in upper case.
    mnemonic() {
        const r = this.recogniser;
        const token = r.peek();
        if (r.isKeyword("AND", "EOR")) return r.next().kw.keyword;
        // ORA is the keyword OR then an A, which BASIC takes only in upper case.
        if (r.isKeyword("OR")) {
            const after = r.peek(1);
            if (after.kind !== "name" || after.spaced || after.text[0] !== "A") {
                if (after.kind === "name" && !after.spaced) after.invalid = true;
                r.fail(token);
            }
            r.next();
            r.lexer.split(after, 1);
            r.next().type = "keyword";
            return "ORA";
        }
        if (!r.is("name")) r.fail();
        // OPT, and EQU with its size, which BASIC takes only in upper case.
        const directive = /^opt/i.test(token.text) ? 3 : /^equ/i.test(token.text) ? 4 : 0;
        if (directive) {
            if (directive === 4 && !/^...[BDSW]/.test(token.text)) r.fail();
            r.lexer.split(token, directive);
            r.next().type = "keyword.directive";
            return token.text.toUpperCase();
        }
        const mnemonic = token.text.slice(0, 3).toUpperCase();
        if (![Implied, Shifts, Addressed, Address].some(set => set.has(mnemonic))) r.fail();
        r.lexer.split(token, 3);
        r.next().type = "keyword";
        return mnemonic;
    }

    operand(mnemonic) {
        const r = this.recogniser;
        if (Implied.has(mnemonic)) return;
        if (Shifts.has(mnemonic) && r.is("name", "A")) return void (r.next().type = "keyword");
        if (!Addressed.has(mnemonic) && !Shifts.has(mnemonic)) return r.expression();
        if (r.isPunct("#")) {
            r.next().type = "symbol";
            return r.expression();
        }
        if (r.isPunct("(")) {
            const opener = r.next();
            r.expression();
            if (r.isPunct(",")) {
                this.index(mnemonic, "X");
                if (!r.isPunct(")")) r.fail();
                return void r.next();
            }
            if (!r.isPunct(")")) r.fail(r.atEnd() ? opener : r.peek());
            r.next();
            if (r.isPunct(",")) this.index(mnemonic, "Y");
            return;
        }
        r.expression();
        if (r.isPunct(",")) this.index(mnemonic, "X", "Y");
    }

    // A comma and an index register.
    index(mnemonic, ...registers) {
        const r = this.recogniser;
        r.next().type = "symbol";
        const register = r.peek().text;
        if (
            !r.is("name") ||
            !(registers.includes(register) || register === LowerCaseIndex[mnemonic])
        )
            r.fail();
        r.next().type = "keyword";
    }
}
