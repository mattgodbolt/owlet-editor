import {describe, expect, it} from "vitest";
import {machineOf, withMachine} from "../src/machines";

describe("Machine in a state", () => {
    it.each([
        [{v: 1, program: "P."}, "B"],
        [{v: 3, toot: "P."}, "B"],
        [{v: 1, program: "P.", model: "Master"}, "Master"],
        [{v: 1, program: "P.", model: "B"}, "B"],
        [{v: 1, program: "P.", model: "Atom"}, "B"],
        [{v: 1, program: "P.", model: "toString"}, "B"],
        [null, "B"],
    ])("of %j is %s", (state, machine) => {
        expect(machineOf(state)).toBe(machine);
    });
    it("is left out for a Model B, so its links are what they always were", () => {
        expect(withMachine({v: 1, program: "P."}, "B")).toEqual({v: 1, program: "P."});
    });
    it("is kept for a Master", () => {
        const state = withMachine({v: 1, program: "P."}, "Master");
        expect(state).toEqual({v: 1, program: "P.", model: "Master"});
        expect(machineOf(JSON.parse(JSON.stringify(state)))).toBe("Master");
    });
});
