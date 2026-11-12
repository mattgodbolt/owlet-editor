import {describe, expect, it} from "vitest";
import {
    AsciiChars,
    PlotColumns,
    PlotExtendedGroups,
    PlotGroups,
    TeletextCodes,
    VduCodes,
} from "../src/vdu-data";
import {
    charInsertText,
    createVduReference,
    insertAtCursor,
    plotInsertText,
    vduInsertText,
} from "../src/vdu-reference";

describe("VDU data", () => {
    it("has every control code once, plus delete", () => {
        expect(VduCodes.map(c => c.code)).toEqual([...Array(32).keys(), 127]);
    });

    it.each([
        [1, 1],
        [17, 1],
        [18, 2],
        [19, 5],
        [22, 1],
        [23, 9],
        [24, 8],
        [25, 5],
        [28, 4],
        [29, 4],
        [31, 2],
        [12, 0],
        [127, 0],
    ])("VDU %i takes %i parameter bytes", (code, params) => {
        expect(VduCodes.find(c => c.code === code).params).toBe(params);
    });

    it("describes the arguments of every code that takes any", () => {
        for (const c of VduCodes) expect(Boolean(c.args), `VDU ${c.code}`).toBe(c.params > 0);
    });

    it("covers printable ASCII with the BBC pound sign at 96", () => {
        expect(AsciiChars).toHaveLength(95);
        expect(AsciiChars[0]).toEqual({code: 32, char: " "});
        expect(AsciiChars.find(c => c.code === 65).char).toBe("A");
        expect(AsciiChars.find(c => c.code === 96).char).toBe("£");
        expect(AsciiChars.at(-1).code).toBe(126);
    });

    it("keeps teletext codes in 129-159", () => {
        expect(TeletextCodes.every(c => c.code >= 129 && c.code <= 159)).toBe(true);
        expect(TeletextCodes.find(c => c.code === 141).name).toBe("Double height");
    });
});

describe("PLOT data", () => {
    it("has 8 columns by 16 groups covering 0-127, then the extended groups from 128", () => {
        expect(PlotColumns.map(c => c.offset)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
        expect(PlotGroups.map(g => g.base)).toEqual([...Array(16).keys()].map(i => i * 8));
        expect(PlotExtendedGroups[0].base).toBe(128);
        expect(PlotExtendedGroups.every(g => g.base % 8 === 0)).toBe(true);
    });

    it.each([
        [4, "Solid line, both ends included", "Move absolute"],
        [5, "Solid line, both ends included", "Draw absolute, foreground"],
        [69, "Plot a point", "Draw absolute, foreground"],
        [85, "Fill triangle", "Draw absolute, foreground"],
        [101, "Fill rectangle", "Draw absolute, foreground"],
        [117, "Fill parallelogram", "Draw absolute, foreground"],
    ])("PLOT %i is %s, %s", (k, groupName, columnName) => {
        const group = PlotGroups.findLast(g => g.base <= k);
        expect(group.name).toBe(groupName);
        expect(PlotColumns[k - group.base].name).toBe(columnName);
    });
});

describe("inserted text", () => {
    it.each([
        [{code: 31, params: 2}, "VDU 31,"],
        [{code: 12, params: 0}, "VDU 12"],
        [{code: 23, params: 9}, "VDU 23,"],
    ])("VDU entry %j inserts %s", (entry, text) => {
        expect(vduInsertText(entry)).toBe(text);
    });

    it("inserts CHR$ for characters and PLOT with a comma", () => {
        expect(charInsertText({code: 65})).toBe("CHR$(65)");
        expect(plotInsertText(85)).toBe("PLOT 85,");
    });
});

describe("the panel", () => {
    function setup() {
        const container = document.createElement("div");
        const inserted = [];
        createVduReference(container, text => inserted.push(text));
        const search = text => {
            const input = container.querySelector(".vdu-search");
            input.value = text;
            input.dispatchEvent(new Event("input"));
        };
        const entries = () =>
            [...container.querySelectorAll("[data-insert]")].map(b => b.dataset.insert);
        return {container, inserted, search, entries};
    }

    it("lists the VDU codes first and inserts what is clicked", () => {
        const {container, inserted, entries} = setup();
        expect(entries()).toHaveLength(VduCodes.length);
        container.querySelector('[data-insert="VDU 31,"]').click();
        expect(inserted).toEqual(["VDU 31,"]);
    });

    it("shows all 128 basic PLOT codes plus the extended ones on the PLOT tab", () => {
        const {container, entries} = setup();
        container.querySelector('[data-tab="plot"]').click();
        expect(entries()).toHaveLength((PlotGroups.length + PlotExtendedGroups.length) * 8);
    });

    it("searches every table at once", () => {
        const {search, entries} = setup();
        search("85");
        expect(entries()).toEqual(expect.arrayContaining(["CHR$(85)", "PLOT 85,"]));
        search("triangle");
        expect(entries()).toHaveLength(8);
        search("zzz");
        expect(entries()).toEqual([]);
    });
});

describe("insertAtCursor", () => {
    it("replaces the selections, leaves the caret after the text, and refocuses the editor", () => {
        const calls = [];
        const selection = {startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1};
        const editor = {
            getSelections: () => [selection],
            pushUndoStop: () => calls.push("undo-stop"),
            executeEdits: (source, edits) => calls.push(["edit", source, edits]),
            focus: () => calls.push("focus"),
        };
        insertAtCursor(editor, "VDU 17,");
        expect(calls).toEqual([
            "undo-stop",
            [
                "edit",
                "vdu-reference",
                [{range: selection, text: "VDU 17,", forceMoveMarkers: true}],
            ],
            "undo-stop",
            "focus",
        ]);
    });
});
