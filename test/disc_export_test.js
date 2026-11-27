// @vitest-environment node
import {existsSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {pathToFileURL} from "node:url";
import {afterAll, describe, expect, it} from "vitest";
import {MachineSession} from "jsbeeb/machine-session";
import {toSsdOrDsd} from "jsbeeb/src/disc";
import {discFor} from "jsbeeb/src/fdc";
import {MainView, peekViewed, ShadowView} from "jsbeeb/src/paging";
import {discImage, screenDump} from "../src/disc-export";
import {blankDisc} from "./blank_disc";

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
const RomBankBytes = 0x4000;

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

// Fitted the way Owlet fits it; the ROM is fetched by the Makefile rather than kept in the repository, so a checkout
// without it tests the other machines.
const GxrRom = "gxr.rom";
const HasGxr = existsSync(new URL(`../node_modules/jsbeeb/public/roms/${GxrRom}`, import.meta.url));

async function booted(machine, extraRoms = [], bankRoms = []) {
    const session = new MachineSession(machine, {extraRoms, bankRoms});
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

// A file in a DFS image, from its catalogue entry: name in sector 0, addresses, length and start in sector 1.
function catalogued(image, wanted) {
    const CatalogueEntry = 8;
    const fileCount = image[0x105] / CatalogueEntry;
    for (let file = 1; file <= fileCount; ++file) {
        const at = file * CatalogueEntry;
        const name = String.fromCharCode(...image.slice(at, at + 7)).trimEnd();
        if (name !== wanted) continue;
        const info = image.slice(0x100 + at, 0x100 + at + CatalogueEntry);
        const extra = info[6];
        const highBits = shift => (extra >> shift) & 3;
        // DFS keeps two bits of each address's top half, both set for &FFFF, the I/O processor.
        const highWord = shift => (highBits(shift) === 3 ? 0xffff : highBits(shift));
        const length = info[4] | (info[5] << 8) | (highBits(4) << 16);
        const start = (info[7] | (highBits(0) << 8)) * 0x100;
        return {
            load: highWord(2) * 0x10000 + (info[0] | (info[1] << 8)),
            exec: highWord(6) * 0x10000 + (info[2] | (info[3] << 8)),
            length,
            data: Array.from(image.slice(start, start + length)),
        };
    }
    throw new Error(`No ${wanted} file in the disc image`);
}

const screenFile = image => {
    const {load, length, data} = catalogued(image, "SCREEN");
    return {load, length, screen: data};
};

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

describe("The exported disc's PROGRAM file", () => {
    // What a real SAVE catalogues on each machine Owlet offers, and the PAGE it saves from.
    const machines = [
        {
            name: "Model B with the GXR",
            machine: "B",
            extraRoms: [GxrRom],
            page: 0x1c00,
            exec: 0x8023,
            skip: !HasGxr,
        },
        {name: "Model B without the GXR", machine: "B", extraRoms: [], page: 0x1900, exec: 0x8023},
        {name: "Master 128", machine: "Master", extraRoms: [], page: 0x0e00, exec: 0x802b},
    ];
    const Hello = 'PRINT "OWLET OK"';
    const BootText = '*BASIC\rCHAIN"PROGRAM"\r';

    // A language ROM that is not BASIC: it reads a line and hands it to the OS as a command, over and over, which is
    // all the `!BOOT` needs of a language (it runs `*` commands from the EXEC file).
    const LanguageRomBank = 8;
    const NotACommand = /Bad command|Not found/;
    const romFolder = mkdtempSync(join(tmpdir(), "owlet-lang-"));
    afterAll(() => rmSync(romFolder, {recursive: true, force: true}));
    const languageRom = () => {
        const rom = new Uint8Array(RomBankBytes);
        rom.set([0x4c, 0x20, 0x80, 0x60, 0xea, 0xea, 0xc2, 0x0e, 0x00], 0);
        rom.set(
            [..."XLANG\0(C)"].map(char => char.charCodeAt(0)),
            9,
        );
        rom.set(
            [
                // Point BRKV at the error printer at &8060
                ...[0xa9, 0x60, 0x8d, 0x02, 0x02, 0xa9, 0x80, 0x8d, 0x03, 0x02],
                // OSWORD 0's parameter block at &80: buffer &0600, 255 long, any character from &20 to &FF
                ...[0xa9, 0x00, 0x85, 0x80, 0xa9, 0x06, 0x85, 0x81, 0xa9, 0xff, 0x85, 0x82],
                ...[0xa9, 0x20, 0x85, 0x83, 0xa9, 0xff, 0x85, 0x84],
                // &803E: read a line (OSWORD 0), try again on Escape, else OSCLI it
                ...[0xa9, 0x00, 0xa2, 0x80, 0xa0, 0x00, 0x20, 0xf1, 0xff, 0xb0, 0xf5],
                ...[0xa2, 0x00, 0xa0, 0x06, 0x20, 0xf7, 0xff, 0x4c, 0x3e, 0x80],
            ],
            0x20,
        );
        rom.set(
            [
                // &8060: an error's message is at (&FD)+1: print it and go back to reading lines
                ...[
                    0xa2, 0xff, 0x9a, 0x58, 0xa0, 0x01, 0xb1, 0xfd, 0xf0, 0x06, 0x20, 0xee, 0xff,
                    0xc8, 0xd0, 0xf6,
                ],
                ...[0x20, 0xe7, 0xff, 0x4c, 0x3e, 0x80],
            ],
            0x60,
        );
        const path = join(romFolder, "xlang.rom");
        writeFileSync(path, rom);
        return pathToFileURL(path).href;
    };

    // A real SAVE of Hello on a blank disc: the catalogue entry it makes, and the PAGE it was made at.
    async function realSave({machine, extraRoms}) {
        const session = await booted(machine, extraRoms);
        const cpu = cpuOf(session);
        const disc = discFor("real.ssd", blankDisc());
        cpu.fdc.loadDisc(0, disc);
        await session.loadBasic(`10 ${Hello}`);
        await session.type('SAVE "PROGRAM"');
        await session.runUntilPrompt();
        return {session, entry: catalogued(toSsdOrDsd(disc, {force: true}), "PROGRAM")};
    }

    for (const {name, machine, extraRoms, page, exec, skip} of machines) {
        it.skipIf(skip)(
            `should be catalogued as a real SAVE on the ${name} does, and run when booted`,
            async () => {
                const {session, entry: real} = await realSave({machine, extraRoms});
                expect(real).toMatchObject({load: IoProcessor + page, exec: IoProcessor + exec});

                const image = discImage(real.data, cpuOf(session));
                expect(catalogued(image, "PROGRAM")).toEqual(real);
                const boot = catalogued(image, "!BOOT");
                expect(boot).toMatchObject({load: 0x1900, exec: 0x1900, length: BootText.length});
                expect(boot.data).toEqual([...BootText].map(char => char.charCodeAt(0)));

                const fresh = await booted(machine, extraRoms);
                cpuOf(fresh).fdc.loadDisc(0, discFor("owletExport.ssd", image));
                await fresh.autoboot();
                const {screenText} = await fresh.runUntilPrompt();
                expect(screenText).toContain("OWLET OK");
                await fresh.type("*INFO PROGRAM");
                const hex = address => address.toString(16).toUpperCase().slice(-6);
                expect((await fresh.runUntilPrompt()).screenText).toMatch(
                    new RegExp(
                        `PROGRAM\\s+${hex(IoProcessor + page)}\\s+${hex(IoProcessor + exec)}`,
                    ),
                );
            },
            EmulatorTestTimeout,
        );

        it.skipIf(skip)(
            `should run from !BOOT on the ${name} when BASIC is not the current language`,
            async () => {
                const {session, entry: real} = await realSave({machine, extraRoms});
                const image = discImage(real.data, cpuOf(session));

                const fresh = await booted(machine, extraRoms, [
                    {bank: LanguageRomBank, rom: languageRom()},
                ]);
                cpuOf(fresh).fdc.loadDisc(0, discFor("owletExport.ssd", image));
                await fresh.type(`*FX142,${LanguageRomBank}`);
                await fresh.runUntilPrompt();
                // Not BASIC: its commands are not OS commands
                await fresh.type("PRINT 1");
                expect((await fresh.runUntilPrompt()).screenText).toMatch(NotACommand);

                await fresh.type("*EXEC !BOOT");
                const {screenText} = await fresh.runUntilPrompt();
                expect(screenText).toContain("OWLET OK");
                expect(screenText).not.toMatch(NotACommand);
                // Now in BASIC
                await fresh.type("PRINT 1+1");
                expect((await fresh.runUntilPrompt()).screenText).toMatch(/\b2\b/);
            },
            EmulatorTestTimeout,
        );
    }
});
