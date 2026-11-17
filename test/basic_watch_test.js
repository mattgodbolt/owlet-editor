// @vitest-environment node
import {describe, expect, it} from "vitest";
import {TestMachine} from "jsbeeb/src/test-machine";
import {installBasic} from "jsbeeb/src/basic-loader";
import {basicRom, LanguageRomNumber} from "jsbeeb/src/basic-state";
import {BasicWatch} from "../src/basic-watch";
import {programStatements, statementAt} from "../src/statement-map";
import {createTokenisers, tokeniserFor} from "../src/tokeniser";
import {dialectFor} from "../src/parser/dialect";
import {Machines} from "../src/machines";

const Program = [
    "A%=1:IF A%=1 THEN B%=2:C%=3 ELSE D%=4",
    "IF A%=2 THEN E%=5 ELSE F%=6:G%=7",
    "  REPEAT H%=H%+1:UNTIL H%=2",
    "PROCp(3):X=FNf",
    "READ Y$:REM done:yes",
    "P.Y$;:END",
    "DEF PROCp(n):Z=n",
    "ENDPROC",
    "DEF FNf=42",
    'DATA "a:b"',
];
const LastStatement = "60 END";
const MostRuns = 100;
const CyclesPerRun = 100000;

// Runs the program as Owlet does, and gives the editor's text of each statement BASIC starts, in turn, as the line
// number and the text, with what the watch reads of BASIC at its END.
async function statementsRun(machine) {
    const testMachine = new TestMachine(machine);
    await testMachine.initialise();
    const cpu = testMachine.processor;
    await testMachine.runFor(Machines[machine].startCycles);
    const tokenisers = await createTokenisers();
    const text = Program.map(line => line.trimStart()).join("\n");
    installBasic(tokeniserFor(tokenisers, cpu.model).tokenise(text), {
        readByte: address => testMachine.readbyte(address),
        writeByte: (address, value) => testMachine.writebyte(address, value),
    });
    const program = programStatements(Program, dialectFor(cpu.model));
    const watch = new BasicWatch();
    const bank = cpu.bankPagedBy(cpu.peekmemAsLanguage(LanguageRomNumber));
    const {statementStart} = basicRom(cpu.romBank(bank));
    const seen = [];
    const hook = testMachine.addBreakpoint("execute", statementStart, {bank}, () => {
        const {line} = watch.read(cpu);
        if (!line) return;
        const range = statementAt(program, line);
        seen.push(
            range &&
                `${line.number} ${Program[range.lineNumber - 1].slice(
                    range.startColumn - 1,
                    range.endColumn - 1,
                )}`,
        );
    });
    await testMachine.type("RUN");
    for (let run = 0; run < MostRuns && seen.at(-1) !== LastStatement; ++run)
        await testMachine.runFor(CyclesPerRun);
    hook.remove();
    return {seen, after: watch.read(cpu)};
}

// A machine that has booted, with the watch reading it (so tracking writes) before `lines` are run as Owlet runs them.
async function bootedMachine(machine) {
    const testMachine = new TestMachine(machine);
    await testMachine.initialise();
    await testMachine.runFor(Machines[machine].startCycles);
    return {testMachine, cpu: testMachine.processor, tokenisers: await createTokenisers()};
}

async function run({testMachine, cpu, tokenisers}, lines) {
    installBasic(tokeniserFor(tokenisers, cpu.model).tokenise(lines.join("\n")), {
        readByte: address => testMachine.readbyte(address),
        writeByte: (address, value) => testMachine.writebyte(address, value),
    });
    await testMachine.type("RUN");
    await testMachine.runFor(CyclesPerRun * 5);
}

const shownResidents = watch =>
    Object.fromEntries(watch.read(watch.cpu).residents.map(({name, value}) => [name, value]));

describe("BasicWatch resident integers", () => {
    for (const machine of ["B", "Master"]) {
        describe(`on the ${machine}`, () => {
            it("shows a variable the program wrote, even if it wrote the value BASIC starts with", async () => {
                const booted = await bootedMachine(machine);
                const watch = new BasicWatch();
                watch.read(booted.cpu);
                watch.restart();
                await run(booted, ["X%=1:X%=0", "Y%=5", "FOR I%=1 TO 2:NEXT", "@%=&20209", "END"]);
                expect(shownResidents(watch)).toEqual({
                    "@%": "&00020209",
                    "I%": "3",
                    "X%": "0",
                    "Y%": "5",
                });
            });

            it("does not show a variable the program did not write", async () => {
                const booted = await bootedMachine(machine);
                const watch = new BasicWatch();
                watch.read(booted.cpu);
                watch.restart();
                await run(booted, ["A%=1", "PRINT B%,C%", "END"]);
                expect(Object.keys(shownResidents(watch))).toEqual(["A%"]);
            });

            it("forgets what was written when the machine starts again", async () => {
                const booted = await bootedMachine(machine);
                const watch = new BasicWatch();
                watch.read(booted.cpu);
                await run(booted, ["X%=1:X%=0", "END"]);
                expect(shownResidents(watch)).toEqual({"X%": "0"});
                // The reset clears every resident integer, which is not the program's doing.
                booted.cpu.reset(true);
                await booted.testMachine.runFor(Machines[machine].startCycles);
                watch.restart();
                expect(shownResidents(watch)).toEqual({});
                await run(booted, ["Y%=0", "END"]);
                expect(shownResidents(watch)).toEqual({"Y%": "0"});
            });

            it("falls back to what is not at its start value for what was written before it started watching", async () => {
                const booted = await bootedMachine(machine);
                await run(booted, ["X%=1:X%=0:Y%=5", "END"]);
                const watch = new BasicWatch();
                watch.read(booted.cpu);
                expect(shownResidents(watch)).toEqual({"Y%": "5"});
                await run(booted, ["Z%=0", "END"]);
                expect(shownResidents(watch)).toEqual({"Y%": "5", "Z%": "0"});
            });

            it("leaves the machine on its fast path when it stops watching", async () => {
                const {cpu} = await bootedMachine(machine);
                const watch = new BasicWatch();
                expect(cpu.onFastPath).toBe(true);
                watch.read(cpu);
                expect(cpu.onFastPath).toBe(false);
                watch.untrack();
                expect(cpu.onFastPath).toBe(true);
            });
        });
    }
});

describe("BasicWatch", () => {
    it("says when the language is not a BASIC", async () => {
        const testMachine = new TestMachine("B");
        await testMachine.initialise();
        const cpu = testMachine.processor;
        const bank = cpu.bankPagedBy(cpu.peekmemAsLanguage(LanguageRomNumber));
        cpu.romBank(bank).fill(0);
        expect(new BasicWatch().read(cpu)).toEqual({basic: false, title: ""});
    });

    for (const machine of ["B", "Master"]) {
        it(`follows each statement the ${machine}'s BASIC runs to its text in the editor`, async () => {
            const {seen, after} = await statementsRun(machine);
            expect(seen).toEqual([
                "10 A%=1",
                "10 IF A%=1 THEN",
                "10 B%=2",
                "10 C%=3",
                "20 IF A%=2 THEN",
                "20 F%=6",
                "20 G%=7",
                "30 REPEAT",
                "30 H%=H%+1",
                "30 UNTIL H%=2",
                "30 H%=H%+1",
                "30 UNTIL H%=2",
                "40 PROCp(3)",
                // BASIC goes on from the colon after the DEF's name, and finds an empty statement there.
                "70 DEF PROCp(n)",
                "70 Z=n",
                "80 ENDPROC",
                "40 X=FNf",
                "90 =42",
                "50 READ Y$",
                "50 REM done:yes",
                "60 P.Y$;",
                LastStatement,
            ]);
            const value = (name, text) => ({name, value: text});
            expect(after).toMatchObject({
                basic: true,
                title: "BASIC",
                residents: [
                    value("A%", "1"),
                    value("B%", "2"),
                    value("C%", "3"),
                    value("F%", "6"),
                    value("G%", "7"),
                    value("H%", "2"),
                ],
                variables: [
                    value("X", "42"),
                    value("Y$", '"a:b"'),
                    value("Z", "3"),
                    value("n", "0"),
                ],
                routines: ["PROCp", "FNf"],
            });
        });
    }
});

// The text of the editor's `lines` that `line` (as the watch gives it) marks.
function markedText(lines, machine, line) {
    const range = statementAt(programStatements(lines, dialectFor(machine.cpu.model)), line);
    return range && lines[range.lineNumber - 1].slice(range.startColumn - 1, range.endColumn - 1);
}

// The error the watch shows once `lines` have been run, as {number, message, line: number, marked: text}, or null.
async function errorShown(machine, lines) {
    const booted = await bootedMachine(machine);
    const watch = new BasicWatch();
    watch.read(booted.cpu);
    await run(booted, lines);
    return describeError(watch.read(booted.cpu).error, lines, booted);
}

function describeError(error, lines, machine) {
    if (!error) return null;
    const {number, message, line} = error;
    return {
        number,
        message,
        line: line?.number ?? 0,
        marked: line && markedText(lines, machine, line),
    };
}

describe("BasicWatch errors", () => {
    for (const machine of ["B", "Master"]) {
        describe(`on the ${machine}`, () => {
            it.each([
                {
                    lines: ['A=1:B$="X":PRINT 1/0'],
                    error: {number: 18, message: "Division by zero", line: 10, marked: "PRINT 1/0"},
                },
                {
                    lines: ["B=C:A=1"],
                    error: {number: 26, message: "No such variable", line: 10, marked: "B=C"},
                },
                {
                    lines: ["PROCx", "END", "DEF PROCx", "A=1:  B=C", "ENDPROC"],
                    error: {number: 26, message: "No such variable", line: 40, marked: "B=C"},
                },
                {
                    lines: ["X=FNf", "END", "DEF FNf=1/0"],
                    error: {number: 18, message: "Division by zero", line: 30, marked: "=1/0"},
                },
                {
                    lines: [
                        "VDU 5",
                        "FOR N%=1 TO 12",
                        "  DRAW N%*140,FNh(N%)",
                        "NEXT",
                        "DEF FNh(n)=500+4000/(10-n)",
                    ],
                    error: {
                        number: 18,
                        message: "Division by zero",
                        line: 50,
                        marked: "=500+4000/(10-n)",
                    },
                },
                {
                    lines: ["1000 A=1", "2000 B=1:C=D:E=1"],
                    error: {number: 26, message: "No such variable", line: 2000, marked: "C=D"},
                },
                {
                    lines: ["X=1:A$=1:Y=2"],
                    error: {number: 6, message: "Type mismatch", line: 10, marked: "A$=1"},
                },
                {
                    lines: ["ON ERROR OFF", "X=Q"],
                    error: {number: 26, message: "No such variable", line: 20, marked: "X=Q"},
                },
                {
                    lines: ["X=1:ENDPROC"],
                    error: {number: 13, message: "No PROC", line: 10, marked: "ENDPROC"},
                },
                {
                    lines: ["DIM C% 20", "P%=C%", "[OPT 2", "LDA #1", "JMP nowhere", "]"],
                    error: {
                        number: 26,
                        message: "No such variable",
                        line: 50,
                        marked: "JMP nowhere",
                    },
                },
                {
                    lines: [
                        "DIM C% 20",
                        "P%=C%",
                        "[OPT 0",
                        'BRK:EQUB 100:EQUS "Mine":EQUB 0',
                        "]",
                        "X=1:CALL C%",
                    ],
                    error: {number: 100, message: "Mine", line: 60, marked: "CALL C%"},
                },
                {
                    // Neither BASIC II nor BASIC IV has an ERROR statement, so the number is never more than a byte.
                    lines: ['X=1:ERROR 100,"text"'],
                    error: {
                        number: 16,
                        message: "Syntax error",
                        line: 10,
                        marked: 'ERROR 100,"text"',
                    },
                },
                {
                    // The filing system's error is copied to the bottom of the stack, and raised from there.
                    lines: ["X=1", "*DRIVE 9"],
                    error: {number: 205, message: "Bad drive", line: 20, marked: "*DRIVE 9"},
                },
                {
                    // An EVAL leaves no sign of which statement it was in, so the line is marked.
                    lines: ['X=1:Y=EVAL("ZZZ"):Z=2'],
                    error: {
                        number: 26,
                        message: "No such variable",
                        line: 10,
                        marked: 'X=1:Y=EVAL("ZZZ"):Z=2',
                    },
                },
                {
                    lines: ["A=1", "X=1:STOP:Y=2"],
                    error: {number: 0, message: "STOP", line: 20, marked: "STOP"},
                },
            ])("shows the error, line and statement of $lines", async ({lines, error}) => {
                expect(await errorShown(machine, lines)).toEqual(error);
            });

            it.each([
                {name: "ended", lines: ["A=1", "END"]},
                {name: "ran off its end", lines: ["A=1"]},
                {name: "handled its error", lines: ['ON ERROR PRINT "handled":END', "PRINT 1/0"]},
            ])("shows no error for a program that $name", async ({lines}) => {
                expect(await errorShown(machine, lines)).toBeNull();
            });

            it("shows no error for a machine that has run nothing", async () => {
                const {cpu} = await bootedMachine(machine);
                expect(new BasicWatch().read(cpu).error).toBeNull();
            });

            it("shows Escape, at the line it was pressed in", async () => {
                const booted = await bootedMachine(machine);
                const watch = new BasicWatch();
                watch.read(booted.cpu);
                const lines = ["REPEAT:A=A+1:UNTIL FALSE"];
                await run(booted, lines);
                booted.testMachine.keyDown("Escape");
                await booted.testMachine.runFor(CyclesPerRun);
                booted.testMachine.keyUp("Escape");
                await booted.testMachine.runFor(CyclesPerRun);
                expect(describeError(watch.read(booted.cpu).error, lines, booted)).toMatchObject({
                    number: 17,
                    message: "Escape",
                    line: 10,
                });
            });

            it("keeps the program's error through commands typed at the prompt, and shows one typed there otherwise", async () => {
                const booted = await bootedMachine(machine);
                const watch = new BasicWatch();
                watch.read(booted.cpu);
                const lines = ["X=1", "PRINT 1/0"];
                await run(booted, lines);
                const stopped = describeError(watch.read(booted.cpu).error, lines, booted);
                expect(stopped).toEqual({
                    number: 18,
                    message: "Division by zero",
                    line: 20,
                    marked: "PRINT 1/0",
                });
                for (const command of [
                    "MODE 7",
                    "MDOE 7",
                    "PRINT X",
                    "Q=5",
                    "LIST",
                    "PRINT FNnone",
                ]) {
                    await booted.testMachine.type(command);
                    await booted.testMachine.runFor(CyclesPerRun);
                    expect(describeError(watch.read(booted.cpu).error, lines, booted)).toEqual(
                        stopped,
                    );
                }

                watch.restart();
                await booted.testMachine.type("MDOE 7");
                await booted.testMachine.runFor(CyclesPerRun);
                expect(watch.read(booted.cpu).error).toEqual({
                    number: 4,
                    message: "Mistake",
                    line: null,
                });
                await booted.testMachine.type("MODE 7");
                await booted.testMachine.runFor(CyclesPerRun);
                expect(watch.read(booted.cpu).error).toBeNull();
            });

            it.each(["RUN", "GOTO 20", "PROCp"])(
                "forgets the error once %s typed at the prompt runs the program, however soon it ends",
                async command => {
                    const booted = await bootedMachine(machine);
                    const watch = new BasicWatch();
                    watch.read(booted.cpu);
                    await run(booted, [
                        "IF A%=0 THEN A%=1:PRINT 1/0",
                        "PROCp:END",
                        "DEF PROCp:ENDPROC",
                    ]);
                    expect(watch.read(booted.cpu).error).toMatchObject({number: 18});
                    await booted.testMachine.type(command);
                    await booted.testMachine.runFor(CyclesPerRun * 5);
                    expect(watch.read(booted.cpu)).toMatchObject({line: null, error: null});
                },
            );

            it("forgets the error once the program runs again", async () => {
                const booted = await bootedMachine(machine);
                const watch = new BasicWatch();
                watch.read(booted.cpu);
                await run(booted, ["IF A%=0 THEN A%=1:PRINT 1/0", "FOR I%=1 TO 3000:NEXT", "END"]);
                expect(watch.read(booted.cpu).error).toMatchObject({number: 18});
                await booted.testMachine.type("RUN");
                await booted.testMachine.runFor(CyclesPerRun);
                expect(watch.read(booted.cpu)).toMatchObject({line: {number: 20}, error: null});
                await booted.testMachine.runFor(CyclesPerRun * 20);
                expect(watch.read(booted.cpu)).toMatchObject({line: null, error: null});
            });

            it("marks the line of an error raised before it started watching", async () => {
                const booted = await bootedMachine(machine);
                const lines = ["X=1:PRINT 1/0:Y=2"];
                await run(booted, lines);
                const watch = new BasicWatch();
                expect(describeError(watch.read(booted.cpu).error, lines, booted)).toEqual({
                    number: 18,
                    message: "Division by zero",
                    line: 10,
                    marked: "X=1:PRINT 1/0:Y=2",
                });
            });
        });
    }
});
