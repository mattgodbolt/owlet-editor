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
                    // BASIC gives this line 0, as it does a command typed at the prompt.
                    lines: ["0 PRINT 1/0"],
                    error: {number: 18, message: "Division by zero", line: 0, marked: "PRINT 1/0"},
                },
                {
                    lines: ["0 X=1:STOP"],
                    error: {number: 0, message: "STOP", line: 0, marked: "STOP"},
                },
                {
                    lines: ["A=1", "X=1:STOP:Y=2"],
                    error: {number: 0, message: "STOP", line: 20, marked: "STOP"},
                },
                {
                    // An assignment leaves the statement pointer on the byte before it, here THEN.
                    lines: ["IF 1 THEN X=Q"],
                    error: {number: 26, message: "No such variable", line: 10, marked: "X=Q"},
                },
                {
                    lines: ["IF 1 THENX=Q"],
                    error: {number: 26, message: "No such variable", line: 10, marked: "X=Q"},
                },
                {
                    lines: ["IF1X=Q"],
                    error: {number: 26, message: "No such variable", line: 10, marked: "X=Q"},
                },
                {
                    lines: ["IF 0 THEN A=1 ELSE X=Q"],
                    error: {number: 26, message: "No such variable", line: 10, marked: "X=Q"},
                },
                {
                    lines: ["IF 0 THEN A=1 ELSEX=Q"],
                    error: {number: 26, message: "No such variable", line: 10, marked: "X=Q"},
                },
                {
                    lines: ["IF 1 THEN X=1:Y=Q"],
                    error: {number: 26, message: "No such variable", line: 10, marked: "Y=Q"},
                },
                {
                    lines: ["IF 1 THEN X=1: Y=Q"],
                    error: {number: 26, message: "No such variable", line: 10, marked: "Y=Q"},
                },
                {
                    lines: ["IF 0 THEN X=1 ELSE Y=1:Z=Q"],
                    error: {number: 26, message: "No such variable", line: 10, marked: "Z=Q"},
                },
                {
                    lines: ["IF 1 THEN IF 1 THEN X=Q"],
                    error: {number: 26, message: "No such variable", line: 10, marked: "X=Q"},
                },
                {
                    lines: ["IF 1 THEN PRINT 1/0"],
                    error: {number: 18, message: "Division by zero", line: 10, marked: "PRINT 1/0"},
                },
                {
                    lines: ["IF Q THEN X=1"],
                    error: {number: 26, message: "No such variable", line: 10, marked: "IF Q THEN"},
                },
                {
                    lines: ["REP. X=Y"],
                    error: {number: 26, message: "No such variable", line: 10, marked: "X=Y"},
                },
                {
                    lines: ["REPEATX=Y"],
                    error: {number: 26, message: "No such variable", line: 10, marked: "X=Y"},
                },
                {
                    lines: ["IF 1 THEN REPEAT X=Q"],
                    error: {number: 26, message: "No such variable", line: 10, marked: "X=Q"},
                },
                {
                    lines: ["REPEAT X=X+1:UNTIL X=Q"],
                    error: {number: 26, message: "No such variable", line: 10, marked: "UNTIL X=Q"},
                },
                {
                    lines: ["PROCX", "DEFPROCX X=Y"],
                    error: {number: 26, message: "No such variable", line: 20, marked: "X=Y"},
                },
                {
                    lines: ["PROCX(1)", "END", "DEFPROCX(A) X=Q"],
                    error: {number: 26, message: "No such variable", line: 30, marked: "X=Q"},
                },
                {
                    // BASIC reads a PROC's arguments at its DEF, and ERL is the DEF's line.
                    lines: ["PROCX(1,Q)", "END", "DEFPROCX(A,B)X=1"],
                    error: {
                        number: 26,
                        message: "No such variable",
                        line: 30,
                        marked: "DEFPROCX(A,B)",
                    },
                },
                {
                    lines: ["IFFNX", "DEFFNX X=Y"],
                    error: {number: 26, message: "No such variable", line: 20, marked: "X=Y"},
                },
                {
                    lines: ["X=FNX(2)", "END", "DEFFNX(A) X=Q"],
                    error: {number: 26, message: "No such variable", line: 30, marked: "X=Q"},
                },
                {
                    lines: ["P.FNX", "DEFFNX:IF1=1=Q"],
                    error: {number: 26, message: "No such variable", line: 20, marked: "=Q"},
                },
                {
                    lines: ["ON 5 GOTO 20 ELSE X=Q", "X=1"],
                    error: {number: 26, message: "No such variable", line: 10, marked: "X=Q"},
                },
                {
                    lines: ["ON 3 GOTO 20,30 ELSE X=Q", "X=1"],
                    error: {number: 26, message: "No such variable", line: 10, marked: "X=Q"},
                },
                {
                    lines: ["X=1:ON 5 GOTO 20", "X=1"],
                    error: {number: 40, message: "ON range", line: 10, marked: "ON 5 GOTO 20"},
                },
                {
                    lines: ["FOR I=1 TO Q:NEXT"],
                    error: {
                        number: 26,
                        message: "No such variable",
                        line: 10,
                        marked: "FOR I=1 TO Q",
                    },
                },
                {
                    lines: ["FOR I=1 TO 2:X=Q:NEXT"],
                    error: {number: 26, message: "No such variable", line: 10, marked: "X=Q"},
                },
                {
                    lines: ["FORI=1TO2:NEXTI:X=Q"],
                    error: {number: 26, message: "No such variable", line: 10, marked: "X=Q"},
                },
                {
                    lines: ["X=1:Y=Q:REM a:b"],
                    error: {number: 26, message: "No such variable", line: 10, marked: "Y=Q"},
                },
                {
                    lines: ["X=1: :Y=Q"],
                    error: {number: 26, message: "No such variable", line: 10, marked: "Y=Q"},
                },
                {
                    lines: ["X=1: PRINT 1/0 :Y=2"],
                    error: {number: 18, message: "Division by zero", line: 10, marked: "PRINT 1/0"},
                },
                {
                    lines: ["X=1:PRINT Q"],
                    error: {number: 26, message: "No such variable", line: 10, marked: "PRINT Q"},
                },
                {
                    lines: ["GOTO 20", "X=Q:Y=1"],
                    error: {number: 26, message: "No such variable", line: 20, marked: "X=Q"},
                },
                {
                    // A statement BASIC has finished leaves the statement pointer on what ends it.
                    lines: ["X$=1:Y=2"],
                    error: {number: 6, message: "Type mismatch", line: 10, marked: "X$=1"},
                },
                {
                    lines: ["IF 1 THEN X$=1 ELSE Y=2"],
                    error: {number: 6, message: "Type mismatch", line: 10, marked: "X$=1"},
                },
                {
                    lines: ["IF 1 THEN STOP ELSE Y=2"],
                    error: {number: 0, message: "STOP", line: 10, marked: "STOP"},
                },
                {
                    lines: ["X=1:RETURN"],
                    error: {number: 38, message: "No GOSUB", line: 10, marked: "RETURN"},
                },
                {
                    lines: ["IF 1 THEN RETURN ELSE X=1"],
                    error: {number: 38, message: "No GOSUB", line: 10, marked: "RETURN"},
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

            it("keeps an error in a line 0 through commands typed at the prompt", async () => {
                const booted = await bootedMachine(machine);
                const watch = new BasicWatch();
                watch.read(booted.cpu);
                const lines = ["0 X=1:PRINT 1/0"];
                await run(booted, lines);
                const stopped = {
                    number: 18,
                    message: "Division by zero",
                    line: 0,
                    marked: "PRINT 1/0",
                };
                expect(describeError(watch.read(booted.cpu).error, lines, booted)).toEqual(stopped);
                for (const command of ["MODE 7", "PRINT 1/0"]) {
                    await booted.testMachine.type(command);
                    await booted.testMachine.runFor(CyclesPerRun);
                    expect(describeError(watch.read(booted.cpu).error, lines, booted)).toEqual(
                        stopped,
                    );
                }
            });

            it.each([
                {name: "after a program that ended", lines: ["0 X=1", "END"]},
                // BASIC gives this the line LIST had got to.
                {name: "while it lists the program", lines: Array(300).fill("REM"), list: true},
            ])("shows Escape pressed at the prompt $name as typed there", async ({lines, list}) => {
                const booted = await bootedMachine(machine);
                const watch = new BasicWatch();
                watch.read(booted.cpu);
                await run(booted, lines);
                if (list) {
                    await booted.testMachine.type("LIST");
                    await booted.testMachine.runFor(CyclesPerRun * 3);
                    expect(watch.read(booted.cpu).error).toBeNull();
                }
                booted.testMachine.keyDown("Escape");
                await booted.testMachine.runFor(CyclesPerRun);
                booted.testMachine.keyUp("Escape");
                await booted.testMachine.runFor(CyclesPerRun);
                expect(watch.read(booted.cpu).error).toEqual({
                    number: 17,
                    message: "Escape",
                    line: null,
                });
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

// An empty, formatted DFS disc, so that a * command DFS does not know is looked for on it and is not found.
function blankDisc() {
    const SingleSidedBytes = 200 * 1024;
    const SectorCount = 800;
    const disc = new Uint8Array(SingleSidedBytes);
    disc[0x106] = SectorCount >> 8;
    disc[0x107] = SectorCount & 0xff;
    return disc;
}

// What the watch shows of the errors ON ERROR handlers took, with the error the program stopped with, and ERL as a
// handler noted it in L%.
function handledShown(state, lines, machine) {
    return {
        total: state.handled.total,
        errors: state.handled.errors.map(({number, message, line, handler, count}) => ({
            number,
            message,
            line: line?.number ?? null,
            marked: line && markedText(lines, machine, line),
            handler,
            count,
        })),
        stopped: describeError(state.error, lines, machine),
        erl: state.residents.find(({name}) => name === "L%")?.value,
    };
}

async function runWatched(machine, lines, {disc} = {}) {
    const booted = await bootedMachine(machine);
    if (disc) booted.testMachine.loadDiscData(blankDisc());
    const watch = new BasicWatch();
    watch.read(booted.cpu);
    await run(booted, lines);
    // DFS reads the disc before it finds nothing there.
    if (disc) await booted.testMachine.runFor(CyclesPerRun * 40);
    return {booted, watch};
}

const taken = (number, message, line, marked, handler, count = 1) => ({
    number,
    message,
    line,
    marked,
    handler,
    count,
});

describe("BasicWatch handled errors", () => {
    for (const machine of ["B", "Master"]) {
        describe(`on the ${machine}`, () => {
            it.each([
                {
                    name: "a handler that prints nothing and carries on",
                    lines: ["ON ERROR L%=ERL:N%=N%+1:IF N%<3 GOTO 20 ELSE END", "X=1:Y=Q:Z=1"],
                    errors: [taken(26, "No such variable", 20, "Y=Q", 10, 3)],
                    erl: "20",
                },
                {
                    // The text pointer is a byte further into the line after the GOTO than after the line before.
                    name: "an error at the start of a line, however it was reached",
                    lines: ["ON ERROR L%=ERL:N%=N%+1:IF N%<3 GOTO 20 ELSE END", "X=Q"],
                    errors: [taken(26, "No such variable", 20, "X=Q", 10, 3)],
                    erl: "20",
                },
                {
                    name: "an assignment straight after THEN, however it was reached",
                    lines: ["ON ERROR L%=ERL:N%=N%+1:IF N%<3 GOTO 20 ELSE END", "IF 1 THEN X=Q"],
                    errors: [taken(26, "No such variable", 20, "X=Q", 10, 3)],
                    erl: "20",
                },
                {
                    name: "an assignment straight after an IF's condition, however it was reached",
                    lines: ["ON ERROR L%=ERL:N%=N%+1:IF N%<3 GOTO 20 ELSE END", "IF1X=Q"],
                    errors: [taken(26, "No such variable", 20, "X=Q", 10, 3)],
                    erl: "20",
                },
                {
                    name: "an assignment straight after ELSE, however it was reached",
                    lines: [
                        "ON ERROR L%=ERL:N%=N%+1:IF N%<3 GOTO 20 ELSE END",
                        "IF 0 THEN A=1 ELSE X=Q",
                    ],
                    errors: [taken(26, "No such variable", 20, "X=Q", 10, 3)],
                    erl: "20",
                },
                {
                    name: "an assignment straight after REPEAT, however it was reached",
                    lines: ["ON ERROR L%=ERL:N%=N%+1:IF N%<3 GOTO 20 ELSE END", "REP. X=Q"],
                    errors: [taken(26, "No such variable", 20, "X=Q", 10, 3)],
                    erl: "20",
                },
                {
                    name: "an assignment straight after a DEF PROC",
                    lines: [
                        "ON ERROR L%=ERL:N%=N%+1:IF N%<3 GOTO 20 ELSE END",
                        "PROCX",
                        "DEFPROCX X=Q",
                    ],
                    errors: [taken(26, "No such variable", 30, "X=Q", 10, 3)],
                    erl: "30",
                },
                {
                    name: "an assignment straight after a DEF FN",
                    lines: [
                        "ON ERROR L%=ERL:N%=N%+1:IF N%<3 GOTO 20 ELSE END",
                        "IFFNX",
                        "DEFFNX X=Q",
                    ],
                    errors: [taken(26, "No such variable", 30, "X=Q", 10, 3)],
                    erl: "30",
                },
                {
                    name: "a FN's result after an IF's condition",
                    lines: [
                        "ON ERROR L%=ERL:N%=N%+1:IF N%<3 GOTO 20 ELSE END",
                        "P.FNX",
                        "DEFFNX:IF1=1=Q",
                    ],
                    errors: [taken(26, "No such variable", 30, "=Q", 10, 3)],
                    erl: "30",
                },
                {
                    name: "an error in a PROC",
                    lines: [
                        "ON ERROR L%=ERL:END",
                        "PROCx",
                        "END",
                        "DEF PROCx",
                        "A=1:B=1/0",
                        "ENDPROC",
                    ],
                    errors: [taken(18, "Division by zero", 50, "B=1/0", 10)],
                    erl: "50",
                },
                {
                    name: "an error in a FN",
                    lines: ["ON ERROR L%=ERL:END", "X=FNf", "DEF FNf=1/0"],
                    errors: [taken(18, "Division by zero", 30, "=1/0", 10)],
                    erl: "30",
                },
                {
                    name: "errors in the handler itself",
                    lines: ["ON ERROR IF N%<3 THEN N%=N%+1:PRINT 1/0 ELSE END", "X=Q"],
                    errors: [
                        taken(18, "Division by zero", 10, "PRINT 1/0", 10, 3),
                        taken(26, "No such variable", 20, "X=Q", 10),
                    ],
                },
                {
                    name: "a BRK in assembled code",
                    lines: [
                        "ON ERROR L%=ERL:END",
                        "DIM C% 20",
                        "P%=C%",
                        "[OPT 0",
                        'BRK:EQUB 100:EQUS "Mine":EQUB 0',
                        "]",
                        "X=1:CALL C%",
                    ],
                    errors: [taken(100, "Mine", 70, "CALL C%", 10)],
                    erl: "70",
                },
                {
                    name: "an error from DFS",
                    lines: ["ON ERROR L%=ERL:END", "X=1:*DRIVE 9"],
                    errors: [taken(205, "Bad drive", 20, "*DRIVE 9", 10)],
                    erl: "20",
                },
                {
                    name: "an error from the MOS",
                    lines: ["ON ERROR L%=ERL:END", 'X=1:OSCLI "FX 999"'],
                    errors: [taken(254, "Bad command", 20, 'OSCLI "FX 999"', 10)],
                    erl: "20",
                },
                {
                    name: "a * command DFS does not find on the disc",
                    lines: ["ON ERROR L%=ERL:END", "*FOO"],
                    disc: true,
                    errors: [taken(254, "Bad command", 20, "*FOO", 10)],
                    erl: "20",
                },
                {
                    name: "an error in a line numbered 0",
                    lines: ["0 GOSUB 2:X=Q", "1 END", "2 ON ERROR L%=ERL:END", "3 RETURN"],
                    errors: [taken(26, "No such variable", 0, "X=Q", 2)],
                    erl: "0",
                },
                {
                    name: "the same error in an IF's condition, after its THEN and after its ELSE apart",
                    lines: [
                        "ON ERROR N%=N%+1:IF N%<3 GOTO 20 ELSE END",
                        "IF 1/N%>0.6 THEN X=1/(N%-1) ELSE PRINT 1/(N%-2)",
                    ],
                    errors: [
                        taken(18, "Division by zero", 20, "PRINT 1/(N%-2)", 10),
                        taken(18, "Division by zero", 20, "X=1/(N%-1)", 10),
                        taken(18, "Division by zero", 20, "IF 1/N%>0.6 THEN", 10),
                    ],
                },
                {
                    name: "the same error in a DEF's arguments and after its name apart",
                    lines: [
                        "ON ERROR N%=N%+1:IF N%<2 GOTO 20 ELSE END",
                        "IF N%=0 THEN PROCX(1,Q) ELSE PROCX(1,1)",
                        "END",
                        "DEFPROCX(A,B)X=Q",
                    ],
                    errors: [
                        taken(26, "No such variable", 40, "X=Q", 10),
                        taken(26, "No such variable", 40, "DEFPROCX(A,B)", 10),
                    ],
                },
                {
                    name: "the same error either side of a colon in a string as one",
                    lines: ["ON ERROR N%=N%+1:IF N%<2 GOTO 20 ELSE END", 'PRINT 1/N%;":";1/(N%-1)'],
                    errors: [taken(18, "Division by zero", 20, 'PRINT 1/N%;":";1/(N%-1)', 10, 2)],
                },
                {
                    name: "an ON ERROR that a later one replaced",
                    lines: ["ON ERROR END", "ON ERROR L%=ERL:END", "X=Q"],
                    errors: [taken(26, "No such variable", 30, "X=Q", 20)],
                    erl: "30",
                },
            ])("keeps $name", async ({lines, disc, errors, erl}) => {
                const {booted, watch} = await runWatched(machine, lines, {disc});
                expect(handledShown(watch.read(booted.cpu), lines, booted)).toEqual({
                    total: errors.reduce((total, {count}) => total + count, 0),
                    errors,
                    stopped: null,
                    erl,
                });
            });

            it.each([
                {
                    name: "an error the handler then stops with",
                    lines: ["ON ERROR ON ERROR OFF:PRINT 1/0", "X=Q"],
                    stopped: {
                        number: 18,
                        message: "Division by zero",
                        line: 10,
                        marked: "PRINT 1/0",
                    },
                },
                {
                    name: "a STOP in the handler",
                    lines: ["ON ERROR STOP", "X=Q"],
                    stopped: {number: 0, message: "STOP", line: 10, marked: "STOP"},
                },
            ])(
                "keeps a handled error apart from $name, which it does not count",
                async ({lines, stopped}) => {
                    const {booted, watch} = await runWatched(machine, lines);
                    expect(handledShown(watch.read(booted.cpu), lines, booted)).toEqual({
                        total: 1,
                        errors: [taken(26, "No such variable", 20, "X=Q", 10)],
                        stopped,
                        erl: undefined,
                    });
                },
            );

            it.each([
                {
                    name: "STOP, which BASIC's own handler takes",
                    lines: ['ON ERROR PRINT "h":END', "STOP"],
                },
                {
                    name: "an error after ON ERROR OFF",
                    lines: ["ON ERROR END", "ON ERROR OFF", "X=Q"],
                },
                {name: "no error", lines: ["ON ERROR END", "X=1"]},
                {
                    // Only the OS's own write of the error block's address is an error being raised.
                    name: "a program writing where the OS keeps the error block's address",
                    lines: [
                        "ON ERROR END",
                        'DIM B% 8:?B%=99:$(B%+1)="Fake"',
                        "!&FD=B%:?&FE=B% DIV 256",
                        "X=1",
                    ],
                },
            ])("keeps nothing for $name", async ({lines}) => {
                const {booted, watch} = await runWatched(machine, lines);
                expect(watch.read(booted.cpu).handled).toEqual({total: 0, errors: []});
            });

            it("keeps Escape pressed while a handler is set", async () => {
                const lines = ["ON ERROR L%=ERL:END", "REPEAT:A=A+1:UNTIL FALSE"];
                const {booted, watch} = await runWatched(machine, lines);
                booted.testMachine.keyDown("Escape");
                await booted.testMachine.runFor(CyclesPerRun);
                booted.testMachine.keyUp("Escape");
                await booted.testMachine.runFor(CyclesPerRun);
                const shown = handledShown(watch.read(booted.cpu), lines, booted);
                expect(shown).toMatchObject({total: 1, stopped: null, erl: "20"});
                expect(shown.errors).toEqual([
                    {
                        number: 17,
                        message: "Escape",
                        line: 20,
                        marked: expect.any(String),
                        handler: 10,
                        count: 1,
                    },
                ]);
            });

            it("keeps nothing for an error typed at the prompt, as BASIC's own handler is set again there", async () => {
                const {booted, watch} = await runWatched(machine, ["ON ERROR END", "X=1"]);
                for (const command of ['ON ERROR PRINT "h"', "PRINT 1/0"]) {
                    await booted.testMachine.type(command);
                    await booted.testMachine.runFor(CyclesPerRun);
                }
                expect(watch.read(booted.cpu)).toMatchObject({
                    handled: {total: 0, errors: []},
                    error: {number: 18, line: null},
                });
            });

            it("keeps only the last few different errors, the latest first, and counts them all", async () => {
                const lines = [
                    "ON ERROR N%=N%+1:IF N%<12 GOTO (110+10*N%) ELSE END",
                    "GOTO 110",
                    ...Array.from({length: 12}, (_, i) => `${110 + 10 * i} X=Q${i}`),
                ];
                const {booted, watch} = await runWatched(machine, lines);
                const {handled} = watch.read(booted.cpu);
                expect(handled.total).toBe(12);
                expect(handled.errors.map(({line}) => line.number)).toEqual([
                    220, 210, 200, 190, 180, 170, 160, 150,
                ]);
            });

            it("marks the assignment an ON ERROR runs, in a handler that loops on its own error", async () => {
                const lines = ["ONERROR X=Y", "Z"];
                const {booted, watch} = await runWatched(machine, lines);
                const {errors} = handledShown(watch.read(booted.cpu), lines, booted);
                expect(errors).toEqual([
                    taken(26, "No such variable", 10, "X=Y", 10, expect.any(Number)),
                    taken(4, "Mistake", 20, "Z", 10),
                ]);
            });

            it("keeps up with a handler that loops on its own error", async () => {
                // BASIC II and IV take ON ERROR LOCAL as a handler that runs LOCAL, which is an error outside a PROC.
                const {booted, watch} = await runWatched(machine, ["ON ERROR LOCAL", "X=Q"]);
                await booted.testMachine.runFor(Machines[machine].startCycles);
                const {handled} = watch.read(booted.cpu);
                expect(handled.total).toBeGreaterThan(500);
                expect(handled.errors).toHaveLength(2);
                expect(handled.errors[0]).toMatchObject({
                    message: "Not LOCAL",
                    count: handled.total - 1,
                });
            });

            it("keeps them through what is typed at the prompt, and forgets them when the program runs again", async () => {
                const lines = [
                    "ON ERROR END",
                    "IF A%=0 THEN A%=1:X=Q",
                    "INPUT V",
                    'Y=EVAL("V+1")',
                    "END",
                ];
                const booted = await bootedMachine(machine);
                const watch = new BasicWatch();
                watch.read(booted.cpu);
                await run(booted, lines.slice(0, 2));
                expect(watch.read(booted.cpu).handled.total).toBe(1);
                for (const command of ["MODE 7", "PRINT X", "LIST", "MDOE"]) {
                    await booted.testMachine.type(command);
                    await booted.testMachine.runFor(CyclesPerRun);
                    expect(watch.read(booted.cpu).handled.total).toBe(1);
                }
                await booted.testMachine.type("RUN");
                await booted.testMachine.runFor(CyclesPerRun * 5);
                expect(watch.read(booted.cpu).handled).toEqual({total: 0, errors: []});

                // Nor does an INPUT or EVAL in the program lose them.
                await run(booted, ["ON ERROR GOTO 30", "X=Q", "INPUT V", 'Y=EVAL("V+1")', "END"]);
                await booted.testMachine.type("5");
                await booted.testMachine.runFor(CyclesPerRun * 5);
                expect(watch.read(booted.cpu)).toMatchObject({
                    line: null,
                    variables: expect.arrayContaining([{name: "Y", value: "6"}]),
                    handled: {total: 1},
                });

                watch.restart();
                expect(watch.read(booted.cpu).handled).toEqual({total: 0, errors: []});
            });
        });
    }
});
