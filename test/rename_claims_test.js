// @vitest-environment node
import {describe, expect, it} from "vitest";
import {TestMachine} from "jsbeeb/src/test-machine";
import {installBasic} from "jsbeeb/src/basic-loader";
import {createTokenisers, tokeniserFor} from "../src/tokeniser";
import {Machines} from "../src/machines";

// What the notices after a rename between real and integer say about BASIC, run on the machines as Owlet does.

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
});
