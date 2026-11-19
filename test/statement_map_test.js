// @vitest-environment node
// The Master's tokeniser runs its ROM, which jsbeeb loads from a file only where there is no window.
import {describe, expect, it} from "vitest";
import {findModel} from "jsbeeb/src/models";
import {setNodeBasePath} from "jsbeeb/src/loader";
import {RepoRoot} from "jsbeeb/src/test-machine";
import {programStatements, statementAt} from "../src/statement-map";
import {dialectFor, ModelBDialect} from "../src/parser/dialect";
import {createTokenisers, tokeniseBasicII, tokeniserFor} from "../src/tokeniser";
import Examples from "../src/examples.yaml";

// The lines of a tokenised program as {number, bytes}.
function memoryLines(tokenised) {
    const lines = [];
    for (let at = 0; tokenised.charCodeAt(at + 1) !== 0xff;) {
        const length = tokenised.charCodeAt(at + 3);
        lines.push({
            number: (tokenised.charCodeAt(at + 1) << 8) | tokenised.charCodeAt(at + 2),
            bytes: [...tokenised.slice(at + 4, at + length)].map(c => c.charCodeAt(0)),
        });
        at += length;
    }
    return lines;
}

// The text of each statement BASIC can start on the program's lines, as the editor shows them, by line number.
function statementTexts(lines, dialect = ModelBDialect) {
    const program = programStatements(lines, dialect);
    return Object.fromEntries(
        [...program].map(([number, [{editorLine, statements}]]) => [
            number,
            statements.map(({startColumn, endColumn}) =>
                lines[editorLine - 1].slice(startColumn - 1, endColumn - 1),
            ),
        ]),
    );
}

// What the editor shows for BASIC reading `offset` bytes into `number` of the program as the tokeniser makes it.
function textAt(lines, number, offset, dialect = ModelBDialect) {
    const program = programStatements(lines, dialect);
    const {bytes} = memoryLines(tokeniseBasicII(lines.map(l => l.trimStart()).join("\n"))).find(
        line => line.number === number,
    );
    const range = statementAt(program, {number, bytes, offset});
    return range && lines[range.lineNumber - 1].slice(range.startColumn - 1, range.endColumn - 1);
}

describe("programStatements", () => {
    it("splits each line into the statements BASIC starts", () => {
        const cases = [
            ["PRINT 1:PRINT 2", ["PRINT 1", "PRINT 2"]],
            ["P.1:P.2", ["P.1", "P.2"]],
            ["  A=1 :  B=2  ", ["A=1", "B=2"]],
            ["IF A=1 THEN B=2:C=3 ELSE D=4", ["IF A=1 THEN", "B=2", "C=3", "ELSE", "D=4"]],
            ["IFA=1PRINT2", ["IFA=1", "PRINT2"]],
            ["IF A THEN 100 ELSE 200", ["IF A THEN 100", "ELSE 200"]],
            ["ON X GOTO 10,20 ELSE PRINT", ["ON X GOTO 10,20", "ELSE", "PRINT"]],
            ["PRINT 1 ELSE PRINT 2:PRINT 3", ["PRINT 1", "ELSE PRINT 2:PRINT 3"]],
            ["A=1:REM a:b", ["A=1", "REM a:b"]],
            ["READ X:DATA 1,2:3", ["READ X", "DATA 1,2:3"]],
            ['PRINT "a:b":*FX 1:2', ['PRINT "a:b"', "*FX 1:2"]],
            ["REPEAT A=A+1:UNTIL A>3", ["REPEAT", "A=A+1", "UNTIL A>3"]],
            ["DEF PROCa(x):PRINT x:ENDPROC", ["DEF PROCa(x)", "PRINT x", "ENDPROC"]],
            ["ON ERROR PRINT:END", ["ON ERROR", "PRINT", "END"]],
            ["GOTO 100:PRINT", ["GOTO 100", "PRINT"]],
            ["X=1:I am a badger:Y=2", ["X=1", "I am a badger", "Y=2"]],
            [":::", []],
        ];
        for (const [line, expected] of cases)
            expect(statementTexts([line])[10] ?? [], line).toEqual(expected);
    });

    it("numbers the lines as the tokeniser does", () => {
        const lines = ["PRINT 1", "", "  PRINT 3", "100 PRINT 4", "  200PRINT 5", "PRINT 6"];
        expect(statementTexts(lines)).toEqual({
            10: ["PRINT 1"],
            30: ["PRINT 3"],
            100: ["PRINT 4"],
            200: ["PRINT 5"],
            60: ["PRINT 6"],
        });
    });

    it("splits an assembler block at its colons, and each line of it", () => {
        const lines = ["DIM P% 9:[OPT 2", "LDA #1:RTS", "]:PRINT", "CALL P%"];
        expect(statementTexts(lines)).toEqual({
            10: ["DIM P% 9", "[", "OPT 2"],
            20: ["LDA #1", "RTS"],
            30: ["]", "PRINT"],
            40: ["CALL P%"],
        });
        const cases = [
            ["F.X=0TO1:[OPTx:RTS:]:N.", ["F.X=0TO1", "[", "OPTx", "RTS", "]", "N."]],
            ["[LDA#1:LDX#N:RTS:]", ["[", "LDA#1", "LDX#N", "RTS", "]"]],
            ["[ LDA #1 : .l LDX #N : RTS ]", ["[", "LDA #1", ".l LDX #N", "RTS ]"]],
            ["[LDA#1 \\ c:RTS ; d:]", ["[", "LDA#1 \\ c", "RTS ; d", "]"]],
            [
                "IF X THEN [LDA#1:RTS:] ELSE PRINT",
                ["IF X THEN", "[", "LDA#1", "RTS", "]", "ELSE", "PRINT"],
            ],
            ["[:LDA#1::RTS", ["[", "LDA#1", "RTS"]],
        ];
        for (const [line, expected] of cases)
            expect(statementTexts([line])[10], line).toEqual(expected);
    });

    it("tokenises each line as each machine's tokeniser does", async () => {
        setNodeBasePath(RepoRoot);
        const tokenisers = await createTokenisers();
        const programs = [
            ...Examples.examples.filter(example => example.basic).map(example => example.basic),
            [
                'P.TAB(10)"X":GOTO 10',
                "IF X THEN 10 ELSE 20",
                "COLOR 1:REM PRINT",
                "[\\ PRINT",
                "]",
                "ON X PROC a,b ELSE EDIT",
                "  30 TIME=0:PRINT TIME",
            ].join("\n"),
        ];
        for (const machine of ["B", "Master"]) {
            const model = findModel(machine);
            for (const text of programs) {
                const program = programStatements(text.split("\n"), dialectFor(model));
                const tokenised = tokeniserFor(tokenisers, model).tokenise(
                    text
                        .split("\n")
                        .map(line => line.trimStart())
                        .join("\n"),
                );
                for (const {number, bytes} of memoryLines(tokenised))
                    expect(
                        statementAt(program, {number, bytes, offset: 0}),
                        `${machine} ${number}`,
                    ).not.toBeNull();
            }
        }
    });
});

describe("statementAt", () => {
    it("finds the statement BASIC is reading at a byte of its line", () => {
        const lines = ["P.1:P.2", "IF A=1 THEN B=2:C=3 ELSE D=4", "GOTO 100:PRINT"];
        // P. is one byte, as are IF, THEN and ELSE; the line number after GOTO is four.
        expect([0, 1, 2, 3, 4].map(offset => textAt(lines, 10, offset))).toEqual([
            "P.1",
            "P.1",
            "P.1",
            "P.2",
            "P.2",
        ]);
        expect([0, 7, 8, 11, 12, 15, 16, 17, 18].map(offset => textAt(lines, 20, offset))).toEqual([
            "IF A=1 THEN",
            "IF A=1 THEN",
            "B=2",
            "B=2",
            "C=3",
            "C=3",
            "ELSE",
            "ELSE",
            "D=4",
        ]);
        expect([6, 7].map(offset => textAt(lines, 30, offset))).toEqual(["GOTO 100", "PRINT"]);
    });

    it("finds every statement of the line where the byte is not known", () => {
        const lines = ["  P.1 :P.2  ", "REM a:b"];
        expect(textAt(lines, 10, null)).toBe("P.1 :P.2");
        expect(textAt(lines, 20, null)).toBe("REM a:b");
    });

    it("finds nothing for a line that is not the editor's", () => {
        const program = programStatements(["PRINT 1", "10 PRINT 2"], ModelBDialect);
        const print = 0xf1;
        expect(statementAt(program, {number: 10, bytes: [32, print, 32, 50], offset: 0})).toEqual({
            lineNumber: 2,
            startColumn: 4,
            endColumn: 11,
        });
        expect(
            statementAt(program, {number: 10, bytes: [32, print, 32, 51], offset: 0}),
        ).toBeNull();
        expect(
            statementAt(program, {number: 20, bytes: [32, print, 32, 50], offset: 0}),
        ).toBeNull();
    });
});
