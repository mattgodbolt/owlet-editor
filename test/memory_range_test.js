// @vitest-environment node
import {describe, expect, it} from "vitest";
import {TestMachine} from "jsbeeb/src/test-machine";
import {installBasic} from "jsbeeb/src/basic-loader";
import {AndyView, MainView, ShadowView} from "jsbeeb/src/paging";
import {
    basicNames,
    clipboardText,
    memoryViews,
    peekView,
    ProgramView,
    readRange,
    resolveRange,
    screenIsShadow,
} from "../src/memory-range";
import {evaluate, ExpressionError} from "../src/memory-expression";
import {createTokenisers, tokeniserFor} from "../src/tokeniser";
import {Machines} from "../src/machines";

const RunCycles = 2000000;
const Assembled = [0xa9, 0x0a, 0xa2, 0x0d, 0x60, 0x4f, 0x77, 0x6c, 0x0d];
// Each is worked out by BASIC into R%!(4*i), to be checked against the dialog's working out of the same text; Z%,
// last, is not 0 only if BASIC got through them all.
const Expressions = [
    "P%-D%",
    "P%-1",
    "PAGE+&100",
    "TOP-PAGE",
    "HIMEM",
    "LOMEM",
    "buf",
    "2+3*4",
    "-7 DIV 2",
    "-7 MOD 4",
    "10/4",
    "D%AND&FF00",
    "1 OR 2 AND 3",
    "5 EOR 1",
    "X*2",
    "?D%",
    "D%?1",
    "!&70",
    "D%!1 AND &FFFF",
    "Z%",
];
const Program = [
    "DIM D% 99,R% 255",
    'P%=D%:[OPT 0:LDA #&0A:LDX #&0D:RTS:EQUS "Owl":EQUB 13:]',
    "buf=D%+50:X=2.5:!&70=D%:Z%=42",
    ...Expressions.map((text, i) => `R%!${4 * i}=${text}`),
    "END",
];

/** A machine that has booted and run `lines` as Owlet runs a program. */
async function ran(machine, lines) {
    const testMachine = new TestMachine(machine);
    await testMachine.initialise();
    await testMachine.runFor(Machines[machine].startCycles);
    const tokenisers = await createTokenisers();
    const cpu = testMachine.processor;
    installBasic(tokeniserFor(tokenisers, cpu.model).tokenise(lines.join("\n")), {
        readByte: address => testMachine.readbyte(address),
        writeByte: (address, value) => testMachine.writebyte(address, value),
    });
    await testMachine.type("RUN");
    await testMachine.runFor(RunCycles);
    const peek = address => cpu.peekmemAsLanguage(address);
    return {testMachine, cpu, context: {names: basicNames(peek), peek}};
}

const int32At = (cpu, address) =>
    [0, 1, 2, 3].reduce((value, i) => value | (cpu.peekmemAsLanguage(address + i) << (8 * i)), 0);

describe.each(["B", "Master"])("Memory ranges on the %s", machine => {
    it("works out each expression as BASIC does, from the program's variables", async () => {
        const {cpu, context} = await ran(machine, Program);
        const results = context.names("R%");
        for (const [i, text] of Expressions.entries())
            expect([text, evaluate(text, context)]).toEqual([text, int32At(cpu, results + 4 * i)]);
    });

    it("reads what the program assembled, as `to` an end or as a length, and gives it as text", async () => {
        const {testMachine, cpu, context} = await ran(machine, Program);
        const byEnd = resolveRange({first: "D%", second: "P%-1", byLength: false}, context);
        const byLength = resolveRange({first: "D%", second: "P%-D%", byLength: true}, context);
        expect(byLength).toEqual(byEnd);
        const bytes = [...readRange(cpu, ProgramView, byEnd)];
        expect(bytes).toEqual(Assembled);
        expect(bytes).toEqual(bytes.map((_, i) => testMachine.readbyte(byEnd.start + i)));
        expect(clipboardText(bytes)).toBe("©Ċ¢č`Owlč");
    });

    it("reads up to &FFFF and refuses a range that runs past it or starts outside memory", async () => {
        const {testMachine, cpu, context} = await ran(machine, ["END"]);
        const top = resolveRange({first: "&FFF0", second: "&10", byLength: true}, context);
        expect(top).toEqual({start: 0xfff0, end: 0xffff});
        expect([...readRange(cpu, ProgramView, top)]).toEqual(
            Array.from({length: 16}, (_, i) => testMachine.readbyte(0xfff0 + i)),
        );
        expect(resolveRange({first: "&FFFF", second: "&FFFF", byLength: false}, context)).toEqual({
            start: 0xffff,
            end: 0xffff,
        });
        for (const [first, second, byLength, message] of [
            ["&FFF0", "&11", true, "The range runs past &FFFF, to &10000"],
            ["-1", "1", true, "The start, -&0001, is not an address (&0000 to &FFFF)"],
            ["&10000", "1", true, "The start, &10000, is not an address (&0000 to &FFFF)"],
            ["&2000", "&1FFF", false, "The end, &1FFF, is before the start"],
            ["&2000", "0", true, "The length is 0"],
            ["Q+1", "1", true, "Start: No such variable: Q"],
            ["PAGE", "TOP-", true, "Length: Missing number"],
        ])
            expect(() => resolveRange({first, second, byLength}, context)).toThrow(
                new ExpressionError(message),
            );
    });

    it("offers each sideways bank with something in it, read at &8000 to &BFFF", async () => {
        const {testMachine, cpu} = await ran(machine, ["END"]);
        const sidewaysRam = () => memoryViews(cpu).filter(({label}) => /sideways RAM/.test(label));
        expect(sidewaysRam()).toEqual([]);
        testMachine.loadSidewaysRam(4, Uint8Array.of(1, 2, 3));
        expect(sidewaysRam().map(({label}) => label)).toEqual([
            "Bank 4 (sideways RAM), &8000 to &BFFF",
        ]);
        const views = memoryViews(cpu);
        expect(views[0].view).toBe(ProgramView);
        const title = view =>
            String.fromCharCode(...readRange(cpu, view, {start: 0x8009, end: 0x800d}));
        const basic = views.find(({label}) => / \(BASIC/.test(label));
        expect(title(basic.view)).toBe("BASIC");
        // BASIC is the language, so it is the bank paged in; another bank's ROM is not.
        expect(title(ProgramView)).toBe("BASIC");
        const other = views.find(({view, label}) => /^Bank/.test(label) && view !== basic.view);
        expect(title(other.view)).not.toBe("BASIC");
        // Outside the banks' addresses a bank's view reads as the program does.
        expect(peekView(cpu, other.view, 0x0070)).toBe(cpu.peekmemAsLanguage(0x0070));
        const masterViews = [AndyView, MainView, ShadowView].filter(view =>
            views.some(offered => offered.view === view),
        );
        expect(masterViews).toEqual(machine === "Master" ? [AndyView, MainView, ShadowView] : []);
    });
});

describe("Shadow RAM on the Master", () => {
    // In MODE 135 the screen, at &7C00, is in shadow RAM, and what BASIC writes there goes to main RAM.
    const ShadowProgram = [
        "MODE 135",
        'PRINT "HI";',
        "?&7C00=&11:?&7C01=&22:?&7000=&5A",
        'REPEAT:VDU 30:PRINT "HI";:UNTIL FALSE',
    ];
    const screen = {start: 0x7c00, end: 0x7c01};

    it("reads main RAM as the program does, and the screen from shadow RAM", async () => {
        const {cpu} = await ran("Master", ShadowProgram);
        expect([...readRange(cpu, ProgramView, screen)]).toEqual([0x11, 0x22]);
        expect([...readRange(cpu, MainView, screen)]).toEqual([0x11, 0x22]);
        expect(String.fromCharCode(...readRange(cpu, ShadowView, screen))).toBe("HI");
        expect(screenIsShadow(cpu, screen)).toBe(true);
        expect(screenIsShadow(cpu, {start: 0x8000, end: 0x8001})).toBe(false);
        const bank = memoryViews(cpu).find(({label}) => /^Bank/.test(label)).view;
        expect([...readRange(cpu, bank, screen)]).toEqual([0x11, 0x22]);
    });

    it("reads as the program does even when a frame ends in the OS's VDU driver, which sees shadow RAM", async () => {
        const {testMachine, cpu} = await ran("Master", ShadowProgram);
        // The CPU reads &3000 to &7FFF as the code it last ran sees it, which in the VDU driver is the screen.
        const seesScreen = () => cpu.peekmem(0x7000) !== 0x5a;
        for (let tries = 0; tries < 10000 && !seesScreen(); ++tries) await testMachine.runFor(7);
        expect(seesScreen()).toBe(true);
        expect(peekView(cpu, ProgramView, 0x7000)).toBe(0x5a);
    });

    it("says the screen is not shadow RAM in a mode that is not", async () => {
        const {cpu} = await ran("Master", ["MODE 7", "END"]);
        expect(screenIsShadow(cpu, screen)).toBe(false);
    });
});
