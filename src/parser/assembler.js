// The assembler between [ and ], as BBC BASIC II reads it: each statement is an optional label, then a mnemonic or
// directive, then its operand. A "\" comment can start a statement, and a ";" comment can follow a complete
// instruction; either runs to the next colon.
//
// Stricter than the ROM, on purpose (the problems that say so have `stricter` set):
// - BASIC ignores the rest of a statement after a complete instruction, but a keyword there that an expression cannot
//   use is marked, since it is almost always a mistake (NOP PRINT);
// - BASIC compares only the low five bits of each character of a mnemonic, so it reads 8 as X and ! as A, but a
//   character that is not a letter there is marked, since LD89 is far more likely a mistyped LDA89 than LDX 9.

import {Flags} from "../tokens.js";
import {Failure} from "./recogniser.js";

const words = text => new Set(text.split(" "));
const Implied = words(
    "BRK CLC CLD CLI CLV DEX DEY INX INY NOP PHA PHP PLA PLP RTI RTS SEC SED SEI TAX TAY TSX TXA TXS TYA",
);
const Shifts = words("ASL LSR ROL ROR");
// Mnemonics whose operand can be immediate, indirect or indexed.
const Addressed = words("ADC AND BIT CMP CPX CPY DEC EOR INC LDA LDX LDY ORA SBC STA STX STY");
// And those whose operand is only an address, after which BASIC reads nothing.
const Address = words("BCC BCS BEQ BMI BNE BPL BVC BVS JMP JSR");
// Only these read a ( as indirect addressing; for the rest it starts an expression.
const Indirect = words("ADC AND CMP EOR LDA ORA SBC STA");
const NoImmediate = words("ASL BIT DEC INC LSR ROL ROR STA STX STY");
// The index registers each takes, if not X and Y; BASIC reads none after BIT, CPX and CPY.
const IndexRegisters = {
    ...Object.fromEntries([...Shifts, "DEC", "INC", "LDY", "STY"].map(m => [m, ["X"]])),
    ...Object.fromEntries(["LDX", "STX"].map(m => [m, ["Y"]])),
    ...Object.fromEntries(["BIT", "CPX", "CPY"].map(m => [m, []])),
};
// BASIC takes the index register in lower case only after these.
const LowerCaseIndex = {LDX: "y", STX: "y", LDY: "x", STY: "x"};
export const Mnemonics = [
    ...Implied,
    ...Shifts,
    ...Addressed,
    ...Address,
    ..."OPT EQUB EQUD EQUS EQUW".split(" "),
];
const Label = /\. *(?:[A-Za-z_`][\w`]*%?|@%)/y;
const Comment = /[;\\][^:]*/y;

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
            if (this.isBranchElse()) return false;
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
                if (!(e instanceof Failure)) throw e;
                const problem = r.mark(e, start);
                while (!r.is("end") && !r.isPunct(":", "]") && !this.isBranchElse()) r.next();
                r.redden(problem);
            }
        }
    }

    // The ELSE of an IF, which BASIC takes wherever it is on the line: if the condition is false the block is never read.
    isBranchElse() {
        return this.recogniser.elseIsBranch && this.recogniser.isKeyword("ELSE");
    }

    statement() {
        const r = this.recogniser;
        if (this.comment("\\")) return;
        this.labels();
        if (r.is("end") || r.isPunct(":", "]") || this.comment("\\")) return;
        this.operand(this.mnemonic());
        if (this.comment(";", "\\")) return;
        while (!r.is("end") && !r.isPunct(":") && !this.isBranchElse()) {
            const token = r.next();
            if (token.kind === "keyword" && !(token.kw.flags & Flags.Expr || token.top))
                this.stricter(
                    token,
                    "BASIC ignores everything after a complete instruction; probably a ; is missing before a comment",
                );
        }
    }

    // A comment runs to the next colon, whatever the tokeniser made of it.
    comment(...starts) {
        const r = this.recogniser;
        if (!r.isPunct(...starts)) return false;
        r.lexer.raw(Comment, "comment");
        return true;
    }

    // Labels, each a dot and a name, taken from the text: the lexer reads .E1 as a number. A keyword straight after
    // the dot is not a name (.END is an error).
    labels() {
        const r = this.recogniser;
        while (r.peek().kind === "number" && r.peek().text[0] === ".") {
            const after = r.peek(1);
            if (after.kind === "keyword" && (!after.spaced || r.peek().text === "."))
                r.fail("Syntax error");
            const label = r.lexer.raw(Label, "label");
            if (!label)
                r.fail("Syntax error", undefined, r.peek().text === "." && after.kind === "end");
            label.type = "type.identifier";
        }
    }

    // Reads the mnemonic or directive and returns it in upper case.
    mnemonic() {
        const r = this.recogniser;
        const token = r.peek();
        if (r.isKeyword("AND", "EOR")) return r.next().kw.keyword;
        // ORA is the keyword OR then an A, which BASIC takes only in upper case.
        if (r.isKeyword("OR")) {
            const after = r.peek(1);
            if (after.kind !== "name" || after.spaced || after.text[0] !== "A") {
                if (after.kind === "name" && !after.spaced) after.invalid = true;
                r.fail("Syntax error", token, after.kind === "end");
            }
            r.next();
            r.lexer.split(after, 1);
            r.next().type = "keyword";
            return "ORA";
        }
        // BASIC compares the low five bits of each character, so it takes a mnemonic in either case, and ST8 as STX;
        // only the size of an EQU must be an upper-case letter.
        const {text} = r.lexer;
        const chars = [...text.slice(token.start, token.start + 3)];
        const word = chars.map(c => String.fromCharCode((c.charCodeAt(0) & 0x1f) | 0x40)).join("");
        const size = word === "EQU" ? text[token.start + 3] : "";
        if (word === "EQU" && !/[BDSW]/.test(size)) r.fail("Syntax error");
        const directive = word === "OPT" || word === "EQU";
        if (!directive && ![Implied, Shifts, Addressed, Address].some(set => set.has(word)))
            r.fail("Syntax error");
        const aliased = chars.flatMap((c, i) => (/[A-Za-z]/.test(c) ? [] : [token.start + i]));
        this.take(
            token.start + 3 + size.length,
            directive ? "keyword.directive" : "keyword",
            aliased,
        );
        return word + size;
    }

    // The tokens up to the end given, splitting the last, as one of the given type. Each character at an offset in
    // `aliased` is a token of its own and is marked.
    take(end, type, aliased = []) {
        const r = this.recogniser;
        while (r.peek().start < end) {
            const token = r.peek();
            if (!["name", "number", "punct"].includes(token.kind)) r.fail(null);
            const alias = aliased.includes(token.start);
            const cut = alias
                ? token.start + 1
                : Math.min(end, ...aliased.filter(at => at > token.start));
            r.lexer.split(token, cut - token.start);
            r.next().type = type;
            if (!alias) continue;
            const letter = String.fromCharCode((token.text.charCodeAt(0) & 0x1f) | 0x40);
            this.stricter(
                token,
                `BASIC reads ${token.text} as ${letter} here (it compares only part of each character); probably a typo`,
            );
        }
    }

    // Marks a token that BASIC accepts but that is almost certainly a mistake.
    stricter(token, message) {
        token.invalid = true;
        this.recogniser.problems.push({
            message,
            token,
            end: token.end,
            unfinished: false,
            hole: false,
            stricter: true,
        });
    }

    operand(mnemonic) {
        const r = this.recogniser;
        if (Implied.has(mnemonic)) return;
        if (Shifts.has(mnemonic) && r.is("name", "A")) return void (r.next().type = "keyword");
        if (!Addressed.has(mnemonic) && !Shifts.has(mnemonic)) return r.expression();
        if (r.isPunct("#")) {
            if (NoImmediate.has(mnemonic)) r.fail("No such variable");
            r.next().type = "symbol";
            return r.expression();
        }
        if (Indirect.has(mnemonic) && r.isPunct("(")) {
            const opener = r.next();
            r.expression();
            if (r.isPunct(",")) {
                this.index(mnemonic, "X");
                if (!r.isPunct(")")) r.fail("Index");
                return void r.next();
            }
            r.close(opener, "Index");
            if (!r.isPunct(",")) r.fail("Index", r.last, r.is("end"));
            return this.index(mnemonic, "Y");
        }
        r.expression();
        const registers = IndexRegisters[mnemonic] || ["X", "Y"];
        if (registers.length && r.isPunct(",")) this.index(mnemonic, ...registers);
    }

    // A comma and an index register.
    index(mnemonic, ...registers) {
        const r = this.recogniser;
        r.next().type = "symbol";
        const token = r.peek();
        const register = token.text?.[0];
        if (
            !r.is("name") ||
            !(registers.includes(register) || register === LowerCaseIndex[mnemonic])
        )
            r.fail("Index");
        r.lexer.split(token, 1);
        r.next().type = "keyword";
    }
}
