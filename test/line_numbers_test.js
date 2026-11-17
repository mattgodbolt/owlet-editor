import {getLineNumberMarkers} from "../src/line-numbers";
import {describe, expect, it} from "vitest";
import {BasicIVDialect, ModelBDialect} from "../src/parser/dialect";
import {Flags} from "../src/tokens";

const Missing = target => `No line ${target} (BASIC: No such line)`;
const CannotExist = (target, error = "No such line") =>
    `There cannot be a line ${target}: BASIC cannot have line numbers above 32767 (BASIC: ${error})`;
const Wraps = (target, means) =>
    `Line number ${target} is too big: BASIC keeps only the bottom 16 bits of it, so it means ${means}`;
const TooBig = target => `Line number ${target} is too big (BASIC: Too big)`;
const ExplicitTooBig = number =>
    `Line number ${number} is too big: BASIC cannot have line numbers above 32767, and the program ends at the first line that has one (BASIC: Syntax error if typed in)`;
const ImplicitTooBig = number =>
    `This line would be numbered ${number}: BASIC cannot have line numbers above 32767, so the program ends before it and BASIC will never run it`;

// The line, columns and message of each marker.
function problems(text, cursorLine) {
    return getLineNumberMarkers(text, ModelBDialect, cursorLine).map(marker => [
        marker.startLineNumber,
        `${marker.startColumn}-${marker.endColumn}`,
        marker.message,
    ]);
}

const messages = (text, cursorLine) => problems(text, cursorLine).map(([, , message]) => message);

describe.each([
    ["BASIC II", ModelBDialect],
    ["BASIC IV", BasicIVDialect],
])("The keywords of %s that take a line number", (_, dialect) => {
    const LookedUp = ["ELSE", "GOSUB", "GOTO", "RESTORE", "THEN"];
    const After = {THEN: "IF X THEN 5000", ELSE: "IF X THEN PRINT ELSE 5000"};
    it("should mark a missing line after those BASIC looks up and after no other", () => {
        const flagged = [
            ...new Set(
                dialect.keywords.filter(kw => kw.flags & Flags.LineNumber).map(kw => kw.keyword),
            ),
        ];
        const marked = flagged.filter(
            word =>
                getLineNumberMarkers(After[word] ?? `${word} 5000`, dialect).filter(marker =>
                    marker.message.startsWith("No line 5000"),
                ).length === 1,
        );
        expect(marked.sort()).toEqual(LookedUp);
        expect(flagged).toContain("TRACE");
        expect(flagged.includes("EDIT")).toBe(dialect.basicIV);
    });
});

describe("Line number markers", () => {
    it("should mark a missing line for each keyword that BASIC looks the line up for", () => {
        const cases = [
            ["GOTO 11", [Missing(11)]],
            ["GOSUB 11", [Missing(11)]],
            ["G.11:GOS.12", [Missing(11), Missing(12)]],
            ["IF X THEN 11", [Missing(11)]],
            ["IF X THEN PRINT ELSE 11", [Missing(11)]],
            ["IF X TH.11 EL.12", [Missing(11), Missing(12)]],
            ["ON X GOTO 10,11,12", [Missing(11), Missing(12)]],
            ["ON X GOSUB 11,10 ELSE 12", [Missing(11), Missing(12)]],
            ["ON ERROR GOTO 11", [Missing(11)]],
            ["RESTORE 11", [Missing(11)]],
            ["GOTO 10*2:GOTO 12", [Missing(12)]],
            ["GOTO 10", []],
            ["ON X GOTO 10,10", []],
            ["RESTORE 10:RESTORE", []],
        ];
        for (const [statement, expected] of cases) {
            const text = `10 ${statement}\n20 END`;
            expect(messages(text), text).toEqual(expected);
        }
    });

    it("should leave alone the numbers that need not be lines, and anything that is not a reference", () => {
        const cases = [
            "LIST 11",
            "LIST 11,12",
            "AUTO 11,3",
            "DELETE 11,12",
            "RENUMBER 11,12",
            "TRACE 11",
            "TRACE 40000",
            'PRINT "GOTO 11":REM GOTO 11',
            "PRINT 11",
            "DATA GOTO 11",
            "REPEAT 11",
            "*FX 11",
        ];
        for (const statement of cases) {
            const text = `10 ${statement}\n20 END`;
            expect(messages(text), text).toEqual([]);
        }
        expect(messages("[JMP 11\n]\n10 END")).toEqual([]);
    });

    it("should say where the number is", () => {
        expect(problems("10 PRINT\n20 ON X GOTO 10,11")).toEqual([[2, "17-19", Missing(11)]]);
    });

    it("should number the lines without a number by their place, blank lines included", () => {
        const cases = [
            ["PRINT\nGOTO 10\nGOTO 20\nGOTO 50", [Missing(50)]],
            ["GOTO 20\n\nGOTO 30", [Missing(20)]],
            ["GOTO 20\n \nGOTO 30", [Missing(20)]],
            ["10 GOTO 40\nGOTO 40\nGOTO 30", [Missing(40), Missing(40)]],
            ["GOTO 20\n100 PRINT", [Missing(20)]],
            ["GOTO 100\n100 PRINT", []],
        ];
        for (const [text, expected] of cases) {
            expect(messages(text), text).toEqual(expected);
        }
    });

    it("should find a line wherever it is, since the whole program is known", () => {
        expect(messages("10 GOTO 30\n20 END\n30 GOTO 20")).toEqual([]);
        expect(messages("GOTO 20\nEND")).toEqual([]);
    });

    it("should mark a reference to a line above 32767 as one that cannot exist", () => {
        expect(messages("10 GOTO 40000\n20 GOTO 32767\n30 GOTO 32768")).toEqual([
            CannotExist(40000),
            Missing(32767),
            CannotExist(32768),
        ]);
        expect(messages("10 GOTO 32768\n32768 PRINT")).toEqual([
            CannotExist(32768),
            ExplicitTooBig(32768),
        ]);
    });

    it("should mark a reference of 65536 or more with what BASIC makes of it, which the ROM does not reject", () => {
        const cases = [
            ["GOTO 65535", [CannotExist(65535)]],
            ["GOTO 65536", [Wraps(65536, 0)]],
            ["GOTO 70000", [Wraps(70000, 4464)]],
            ["GOSUB 70000", [Wraps(70000, 4464)]],
            ["RESTORE 70000", [Wraps(70000, 4464)]],
            ["ON X GOTO 10,65546", [Wraps(65546, 10)]],
            ["GOTO 2147483647", [Wraps(2147483647, 65535)]],
            ["TRACE 65535", []],
            ["TRACE 65536", [Wraps(65536, 0)]],
            ["TRACE 65546", [Wraps(65546, 10)]],
            ["IF X THEN 65535", [CannotExist(65535, "Syntax error")]],
            ["IF X THEN 70000", [CannotExist(70000, "Syntax error")]],
            ["IF X THEN PRINT ELSE 70000", [CannotExist(70000, "Syntax error")]],
            ["IF X THEN 32768", [CannotExist(32768, "Syntax error")]],
        ];
        for (const [statement, expected] of cases) {
            const text = `10 ${statement}\n20 END`;
            expect(messages(text), text).toEqual(expected);
        }
    });

    it("should mark a reference BASIC says Too big to, from 2147483648", () => {
        for (const statement of ["GOTO", "GOSUB", "RESTORE", "TRACE", "ON X GOTO"]) {
            const text = `10 ${statement} 3333333333\n20 END`;
            expect(messages(text), text).toEqual([TooBig(3333333333)]);
        }
        expect(messages("10 TRACE 2147483648\n20 END")).toEqual([TooBig(2147483648)]);
    });

    it("should mark each explicit line number above 32767 and none up to it", () => {
        expect(problems("32767 PRINT\n32768 PRINT\n 40000 PRINT")).toEqual([
            [2, "1-6", ExplicitTooBig(32768)],
            [3, "2-7", ExplicitTooBig(40000)],
        ]);
    });

    it("should mark the first line that would be numbered above 32767, and no later line", () => {
        const lines = Array.from({length: 3278}, (_, i) => `PRINT ${i}`);
        lines[3000] = "  GOTO 32760";
        expect(problems(lines.join("\n"))).toEqual([[3277, "1-11", ImplicitTooBig(32770)]]);
        expect(messages(lines.slice(0, 3276).join("\n"))).toEqual([]);
        expect(messages(lines.join("\n"))).toHaveLength(1);
    });

    it("should treat lines after the first above 32767 as not there", () => {
        expect(messages("10 GOTO 20\n40000 PRINT\n20 END")).toEqual([
            Missing(20),
            ExplicitTooBig(40000),
        ]);
    });

    it("should not mark a missing line on the line the cursor is on", () => {
        const text = "10 GOTO 100\n20 GOTO 200";
        expect(messages(text, 1)).toEqual([Missing(200)]);
        expect(messages(text, 3)).toEqual([Missing(100), Missing(200)]);
        expect(messages("10 GOTO 40000", 1)).toEqual([CannotExist(40000)]);
    });

    it("should mark nothing in a program that is fine", () => {
        const text = [
            "10 PRINT 1",
            "20 IF X THEN 10 ELSE 30",
            "30 ON X GOSUB 10,20",
            "40 END",
        ].join("\n");
        expect(messages(text)).toEqual([]);
        expect(messages("")).toEqual([]);
    });
});
