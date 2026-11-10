import {describe, expect, it} from "vitest";
import {chipBindings, restoreChipBindings} from "../src/chip-bindings";

describe("Chip bindings", () => {
    it("should give the chip back to the scheduler and tasks it was taken from", () => {
        const chip = {
            scheduler: {name: "old"},
            lastRunEpoch: 7,
            activeTask: {id: 1},
            progressTask: {id: 2},
            other: "kept",
        };
        const original = {...chip};

        const bindings = chipBindings(chip);
        Object.assign(chip, {
            scheduler: {name: "new"},
            lastRunEpoch: 0,
            activeTask: {id: 3},
            progressTask: {id: 4},
        });
        restoreChipBindings(chip, bindings);

        expect(chip).toEqual(original);
        expect(chip.scheduler).toBe(original.scheduler);
        expect(chip.activeTask).toBe(original.activeTask);
        expect(chip.progressTask).toBe(original.progressTask);
    });

    it("should leave the chip's other state alone", () => {
        const chip = {
            scheduler: {},
            lastRunEpoch: 0,
            activeTask: null,
            progressTask: null,
            registers: [1, 2],
        };
        const bindings = chipBindings(chip);
        chip.registers = [9, 9];
        restoreChipBindings(chip, bindings);
        expect(chip.registers).toEqual([9, 9]);
    });
});
