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
