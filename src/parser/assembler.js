// The assembler between [ and ], as BBC BASIC II reads it: each statement is an optional label, then a mnemonic or
// directive, then its operand. A "\" comment can start a statement, and a ";" comment can follow a complete
// instruction; either runs to the next colon.
//
// Stricter than the ROM, on purpose (the problems that say so have `stricter` set):
// - BASIC ignores the rest of a statement after a complete instruction, but the first thing there that is not a
//   comment is marked, since it is almost always a mistake (NOP PRINT, LDA #1 hello, LDA #1] with a : missing);
// - BASIC compares only the low five bits of each character of a mnemonic, so it reads 8 as X and ! as A, but a
//   character that is not a letter there is marked, since LD89 is far more likely a mistyped LDA89 than LDX 9. Where
//   it is the third character, the two letters before it are marked instead (LD is not an instruction);
// - BASIC drops what comes before an AND, EOR or OR token that is the second or third character of a mnemonic, so
//   that is marked.

import {keywords, tokenChar} from "../tokens.js";
import {isBasicIV} from "./dialect.js";
import {matchKeyword} from "./lexer.js";

export const JunkAfterInstructionCode = "junk-after-instruction";
export const SpaceAfterMnemonicCode = "space-after-mnemonic";

const words = text => new Set(text.split(" "));
const BasicII = {
    implied: words(
        "BRK CLC CLD CLI CLV DEX DEY INX INY NOP PHA PHP PLA PLP RTI RTS SEC SED SEI TAX TAY TSX TXA TXS TYA",
    ),
    // The instructions that can take A as their operand.
    accumulator: words("ASL LSR ROL ROR"),
    // Mnemonics whose operand can be immediate, indirect or indexed.
    addressed: words("ADC AND BIT CMP CPX CPY DEC EOR INC LDA LDX LDY ORA SBC STA STX STY"),
    // And those whose operand is only an address, after which BASIC reads nothing.
    address: words("BCC BCS BEQ BMI BNE BPL BVC BVS JMP JSR"),
    // Only these read a ( as indirect addressing; for the rest it starts an expression.
    indirect: words("ADC AND CMP EOR LDA ORA SBC STA"),
    noImmediate: words("ASL BIT DEC INC LSR ROL ROR STA STX STY"),
    // The index registers each takes, if not X and Y; BASIC reads none after BIT, CPX and CPY.
    indexRegisters: {
        ...Object.fromEntries(
            ["ASL", "LSR", "ROL", "ROR", "DEC", "INC", "LDY", "STY"].map(m => [m, ["X"]]),
        ),
        ...Object.fromEntries(["LDX", "STX"].map(m => [m, ["Y"]])),
        ...Object.fromEntries(["BIT", "CPX", "CPY"].map(m => [m, []])),
    },
    // BASIC II takes the index register in lower case only after these.
    lowerCaseIndex: {LDX: "y", STX: "y", LDY: "x", STY: "x"},
    equSize: /[BDSW]/,
    letterA: /^A/,
    basicIV: false,
    indexRegister: (mnemonic, registers, register) =>
        registers.includes(register) || register === BasicII.lowerCaseIndex[mnemonic],
};
// BASIC IV adds the 65C12's instructions to BASIC II's (and CLR as another name for STZ), reads an index register or
// the accumulator in either case, and reads a zero page indirect address (LDA (&70)) and JMP (&1234,X).
const BasicIV = {
    ...BasicII,
    implied: new Set([...BasicII.implied, ..."DEA INA PHX PHY PLX PLY".split(" ")]),
    accumulator: new Set([...BasicII.accumulator, "DEC", "INC"]),
    addressed: new Set([...BasicII.addressed, "STZ", "CLR", "TRB", "TSB"]),
    address: new Set([...BasicII.address, "BRA"]),
    noImmediate: new Set([
        ...[...BasicII.noImmediate].filter(m => m !== "BIT"),
        ...["STZ", "CLR", "TRB", "TSB"],
    ]),
    indexRegisters: {
        ...BasicII.indexRegisters,
        BIT: ["X"],
        STZ: ["X"],
        CLR: ["X"],
        TRB: [],
        TSB: [],
    },
    equSize: /[BDSWbdsw]/,
    letterA: /^[Aa]/,
    indexRegister: (mnemonic, registers, register) => registers.includes(register.toUpperCase()),
    basicIV: true,
};
const mnemonicsOf = rules => [
    ...rules.implied,
    ...rules.accumulator,
    ...rules.addressed,
    ...rules.address,
    ..."OPT EQUB EQUD EQUS EQUW".split(" "),
];
const MnemonicLists = new Map([
    [BasicII, [...new Set(mnemonicsOf(BasicII))]],
    [BasicIV, [...new Set(mnemonicsOf(BasicIV))]],
]);
export const mnemonicsFor = () => MnemonicLists.get(isBasicIV() ? BasicIV : BasicII);
const ThirdCharacter = 2;
const LogicalTokenChars = new Set(
    keywords.filter(kw => ["AND", "EOR", "OR"].includes(kw.keyword)).map(tokenChar),
);
const Label = /\. *(?:[A-Za-z_`][\w`]*%?|@%)/y;
const Comment = /[;\\][^:]*/y;

export class Assembler {
    constructor(recogniser) {
        this.recogniser = recogniser;
        this.rules = isBasicIV() ? BasicIV : BasicII;
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
                const atEnd = () => r.is("end") || r.isPunct(":", "]") || this.isBranchElse();
                r.recover(e, start, atEnd, true);
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
        const first = r.peek();
        const mnemonic = this.mnemonic();
        const operand = r.peek();
        this.operand(mnemonic);
        if (this.comment(";", "\\")) return;
        let junk = null;
        while (!r.is("end") && !r.isPunct(":") && !this.isBranchElse()) {
            const token = r.next();
            if (junk) continue;
            junk = token;
            const space = this.keywordAfterMnemonic(first, mnemonic, operand);
            if (space) this.stricter(token, space, SpaceAfterMnemonicCode, operand);
            else
                this.stricter(
                    token,
                    token.text === "]"
                        ? "BASIC ignores this ] and goes on assembling, as it ignores everything after a complete instruction; probably a : is missing before it"
                        : "BASIC ignores everything after a complete instruction; probably a ; is missing before a comment",
                    JunkAfterInstructionCode,
                );
        }
    }

    // The message for junk after an instruction whose operand begins with a name that spells a keyword, straight after
    // a mnemonic that takes an operand, where a space before it would leave no junk; otherwise null. BASIC tokenises a
    // keyword only at the start of a word, so STAH.,X is STA, the variable H, and junk.
    keywordAfterMnemonic(first, mnemonic, operand) {
        const r = this.recogniser;
        const {text} = r.lexer;
        const keyword =
            operand.kind === "name" && !operand.spaced && matchKeyword(text, operand.start);
        if (!keyword || this.rules.implied.has(mnemonic) || r.probing) return null;
        const spaced = `${text.slice(0, operand.start)} ${text.slice(operand.start)}`;
        if (!r.valid(spaced, first, operand.start)) return null;
        const written = text.slice(first.start, operand.start);
        const spelling = text.slice(operand.start, keyword.end);
        return `${spelling} here is read as the variable ${operand.text}, not the keyword: BASIC recognises a keyword only at the start of a word, and this follows ${written} with no space, so the rest of the instruction is ignored; probably a space was meant after ${written}`;
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
        this.dropBeforeToken();
        const token = r.peek();
        if (r.isKeyword("AND", "EOR")) return r.next().kw.keyword;
        // ORA is the keyword OR then an A, which BASIC II takes only in upper case.
        if (r.isKeyword("OR")) {
            const after = r.peek(1);
            if (after.kind !== "name" || after.spaced || !this.rules.letterA.test(after.text[0])) {
                if (after.kind === "name" && !after.spaced) after.invalid = true;
                r.fail("Syntax error", token, after.kind === "end");
            }
            r.next();
            r.lexer.split(after, 1);
            r.next().type = "keyword";
            return "ORA";
        }
        // BASIC compares the low five bits of each character, so it takes a mnemonic in either case, and ST8 as STX;
        // BASIC II needs the size of an EQU to be an upper-case letter.
        const {text} = r.lexer;
        const chars = [...text.slice(token.start, token.start + 3)];
        const word = chars.map(c => String.fromCharCode((c.charCodeAt(0) & 0x1f) | 0x40)).join("");
        const size = word === "EQU" ? text[token.start + 3] : "";
        if (word === "EQU" && !this.rules.equSize.test(size)) r.fail("Syntax error");
        const directive = word === "OPT" || word === "EQU";
        const {implied, accumulator, addressed, address} = this.rules;
        if (!directive && ![implied, accumulator, addressed, address].some(set => set.has(word)))
            r.fail("Syntax error");
        const aliased = chars.flatMap((c, i) => (/[A-Za-z]/.test(c) ? [] : [i]));
        const marks =
            aliased.length === 1 && aliased[0] === ThirdCharacter
                ? [this.prefixMark(token.start, word, chars[ThirdCharacter])]
                : aliased.map(i => ({
                      start: token.start + i,
                      end: token.start + i + 1,
                      message: `BASIC reads ${chars[i]} as ${word[i]} here (it compares only part of each character); probably a typo`,
                  }));
        this.take(
            token.start + 3 + size.length,
            directive ? "keyword.directive" : "keyword",
            marks,
        );
        return word + size;
    }

    // BASIC reads an AND, EOR or OR token among the first three characters as the mnemonic, and drops the characters
    // before it.
    dropBeforeToken() {
        const r = this.recogniser;
        const {start} = r.peek();
        const {text} = r.lexer;
        const at = [1, 2].find(i => LogicalTokenChars.has(text[start + i]));
        if (at === undefined) return;
        const dropped = text.slice(start, start + at);
        this.take(start + at, "keyword", [
            {
                start,
                end: start + at,
                message: `BASIC drops the ${dropped} before the token that follows and reads that as the mnemonic; probably a typo`,
            },
        ]);
    }

    // The mark for a mnemonic whose third character is not a letter: the two letters before it, which are not an
    // instruction on their own, with the third letters that would make one.
    prefixMark(start, word, char) {
        const prefix = word.slice(0, ThirdCharacter);
        const meant = [
            ...new Set(
                mnemonicsFor()
                    .filter(m => m.startsWith(prefix))
                    .map(m => m.slice(0, 3)),
            ),
        ];
        const kind = meant.every(m => "AXY".includes(m[ThirdCharacter])) ? "register" : "last";
        const follows = this.rules.implied.has(word)
            ? ""
            : `, so what follows is the ${word === "OPT" || word === "EQU" ? "operand" : "address"}`;
        const list = `${meant.slice(0, -1).join(", ")}${meant.length > 1 ? " or " : ""}${meant.at(-1)}`;
        return {
            start,
            end: start + ThirdCharacter,
            message: `${prefix} is not an instruction: the ${kind} letter is missing. BASIC reads the ${char} as ${word[ThirdCharacter]} (${word})${follows}; probably ${list} was meant`,
        };
    }

    // The tokens up to the end given, splitting the last, as one of the given type. Each span in `marks` is a token of
    // its own and is marked, with its message.
    take(end, type, marks = []) {
        const r = this.recogniser;
        const cuts = marks.flatMap(mark => [mark.start, mark.end]);
        while (r.peek().start < end) {
            const token = r.peek();
            if (!["name", "number", "punct"].includes(token.kind)) r.fail(null);
            const mark = marks.find(m => m.start === token.start);
            r.lexer.split(
                token,
                Math.min(end, ...cuts.filter(at => at > token.start)) - token.start,
            );
            r.next().type = type;
            if (mark) this.stricter(token, mark.message);
        }
    }

    // Marks a token that BASIC accepts but that is almost certainly a mistake; the problem's text starts at `from`.
    stricter(token, message, code, from = token) {
        token.invalid = true;
        this.recogniser.problems.push({
            message,
            token: from,
            end: token.end,
            unfinished: false,
            hole: false,
            stricter: true,
            code,
        });
    }

    operand(mnemonic) {
        const r = this.recogniser;
        const rules = this.rules;
        if (rules.implied.has(mnemonic)) return;
        const register = r.peek().text;
        if (
            rules.accumulator.has(mnemonic) &&
            r.is("name") &&
            register.length === 1 &&
            rules.letterA.test(register)
        )
            return void (r.next().type = "keyword");
        if (rules.basicIV && mnemonic === "JMP" && r.isPunct("(")) return this.indirectJump();
        if (!rules.addressed.has(mnemonic) && !rules.accumulator.has(mnemonic))
            return r.expression();
        if (r.isPunct("#")) {
            if (rules.noImmediate.has(mnemonic)) r.fail("No such variable");
            r.next().type = "symbol";
            return r.expression();
        }
        if (rules.indirect.has(mnemonic) && r.isPunct("(")) {
            const opener = r.next();
            r.expression();
            if (r.isPunct(",")) return this.indexedIndirect(mnemonic);
            r.close(opener, "Index");
            // BASIC IV takes (&70) as an address in the zero page, and ignores what follows it.
            if (rules.basicIV && !r.isPunct(",")) return;
            if (!r.isPunct(",")) r.fail("Index", r.last, r.is("end"));
            return this.index(mnemonic, "Y");
        }
        r.expression();
        const registers = rules.indexRegisters[mnemonic] || ["X", "Y"];
        if (registers.length && r.isPunct(",")) this.index(mnemonic, ...registers);
    }

    // BASIC IV reads JMP (&1234,X) as well as JMP (&1234); after the ) it ignores the rest, as it does for any address.
    indirectJump() {
        const r = this.recogniser;
        const opener = r.next();
        r.expression();
        if (r.isPunct(",")) return this.indexedIndirect("JMP");
        r.close(opener, "Index");
    }

    // After the comma in (address,X).
    indexedIndirect(mnemonic) {
        const r = this.recogniser;
        this.index(mnemonic, "X");
        if (!r.isPunct(")")) r.fail("Index");
        r.next();
    }

    // A comma and an index register.
    index(mnemonic, ...registers) {
        const r = this.recogniser;
        r.next().type = "symbol";
        const token = r.peek();
        const register = token.text?.[0];
        if (!r.is("name") || !this.rules.indexRegister(mnemonic, registers, register))
            r.fail("Index");
        r.lexer.split(token, 1);
        r.next().type = "keyword";
    }
}
