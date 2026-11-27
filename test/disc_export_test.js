// @vitest-environment node
import {describe, expect, it} from "vitest";
import {MachineSession} from "jsbeeb/machine-session";
import {discFor} from "jsbeeb/src/fdc";
import {MainView, peekViewed, ShadowView} from "jsbeeb/src/paging";
import {discImage, screenDump} from "../src/disc-export";

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
const ScreenEnd = 0x8000;
const IoProcessor = 0xffff0000;
const BytesPerCell = 8;
const TeletextCells = 0x400;
const TeletextStart = 0x2800;

// What each mode's screen is on the Model B and the Master, as the MOS lays it out: its size in bytes and the start of
// its screen memory, which is where the video wraps it to from &8000.
const Modes = [
    {mode: 0, size: 0x5000, base: 0x3000},
    {mode: 1, size: 0x5000, base: 0x3000},
    {mode: 2, size: 0x5000, base: 0x3000},
    {mode: 3, size: 0x4000, base: 0x4000},
    {mode: 4, size: 0x2800, base: 0x5800},
    {mode: 5, size: 0x2800, base: 0x5800},
    {mode: 6, size: 0x2000, base: 0x6000},
    {mode: 7, size: 0x400, base: 0x7c00},
];

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

function bytesIn(view, cpu, base, size) {
    const bytes = [];
    for (let address = base; address < base + size; ++address)
        bytes.push(peekViewed(cpu, view, address));
    return bytes;
}

// The BASIC that moves the CRTC's start address halfway through the mode's screen, so that the picture is scrolled and
// the screen memory it shows wraps at &8000 (teletext is a cell per byte and wraps within its 1K).
function scrollLines({mode, size}) {
    const half = mode === 7 ? TeletextCells >> 1 : size / BytesPerCell / 2;
    const defaultStart = mode === 7 ? TeletextStart : (ScreenEnd - size) / BytesPerCell;
    const start = defaultStart + half;
    return [`?&FE00=12:?&FE01=${start >> 8}`, `?&FE00=13:?&FE01=${start & 0xff}`];
}

// The picture a machine shows after `*LOAD SCREEN` from `image` in `mode`, with the cursor off and nothing printed
// over it.
async function loadedScreen(machine, image, mode) {
    const session = await booted(machine);
    const cpu = cpuOf(session);
    cpu.fdc.loadDisc(0, discFor("owletExport.ssd", image));
    await session.type(`MODE ${mode}:VDU23,1,0;0;0;0;:OSCLI"LOAD SCREEN":REPEAT UNTIL FALSE`);
    const {load, screen} = screenFile(image);
    const base = load & 0xffff;
    for (let check = 0; check < MostLoadChecks; ++check) {
        if (bytesIn(MainView, cpu, base, screen.length).every((byte, i) => byte === screen[i]))
            break;
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
    for (const machine of ["B", "Master"]) {
        it(
            `should be the mode's screen memory, loading where the Model ${machine} keeps it, in every mode`,
            async () => {
                const session = await booted(machine);
                const cpu = cpuOf(session);
                const shadowModes = machine === "Master" ? [0, ShadowModeBit] : [0];
                for (const shadow of shadowModes) {
                    for (const {mode, size, base} of Modes) {
                        await session.type(
                            `MODE ${mode + shadow}:PRINT"OWLET":MOVE0,0:DRAW1279,1023`,
                        );
                        await session.runUntilPrompt();
                        const {load, length, screen} = screenFile(discImage([], cpu));
                        const view = shadow ? ShadowView : MainView;
                        expect({mode: mode + shadow, load, length}).toEqual({
                            mode: mode + shadow,
                            load: IoProcessor + base,
                            length: size,
                        });
                        expect(screen).toEqual(bytesIn(view, cpu, base, size));
                    }
                }
            },
            EmulatorTestTimeout,
        );
    }

    const modesOnMachine = {
        B: Modes.map(({mode}) => mode),
        Master: [...Modes.map(({mode}) => mode), ...Modes.map(({mode}) => mode + ShadowModeBit)],
    };
    for (const machine of ["B", "Master"]) {
        for (const mode of modesOnMachine[machine]) {
            for (const scrolled of [false, true]) {
                it(
                    `should show in MODE ${mode} what the ${machine} showed${scrolled ? ", hardware scrolled" : ""}`,
                    async () => {
                        const geometry = Modes[mode % ShadowModeBit];
                        const lines = [
                            `MODE ${mode}`,
                            ...Drawing,
                            ...(scrolled ? scrollLines(geometry) : []),
                        ];
                        const session = await ran(machine, lines);
                        const cpu = cpuOf(session);
                        if (scrolled) {
                            const {base, bytes} = screenDump(cpu);
                            const view = mode >= ShadowModeBit ? ShadowView : MainView;
                            expect(bytes).not.toEqual(bytesIn(view, cpu, base, geometry.size));
                        }
                        const image = discImage([], cpu);
                        const loaded = await loadedScreen(machine, image, mode % ShadowModeBit);
                        expect(loaded.equals(await session.screenshot())).toBe(true);
                    },
                    EmulatorTestTimeout,
                );
            }
        }
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
                    const {base, bytes} = screenDump(cpu);
                    expect(bytes).toEqual(bytesIn(shows, cpu, base, bytes.length));
                    expect(bytes).not.toEqual(bytesIn(hidden, cpu, base, bytes.length));
                },
                EmulatorTestTimeout,
            );
        }
    });
});
