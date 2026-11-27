// @vitest-environment node
import {describe, expect, it} from "vitest";
import {tapeImage, TapeFileName} from "../src/tape-export";
import {booted, cpuOf, SavingMachines} from "./machine_helpers";

const IoProcessor = 0xffff0000;
const Hello = 'PRINT "OWLET OK"';
const EmulatorTestTimeout = 120000;
const TapeSearchCycles = 80000000;
const CommandCycles = 10000000;
const BasicPageHighByte = 0x18;
const BasicTopLow = 0x12;
const BasicTopHigh = 0x13;
const UefHeaderBytes = 12;
const DataBlockChunk = 0x0100;
const BlockSync = 0x2a;
const ProgramStartsAfterLine = 2;
const NewMarker = 0xff;

const readLe = (bytes, at, size) =>
    bytes.slice(at, at + size).reduce((sum, byte, i) => sum + byte * 2 ** (8 * i), 0);

// The first data block of a UEF, from its chunks: the file's name, and its load and exec addresses.
function firstBlock(uef) {
    let at = UefHeaderBytes;
    while (at < uef.length) {
        const id = readLe(uef, at, 2);
        const length = readLe(uef, at + 2, 4);
        at += 6;
        if (id === DataBlockChunk) {
            expect(uef[at]).toBe(BlockSync);
            const end = uef.indexOf(0, at + 1);
            return {
                name: String.fromCharCode(...uef.slice(at + 1, end)),
                load: readLe(uef, end + 1, 4),
                exec: readLe(uef, end + 5, 4),
                length: readLe(uef, end + 11, 2),
            };
        }
        at += length;
    }
    throw new Error("No data block in the tape image");
}

// The tokenised program BASIC holds from PAGE to TOP, and the machine it is on.
async function withProgram(machine, extraRoms) {
    const session = await booted(machine, extraRoms);
    const cpu = cpuOf(session);
    await session.loadBasic(`10 ${Hello}`);
    const page = cpu.readmem(BasicPageHighByte) << 8;
    const top = cpu.readmem(BasicTopLow) | (cpu.readmem(BasicTopHigh) << 8);
    const program = [];
    for (let address = page; address < top; ++address) program.push(cpu.readmem(address));
    return {session, program, image: Uint8Array.from(tapeImage(program, cpu))};
}

// A fresh machine with `image` in its cassette recorder, the tape filing system selected and the command typed.
async function withTape({machine, extraRoms}, image, command) {
    const session = await booted(machine, extraRoms);
    await session.loadTape("owletExport.uef", image);
    await session.type("*TAPE");
    await session.runUntilPrompt();
    await session.type(command);
    return session;
}

async function afterRunning(session, cycles) {
    await session.runFor(cycles);
    return session.drainOutput().screenText;
}

describe("The exported tape", () => {
    for (const {name, machine, extraRoms, page, exec, skip} of SavingMachines) {
        describe(`on the ${name}`, () => {
            it.skipIf(skip)(
                "should be headed as a real SAVE would head it, and be on the tape's catalogue",
                async () => {
                    const {program, image} = await withProgram(machine, extraRoms);
                    expect(firstBlock([...image])).toEqual({
                        name: TapeFileName,
                        load: IoProcessor + page,
                        exec: IoProcessor + exec,
                        length: program.length,
                    });

                    const session = await withTape({machine, extraRoms}, image, "*CAT");
                    const length = program.length.toString(16).toUpperCase().padStart(4, "0");
                    expect(await afterRunning(session, TapeSearchCycles)).toContain(
                        `${TapeFileName}      00 ${length}`,
                    );
                },
                EmulatorTestTimeout,
            );

            it.skipIf(skip)(
                "should load at PAGE with *LOAD, and run",
                async () => {
                    const {program, image} = await withProgram(machine, extraRoms);
                    const session = await withTape(
                        {machine, extraRoms},
                        image,
                        `*LOAD ${TapeFileName}`,
                    );
                    expect(await afterRunning(session, TapeSearchCycles)).toContain("Loading");
                    const cpu = cpuOf(session);
                    expect(program.map((_, i) => cpu.readmem(page + i))).toEqual(program);

                    await session.type("OLD");
                    await session.type("RUN");
                    expect(await afterRunning(session, CommandCycles)).toContain("OWLET OK");
                },
                EmulatorTestTimeout,
            );

            it.skipIf(skip)(
                "should load at PAGE and enter BASIC with *RUN, as a real SAVE's file does",
                async () => {
                    const {program, image} = await withProgram(machine, extraRoms);
                    const session = await withTape(
                        {machine, extraRoms},
                        image,
                        `*RUN ${TapeFileName}`,
                    );
                    await afterRunning(session, TapeSearchCycles);
                    const cpu = cpuOf(session);
                    // Entered at BASIC's entry, which starts with NEW (it marks the program's end at PAGE+1), over
                    // the program that was loaded where PAGE is
                    expect(cpu.readmem(page + 1)).toBe(NewMarker);
                    expect(
                        program
                            .slice(ProgramStartsAfterLine)
                            .map((_, i) => cpu.readmem(page + ProgramStartsAfterLine + i)),
                    ).toEqual(program.slice(ProgramStartsAfterLine));

                    await session.type("PRINT 1+1");
                    expect(await afterRunning(session, CommandCycles)).toMatch(/\b2\b/);
                },
                EmulatorTestTimeout,
            );
        });
    }
});
