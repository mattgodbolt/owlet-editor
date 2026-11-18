// @vitest-environment node
import {describe, expect, it} from "vitest";
import {TestMachine} from "jsbeeb/src/test-machine";
import {installBasic} from "jsbeeb/src/basic-loader";
import {createTokenisers, tokeniserFor} from "../src/tokeniser";
import {Machines} from "../src/machines";
import {blankDisc} from "./blank_disc";

// What the notices after a rename say about BASIC, run on the machines as Owlet does.

const CyclesPerChunk = 500000;
const MostChunks = 60;

async function bootedMachine(machine) {
    const testMachine = new TestMachine(machine);
    await testMachine.initialise();
    await testMachine.runFor(Machines[machine].startCycles);
    testMachine.startCapture();
    return {testMachine, tokenisers: await createTokenisers()};
}

// What the machine prints for a command, up to the prompt that follows it.
async function command({testMachine}, text) {
    testMachine.drainText();
    await testMachine.type(text);
    let shown = "";
    for (let chunk = 0; chunk < MostChunks && !/>$/.test(shown); ++chunk) {
        await testMachine.runFor(CyclesPerChunk);
        shown += testMachine.drainText({raw: true});
    }
    return shown.replace(/\n+/g, "\n").replace(/^.*\n/, "").replace(/\n?>$/, "");
}

async function program(booted, lines) {
    const {testMachine, tokenisers} = booted;
    await command(booted, "NEW");
    installBasic(tokeniserFor(tokenisers, testMachine.processor.model).tokenise(lines.join("\n")), {
        readByte: address => testMachine.readbyte(address),
        writeByte: (address, value) => testMachine.writebyte(address, value),
    });
    return command(booted, "RUN");
}

// Puts the machine code in a new byte array called name, from the DATA at the end of the program.
const assembled = (name, code) => [
    `1 DIM ${name} ${code.length}:FOR J%=0 TO ${code.length - 1}:READ ${name}?J%:NEXT`,
    `90 DATA ${code.join(",")}`,
];
// Stores the registers it is called with: A, X and Y at &70 to &72, and the flags at &73.
const StoreRegisters = [0x08, 0x85, 0x70, 0x86, 0x71, 0x84, 0x72, 0x68, 0x85, 0x73, 0x60];
// LDA #&11:LDX #&22:LDY #&33:SEC:RTS
const SetRegisters = [0xa9, 0x11, 0xa2, 0x22, 0xa0, 0x33, 0x38, 0x60];
const StoredRegisters = 'P.~?&70;" ";~?&71;" ";~?&72;" ";?&73 AND 1';
const Residents = [..."@ABCDEFGHIJKLMNOPQRSTUVWXYZ"].map(letter => `${letter}%`);

// Olly's example from #294, with the loop variable's name as given, and then what the loop took in centiseconds.
const sineTable = name => [
    `10 DIMS(360):TIME=0:F.${name}=0TO360:S(${name})=SINRAD${name}:Q=Q+S(${name}):N.`,
    `20 T=TIME:P.Q,S(1),S(90),S(180),S(360),${name}`,
    "30 P.T",
];

describe.each(["B", "Master"])("On the %s", machine => {
    it("should run Olly's loop with the same values, a little faster, as an integer", async () => {
        const booted = await bootedMachine(machine);
        const [real, integer] = [
            (await program(booted, sineTable("I"))).split("\n"),
            (await program(booted, sineTable("I%"))).split("\n"),
        ];
        expect(integer.slice(0, -1)).toEqual(real.slice(0, -1));
        expect(real.slice(0, -1).join("")).toContain("361");
        expect(Number(integer.at(-1))).toBeLessThan(Number(real.at(-1)));
    });

    it("should store what an integer cannot hold as its whole part, or refuse it as too big", async () => {
        const booted = await bootedMachine(machine);
        const stored = 'P.STR$(I%)+" "+STR$(J%)+" "+STR$(K%)';
        expect(await program(booted, [`10 I%=0.5:J%=-0.5:K%=-1.5:${stored}`])).toBe("0 0 -1");
        expect(await program(booted, [`10 DIM S%(1):S%(1)=1.9:P.S%(1)`])).toBe("         1");
        for (const assignment of [
            "I%=2147483648",
            "I%=-2147483649",
            "I%=1E10",
            "DIM S%(1):S%(1)=1E10",
        ])
            expect(await program(booted, [`10 ${assignment}`])).toBe("Too big at line 10");
        // Both ends of the range are values an integer holds, though a typed -2147483648 is read as a minus and a number.
        expect(await program(booted, ['10 I%=2147483647:J%=-2147483647-1:P.~I%;" ";~J%'])).toBe(
            "  7FFFFFFF 80000000",
        );
        expect(await program(booted, ["10 I%=-2147483648"])).toBe("Too big at line 10");
        expect(await program(booted, ["10 I=1E10:P.I"])).toBe("      1E10");
    });

    it("should leave a resident integer to CALL and USR, and RUN, CLEAR and NEW", async () => {
        const booted = await bootedMachine(machine);
        // A real variable has to be written before it is read, and a resident integer does not.
        expect(await program(booted, ["10 P.Q"])).toBe("No such variable at line 10");
        expect(await program(booted, ["10 P.Q%"])).toBe("         0");
        expect(await program(booted, ["10 P.a%"])).toBe("No such variable at line 10");
        await command(booted, "A%=42");
        expect(await program(booted, ["10 P.A%"])).toBe("        42");
        await command(booted, "CLEAR");
        expect(await command(booted, "PRINT A%")).toBe("        42");
        await command(booted, "NEW");
        expect(await command(booted, "PRINT A%")).toBe("        42");
        // The loop variable is what OSWRCH prints.
        expect(await program(booted, ["10 FOR A%=65 TO 67:CALL &FFEE:NEXT"])).toBe("ABC");
        expect(await program(booted, ["10 A%=65:R%=USR(&FFEE)"])).toBe("A");
    });

    it("should set the accumulator, X, Y and carry from A%, X%, Y% and bit 0 of C%, and nothing from the others", async () => {
        const booted = await bootedMachine(machine);
        const called = async (assignments, call = "CALL s%") =>
            program(booted, [
                ...assembled("s%", StoreRegisters),
                `20 ${assignments}:${call}:${StoredRegisters}`,
            ]);
        for (const [carry, set] of [
            [0, 0],
            [1, 1],
            [2, 0],
            [3, 1],
            [-1, 1],
        ])
            expect(await called(`A%=&41:X%=&58:Y%=&59:C%=${carry}`)).toBe(
                `        41 58 59 ${set}`,
            );
        expect(await called("A%=&1234:X%=-1:Y%=&100:C%=0")).toBe("        34 FF 0 0");
        const others = Residents.filter(name => !["A%", "C%", "X%", "Y%"].includes(name))
            .map((name, i) => `${name}=${i === 0 ? 10 : 200 + i}`)
            .join(":");
        expect(await called(`A%=1:X%=2:Y%=3:C%=0:${others}`)).toBe("         1 2 3 0");
        expect(await called("A%=&41:X%=&58:Y%=&59:C%=1", "R%=USR(s%)")).toBe("        41 58 59 1");
    });

    it("should return the registers from USR, and set no variable from them after CALL or USR", async () => {
        const booted = await bootedMachine(machine);
        const lines = call => [
            ...assembled("l%", SetRegisters),
            `20 A%=1:X%=2:Y%=3:C%=0:P%=5:${call}:P.A%;X%;Y%;C%;P%`,
        ];
        // The flags, Y, X and the accumulator, from the top byte down: &31 is the carry and the bits always set.
        expect(await program(booted, lines("P.~USR(l%)"))).toBe("  31332211\n         12305");
        expect(await program(booted, lines("CALL l%"))).toBe("         12305");
    });

    it("should have only @% and A% to Z% resident, which RUN, CLEAR, NEW, LOAD and CHAIN leave alone", async () => {
        const booted = await bootedMachine(machine);
        const printAll = `P.${Residents.join(';" ";')}`;
        expect(await program(booted, [`10 ${printAll}`])).toBe(`      2314${" 0".repeat(26)}`);
        await command(
            booted,
            Residents.slice(1)
                .map((name, i) => `${name}=${i + 1}`)
                .join(":"),
        );
        const set = `      2314 ${Array.from({length: 26}, (_, i) => i + 1).join(" ")}`;
        await command(booted, "CLEAR");
        await command(booted, "NEW");
        expect(await command(booted, printAll)).toBe(set);
        expect(await program(booted, [`10 ${printAll}`])).toBe(set);
        for (const name of ["a%", "i%", "z%", "AB%", "II%"])
            expect(await program(booted, [`10 P.${name}`]), name).toBe(
                "No such variable at line 10",
            );
        // A program's integer that is not resident is gone after RUN, CLEAR, LOAD or CHAIN.
        await program(booted, ["10 P.I%;i%"]);
        for (const forget of ["RUN", "CLEAR"]) {
            await command(booted, "I%=5:i%=6");
            expect(
                await command(booted, forget === "RUN" ? "RUN" : "CLEAR:P.I%;i%"),
                forget,
            ).toMatch(/^\s*5\nNo such variable( at line 10)?$/);
        }
        booted.testMachine.loadDiscData(blankDisc());
        await program(booted, ['10 P.I%;" ";~@%;" ";Z%:P.i%']);
        await command(booted, 'SAVE "T"');
        await command(booted, "@%=&20A:Z%=9:i%=6");
        await command(booted, 'LOAD "T"');
        expect(await command(booted, 'P.I%;" ";~@%;" ";Z%:P.i%'), "LOAD").toBe(
            "         5 20A 9\nNo such variable",
        );
        await command(booted, "i%=6");
        expect(await command(booted, 'CHAIN "T"'), "CHAIN").toBe(
            "         5 20A 9\nNo such variable at line 10",
        );
    });
});
