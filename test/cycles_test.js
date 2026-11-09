import {describe, expect, it} from "vitest";
import {ClocksPerSecond, setTotalCycles, totalCycles} from "../src/cycles";

const fakeCpu = () => ({cycleSeconds: 0, currentCycles: 0, targetCycles: 0});

describe("Cycle counts", () => {
    it.each([
        ["zero", 0],
        ["under a second", 725001],
        ["exactly a second", ClocksPerSecond],
        ["an odd count", ClocksPerSecond * 7 + 3],
        ["three hours, which overflows 32 bits", ClocksPerSecond * 60 * 60 * 3],
        ["three hours and an odd cycle", ClocksPerSecond * 60 * 60 * 3 + 1],
    ])("should round-trip %s", (_name, cycles) => {
        const cpu = fakeCpu();
        setTotalCycles(cpu, cycles);
        expect(totalCycles(cpu)).toBe(cycles);
        expect(cpu.currentCycles).toBeLessThan(ClocksPerSecond);
        expect(cpu.currentCycles).toBe(cpu.targetCycles);
        // The bottom bit encodes the bus cycle's parity, so it must survive the split.
        expect(cpu.currentCycles % 2).toBe(cycles % 2);
    });
});
