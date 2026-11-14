import {describe, expect, it} from "vitest";
import {
    AsciiChars,
    PlotColumns,
    PlotExtendedGroups,
    PlotGroups,
    TeletextCodes,
    VduCodes,
    decodePlot,
    hex,
} from "../src/vdu-data";
import {createVduReference, describePlot, parseNumber} from "../src/vdu-reference";

// The bytes a syntax sends after the code: a name followed by ; is two bytes, any other item one.
const bytesIn = syntax =>
    (syntax.replace(/^VDU \d+,?/, "").match(/[^,;]+;?/g) ?? []).reduce(
        (total, item) => total + (item.endsWith(";") ? 2 : 1),
        0,
    );

describe("VDU data", () => {
    it("has every control code once, plus delete", () => {
        expect(VduCodes.map(c => c.code)).toEqual([...Array(32).keys(), 127]);
    });

    it("has a syntax whose code and byte count agree with the entry", () => {
        for (const c of VduCodes) {
            expect(c.syntax, `VDU ${c.code}`).toMatch(new RegExp(`^VDU ${c.code}(,|$)`));
            expect(bytesIn(c.syntax), c.syntax).toBe(c.params);
        }
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

    it.each([
        [22, "VDU 22,mode", "VDU 22,7"],
        [31, "VDU 31,x,y", "VDU 31,10,5"],
        [25, "VDU 25,k,x;y;", "VDU 25,4,640;512;"],
    ])("VDU %i is written %s, for example %s", (code, syntax, example) => {
        const entry = VduCodes.find(c => c.code === code);
        expect(entry.syntax).toBe(syntax);
        expect(entry.example[0]).toBe(example);
    });

    it("gives every example the same code as its syntax and the right byte count", () => {
        for (const c of VduCodes.filter(c => c.example)) {
            const [example] = c.example;
            expect(example, c.syntax).toMatch(new RegExp(`^VDU ${c.code},`));
            expect(bytesIn(example), example).toBe(c.params);
        }
    });

    it("covers printable ASCII with the BBC pound sign at 96, and writes hex the BBC way", () => {
        expect(AsciiChars).toHaveLength(95);
        expect(AsciiChars[0]).toEqual({code: 32, char: " "});
        expect(AsciiChars.find(c => c.code === 65).char).toBe("A");
        expect(AsciiChars.find(c => c.code === 96).char).toBe("£");
        expect(AsciiChars.at(-1).code).toBe(126);
        expect([hex(65), hex(10), hex(159)]).toEqual(["&41", "&0A", "&9F"]);
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
        [4, "PLOT 4 = Solid line, both ends included, absolute, move (nothing is drawn)"],
        [5, "PLOT 5 = Solid line, both ends included, absolute, foreground colour"],
        [69, "PLOT 69 = Plot a point, absolute, foreground colour"],
        [85, "PLOT 85 = Fill triangle, absolute, foreground colour"],
        [101, "PLOT 101 = Fill rectangle, absolute, foreground colour"],
        [117, "PLOT 117 = Fill parallelogram, absolute, foreground colour"],
        [81, "PLOT 81 = Fill triangle, relative, foreground colour"],
        [150, "PLOT 150 = Circle outline (GXR / Master; the columns are not labelled here)"],
    ])("decodes PLOT %i", (k, text) => {
        expect(describePlot(k)).toBe(text);
    });

    it("decodes nothing beyond the known groups", () => {
        expect(decodePlot(255)).toBeNull();
        expect(decodePlot(150).column).toBeNull();
    });
});

describe("number searches", () => {
    it.each([
        ["65", 65],
        ["&41", 65],
        ["&4a", 74],
        [" 7 ", 7],
        ["triangle", null],
        ["&", null],
    ])("reads %j as %j", (query, expected) => {
        expect(parseNumber(query)).toBe(expected);
    });
});

describe("the panel", () => {
    function setup() {
        const container = document.createElement("div");
        createVduReference(container);
        const search = text => {
            const input = container.querySelector(".vdu-search");
            input.value = text;
            input.dispatchEvent(new Event("input"));
        };
        const text = () => container.querySelector(".vdu-body").textContent;
        const count = selector => container.querySelectorAll(selector).length;
        return {container, search, text, count};
    }

    it("lists the VDU codes first, with syntax and examples", () => {
        const {text, count} = setup();
        expect(count(".vdu-row")).toBe(VduCodes.length);
        expect(text()).toContain("VDU 31,x,y");
        expect(text()).toContain("e.g. VDU 31,10,5 is PRINT TAB(10,5);");
    });

    it("shows all the PLOT codes on the PLOT tab", () => {
        const {container, count} = setup();
        container.querySelector('[data-tab="plot"]').click();
        expect(count(".plot-cell")).toBe((PlotGroups.length + PlotExtendedGroups.length) * 8);
        expect(count(".plot-decode")).toBe(0);
    });

    it("decodes a number typed in the search and highlights it in the grid", () => {
        const {container, search, text} = setup();
        search("85");
        expect(container.querySelector(".plot-decode").textContent).toBe(
            "PLOT 85 = Fill triangle, absolute, foreground colour",
        );
        expect(container.querySelector(".plot-cell.match").textContent).toBe("85");
        expect(text()).toContain("Use it as PLOT 85,x,y");
    });

    it("shows ASCII and MODE 7 codes in decimal and hex, found by number, hex or character", () => {
        const {container, search, text, count} = setup();
        container.querySelector('[data-tab="ascii"]').click();
        expect(count(".vdu-row")).toBe(AsciiChars.length);
        search("&41");
        expect(text()).toContain("65&41");
        expect(text()).toContain("CHR$(65)");
        search("a");
        expect([...container.querySelectorAll(".vdu-char")].map(e => e.textContent)).toEqual([
            "A",
            "a",
        ]);
        search("&8D");
        expect(text()).toContain("Double height");
        expect(text()).toContain("CHR$(141)");
    });

    it("searches every table at once by name", () => {
        const {search, count} = setup();
        search("triangle");
        expect(count(".plot-group")).toBe(1);
        search("zzz");
        expect(count(".vdu-row")).toBe(0);
        expect(count(".plot-group")).toBe(0);
    });

    it("finds PLOT groups by column text, but only for the groups whose columns are known", () => {
        const {container, search} = setup();
        search("absolute inverse");
        const cells = [...container.querySelectorAll(".plot-cell")].map(e => e.textContent);
        expect(cells).toContain("6");
        expect(cells).not.toContain("134");
    });
});
