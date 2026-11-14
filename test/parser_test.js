import {highlightLine, programProblems} from "../src/parser/highlight";
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

const invalid = text => {
    const {tokens} = highlightLine(text);
    return tokens.flatMap((token, i) =>
        token.type.startsWith("invalid")
            ? [[token.offset, i + 1 < tokens.length ? tokens[i + 1].offset : text.length]]
            : [],
    );
};

// Lines where BASIC's error is not the one the recogniser gives for that kind of mistake: H.TO8 is not read as HIMEM.
const OtherWording = ["F.A=H.TO8^5:?A=42:N."];

describe("Recogniser", () => {
    it("should mark an error in each line BASIC II stops at with one, and none where it runs", () => {
        const wrong = RomVerdicts.flatMap(([text, verdict]) => {
            const marked = invalid(text);
            const problems = programProblems(text);
            if (verdict === "ok") {
                const stricter = StricterThanRom.includes(text);
                // Text BASIC skips can be unfinished, as it can be wrong (see the README).
                const unfinished = problems.filter(problem => problem.unfinished);
                const ends = unfinished.map(({start, end}) => [start, end]);
                return falseInvalid(text, marked).length > 0 === stricter &&
                    falseInvalid(text, ends).length === 0
                    ? []
                    : [[text, verdict]];
            }
            // A line that only ends too soon is not marked, which is what lets it be typed.
            const unfinished = problems.length > 0 && problems.every(problem => problem.unfinished);
            return marked.length || unfinished || KnownGaps.includes(text) ? [] : [[text, verdict]];
        });
        assert.deepStrictEqual(wrong, []);
    });
    it("should give the error BASIC II gives, or none where it does not know it", () => {
        const wrong = RomVerdicts.flatMap(([text, verdict]) => {
            const {message} = programProblems(text)[0] || {};
            return verdict === "ok" ||
                !message ||
                message === verdict ||
                OtherWording.includes(text)
                ? []
                : [[text, verdict, message]];
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

// The text of each token marked invalid.
const red = text => invalid(text).map(([start, end]) => text.slice(start, end));

// Every prefix of each line, as typed a key at a time, and the prefixes that are red: only those that no ending can
// make valid, such as a number after a complete GOTO.
const Typed = [
    ["GOTO 20", []],
    ["FOR I=1 TO 10", []],
    ["FOR I=1 TO 10 STEP 2", []],
    ["IF A=1 THEN PRINT 2", []],
    ["PRINT (1+2)", []],
    ["A$=LEFT$(B$,3)", []],
    ["REPEAT UNTIL X=1", []],
    ["10 GOSUB 100", []],
    ["DEF PROCfoo", []],
    ['PRINT "HI"', []],
    ["X=1+2*3", []],
    ["X=1 AND 2", []],
    ["ON X GOTO 10", []],
    ["ENDPROC", []],
    ["[LDA (&70),Y", []],
    ["[EQUB 1", []],
    ["GOTO 20 30", ["GOTO 20 3", "GOTO 20 30"]],
    ["X=1 THEN", ["X=1 T", "X=1 TH", "X=1 THE", "X=1 THEN"]],
];

describe("A line typed a key at a time", () => {
    it.each(Typed)(
        "%s should be red only where no ending could make it valid",
        (line, expected) => {
            const prefixes = [...line].map((_, i) => line.slice(0, i + 1));
            assert.deepStrictEqual(
                prefixes.filter(prefix => invalid(prefix).length),
                expected,
            );
        },
    );
});

describe("Text that is wrong, not unfinished", () => {
    it.each([
        ["GOTO 20 30", ["30"]],
        ["PRINT )", [")"]],
        ["A=1'", ["'"]],
        ["X=1+*", ["*"]],
        ["X=1 TH", ["TH"]],
        ["END 1", ["1"]],
        ["PRINT (1+2))", [")"]],
        ["A$=LEFT$(X$,1,", [","]],
        ["GOTO:PRINT", ["GOTO"]],
        ["FOR I=1 TO:NEXT", ["TO"]],
        ["X=RND(1,", [","]],
    ])("%s should be red", (text, expected) => {
        assert.deepStrictEqual(red(text), expected);
    });
});
