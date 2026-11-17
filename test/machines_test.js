import {describe, expect, it} from "vitest";
import {
    Choices,
    NoGxr,
    choiceFor,
    choiceNamed,
    choiceOf,
    labelOf,
    machineOf,
    modelQuery,
    withMachine,
} from "../src/machines";

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

describe("Model in an export link", () => {
    it.each([
        ["B", ""],
        ["Master", "&model=Master"],
    ])("for %s is %j", (machine, query) => {
        expect(modelQuery(machine)).toBe(query);
    });
});

describe("Menu choice", () => {
    it.each([
        [{v: 1, program: "P."}, "B"],
        [{v: 1, program: "P.", model: "B"}, "B"],
        [{v: 1, program: "P.", gxr: true}, "B"],
        [{v: 1, program: "P.", gxr: "no"}, "B"],
        [{v: 1, program: "P.", model: "Master"}, "Master"],
        [{v: 1, program: "P.", model: "Master", gxr: false}, "Master"],
        [{v: 1, program: "P.", gxr: false}, NoGxr],
        [{v: 1, program: "P.", model: "B", gxr: false}, NoGxr],
        [{v: 1, program: "P.", model: "Atom", gxr: false}, NoGxr],
        [null, "B"],
    ])("of %j is %s", (state, choice) => {
        expect(choiceOf(state)).toBe(choice);
    });
    it.each([
        ["B", "B"],
        ["Master", "Master"],
        [NoGxr, NoGxr],
        [null, "B"],
        ["Atom", "B"],
        ["toString", "B"],
    ])("saved as %j is %s, so what an older version saved is what it was", (saved, choice) => {
        expect(choiceNamed(saved)).toBe(choice);
    });
    it.each([
        ["B", {v: 1, program: "P."}],
        ["Master", {v: 1, program: "P.", model: "Master"}],
        [NoGxr, {v: 1, program: "P.", gxr: false}],
    ])("%s as a state is %j, which is the choice again", (choice, state) => {
        expect(withMachine({v: 1, program: "P."}, choice)).toEqual(state);
        expect(choiceOf(JSON.parse(JSON.stringify(state)))).toBe(choice);
    });
    it("is a machine and whether it has the GXR, which choiceFor puts back together", () => {
        for (const [choice, {machine, gxr}] of Object.entries(Choices)) {
            expect(machineOf({model: machine})).toBe(machine);
            expect(choiceFor(machine, gxr)).toBe(choice);
        }
        expect(Object.keys(Choices)).toEqual(["B", NoGxr, "Master"]);
        expect(Object.keys(Choices).map(labelOf)).toEqual([
            "Model B",
            "Model B (no GXR)",
            "Master 128",
        ]);
    });
    it("leaves the export query to the machine, which the GXR is not a model name for", () => {
        expect(modelQuery(Choices[NoGxr].machine)).toBe("");
    });
});
