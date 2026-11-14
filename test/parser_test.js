import {highlightLine} from "../src/parser/highlight";
import {lexLine, romBytes} from "../src/parser/lexer";
import {falseInvalid, verdicts} from "./rom-tables";
import {describe, it} from "vitest";
import assert from "assert";
import RomTokens from "./rom-tokens.json";
import RomVerdicts from "./rom-verdicts.json";

const hex = bytes => bytes.map(b => b.toString(16).padStart(2, "0")).join(" ");

// The rows of a recorded table on which the function's answer differs from the recorded one, with both answers.
const disagreements = (rows, answer) =>
    rows.flatMap(([text, recorded]) => {
        const ours = answer(text);
        return ours === recorded ? [] : [{text, recorded, ours}];
    });

describe("Lexer", () => {
    it("should tokenise each line as BASIC II does", () => {
        assert.deepStrictEqual(
            disagreements(RomTokens, text => hex(romBytes(lexLine(text)))),
            [],
        );
    });
});

// Lines BASIC II rejects that the recogniser does not mark: false-valids are measured, not gated (see the README).
// A "(" after a space can belong to a FN or PROC call or not, depending on its DEF.
const KnownGaps = ["X=FNf (1)", "PROCp (1)"];

// Lines BASIC II runs that are marked on purpose (see the README): a keyword after a complete assembler instruction.
const StricterThanRom = ["[OPT0:NOP PRINT:]", "[OPT0:LDA #1 FOR:]"];

describe("Recogniser", () => {
    it("should mark an error in each line BASIC II stops at with one, and none where it runs", () => {
        const invalid = text => {
            const {tokens} = highlightLine(text);
            return tokens.flatMap((token, i) =>
                token.type.startsWith("invalid")
                    ? [[token.offset, i + 1 < tokens.length ? tokens[i + 1].offset : text.length]]
                    : [],
            );
        };
        const wrong = RomVerdicts.flatMap(([text, verdict]) => {
            const marked = invalid(text);
            if (verdict === "ok") {
                const stricter = StricterThanRom.includes(text);
                return falseInvalid(text, marked).length > 0 === stricter ? [] : [[text, verdict]];
            }
            return marked.length || KnownGaps.includes(text) ? [] : [[text, verdict]];
        });
        assert.deepStrictEqual(wrong, []);
    });
    it("should not let errors inside nested reads use up the nesting limit", () => {
        const text = `[${"LDA #(:".repeat(70)}LDA #1:]`;
        const {tokens} = highlightLine(text);
        const marked = tokens.filter(token => token.type === "invalid");
        assert.strictEqual(marked.length, 70);
        assert.ok(marked.every(token => token.offset < text.lastIndexOf("LDA #1")));
    });
    it("should still miss the known gaps, which come out of the list when they are fixed", () => {
        for (const text of KnownGaps) {
            assert.notStrictEqual(verdicts.get(text), "ok", text);
            assert.ok(
                highlightLine(text).tokens.every(token => !token.type.startsWith("invalid")),
                text,
            );
        }
    });
});
