// @vitest-environment node
import {describe, expect, it} from "vitest";
import {MachineSession} from "jsbeeb/machine-session";
import {discFor} from "jsbeeb/src/fdc";
import {MainView, peekViewed, ShadowView} from "jsbeeb/src/paging";
import {discImage, screenDump, ScreenEnd, ScreenStart} from "../src/disc-export";

const Drawing = [
    "VDU23,1,0;0;0;0;",
    "GCOL0,1:MOVE0,0:DRAW1279,1023",
    "GCOL0,2:MOVE100,100:MOVE600,100:PLOT85,300,700",
    'PRINT TAB(3,3)"OWLET"',
];
const ShadowModeBit = 128;
const AccconX = 4;
const PagesShadowForCpu = `?&FE34=?&FE34 OR ${AccconX}`;
const CyclesPerLoadCheck = 1000000;
const MostLoadChecks = 40;
const EmulatorTestTimeout = 60000;

async function booted(machine) {
    const session = new MachineSession(machine);
    await session.initialise();
    await session.boot();
    return session;
}

async function ran(machine, lines) {
    const session = await booted(machine);
    await session.loadBasic(lines.join("\n"));
    await session.type("RUN");
    await session.runUntilPrompt();
    await session.runFrames(2);
    return session;
}

const cpuOf = session => session._machine.processor;

function bytesIn(view, cpu) {
    const bytes = [];
    for (let address = ScreenStart; address < ScreenEnd; ++address)
        bytes.push(peekViewed(cpu, view, address));
    return bytes;
}

function readmemDump(cpu) {
    const bytes = [];
    for (let address = ScreenStart; address < ScreenEnd; ++address)
        bytes.push(cpu.readmem(address));
    return bytes;
}

// The picture a machine shows after `*LOAD SCREEN` from `image` in `mode`, with the cursor off and nothing printed
// over it.
async function loadedScreen(machine, image, mode) {
    const session = await booted(machine);
    const cpu = cpuOf(session);
    cpu.fdc.loadDisc(0, discFor("owletExport.ssd", image));
    await session.type(`MODE ${mode}:VDU23,1,0;0;0;0;:OSCLI"LOAD SCREEN":REPEAT UNTIL FALSE`);
    const {screen} = screenFile(image);
    for (let check = 0; check < MostLoadChecks; ++check) {
        if (bytesIn(MainView, cpu).every((byte, i) => byte === screen[i])) break;
        await session.runFor(CyclesPerLoadCheck);
    }
    await session.runFrames(2);
    return session.screenshot();
}

// The SCREEN file in a DFS image, from its catalogue entry: name in sector 0, addresses, length and start in sector 1.
function screenFile(image) {
    const CatalogueEntry = 8;
    const fileCount = image[0x105] / CatalogueEntry;
    for (let file = 1; file <= fileCount; ++file) {
        const at = file * CatalogueEntry;
        const name = String.fromCharCode(...image.slice(at, at + 7)).trimEnd();
        if (name !== "SCREEN") continue;
        const info = image.slice(0x100 + at, 0x100 + at + CatalogueEntry);
        const extra = info[6];
        const highBits = shift => (extra >> shift) & 3;
        // DFS keeps two bits of each address's top half, both set for &FFFF, the I/O processor.
        const loadHigh = highBits(2) === 3 ? 0xffff : highBits(2);
        const length = info[4] | (info[5] << 8) | (highBits(4) << 16);
        const start = (info[7] | (highBits(0) << 8)) * 0x100;
        return {
            load: loadHigh * 0x10000 + (info[0] | (info[1] << 8)),
            length,
            screen: Array.from(image.slice(start, start + length)),
        };
    }
    throw new Error("No SCREEN file in the disc image");
}

describe("The exported disc's SCREEN file", () => {
    it(
        "should hold &3000 to &7FFF as the Model B's CPU reads it, in every mode, as it always has",
        async () => {
            const session = await booted("B");
            const cpu = cpuOf(session);
            for (let mode = 0; mode <= 7; ++mode) {
                await session.type(`MODE ${mode}:PRINT"OWLET":MOVE0,0:DRAW1279,1023`);
                await session.runUntilPrompt();
                const {load, length, screen} = screenFile(discImage([], cpu));
                expect({mode, load, length}).toEqual({mode, load: 0xffff3000, length: 0x5000});
                expect(screen).toEqual(readmemDump(cpu));
            }
        },
        EmulatorTestTimeout,
    );

    for (const mode of [129, 132, 135]) {
        it(
            `should show in MODE ${mode - ShadowModeBit} what the Master showed in MODE ${mode}`,
            async () => {
                const session = await ran("Master", [`MODE ${mode}`, ...Drawing]);
                const image = discImage([], cpuOf(session));
                const loaded = await loadedScreen("Master", image, mode - ShadowModeBit);
                expect(loaded.equals(await session.screenshot())).toBe(true);
            },
            EmulatorTestTimeout,
        );
    }

    describe("should hold what the Master's video reads, whatever its CPU has paged in", () => {
        const cases = [
            {name: "a shadow mode", lines: ["MODE 129", ...Drawing], shows: ShadowView},
            {
                name: "a shadow mode, with the shadow RAM paged in for the CPU too",
                lines: ["MODE 129", ...Drawing, PagesShadowForCpu],
                shows: ShadowView,
            },
            {
                name: "a main RAM mode, with the shadow RAM paged in for the CPU",
                lines: ["MODE 129", ...Drawing, "MODE 1", 'PRINT"MAIN"', PagesShadowForCpu],
                shows: MainView,
            },
        ];
        for (const {name, lines, shows} of cases) {
            it(
                `in ${name}`,
                async () => {
                    const cpu = cpuOf(await ran("Master", lines));
                    const hidden = shows === ShadowView ? MainView : ShadowView;
                    expect(cpu.acccon & AccconX).toBe(
                        lines.includes(PagesShadowForCpu) ? AccconX : 0,
                    );
                    const dump = screenDump(cpu);
                    expect(dump).toEqual(bytesIn(shows, cpu));
                    expect(dump).not.toEqual(bytesIn(hidden, cpu));
                },
                EmulatorTestTimeout,
            );
        }
    });
});
