import {describe, expect, it} from "vitest";
import {setTotalCycles, totalCycles} from "../src/cycles";

const fakeCpu = cyclesPerSecond => ({
    model: {cyclesPerSecond},
    cycleSeconds: 0,
    currentCycles: 0,
    targetCycles: 0,
});

describe("Cycle counts", () => {
    // Whatever speed the machine runs at, the count splits into whole seconds and a remainder.
    describe.each([2000000, 1000000])("at %i cycles a second", cyclesPerSecond => {
        it.each([
            ["zero", 0],
            ["under a second", 725001],
            ["exactly a second", cyclesPerSecond],
            ["an odd count", cyclesPerSecond * 7 + 3],
            ["three hours, which overflows 32 bits", cyclesPerSecond * 60 * 60 * 3],
            ["three hours and an odd cycle", cyclesPerSecond * 60 * 60 * 3 + 1],
        ])("should round-trip %s", (_name, cycles) => {
            const cpu = fakeCpu(cyclesPerSecond);
            setTotalCycles(cpu, cycles);
            expect(totalCycles(cpu)).toBe(cycles);
            expect(cpu.currentCycles).toBeLessThan(cyclesPerSecond);
            expect(cpu.currentCycles).toBe(cpu.targetCycles);
            // The bottom bit encodes the bus cycle's parity, so it must survive the split.
            expect(cpu.currentCycles % 2).toBe(cycles % 2);
        });
    });
});
