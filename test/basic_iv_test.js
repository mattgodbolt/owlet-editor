import {registerBbcBasicLanguage, useBasicIV} from "../src/bbcbasic";
import {afterEach, describe, expect, it} from "vitest";
import {editor} from "monaco-editor/esm/vs/editor/editor.api";

const isInvalid = text =>
    editor.tokenize(text, "BBCBASIC")[0].some(t => t.type.startsWith("invalid"));

// Each was run on both ROMs in jsbeeb (tools/rom-oracle, --master for BASIC IV). These are syntax errors on BASIC II
// that BASIC IV runs.
const BasicIVOnly = [
    "EXT#X=0",
    "EXT #X=EXT#X",
    "IF 1 THEN EXT#0=0",
    "\xa2#0=0",
    "COLOR.",
    "COLOR 1:COLOR.",
    "VDU 23,255,255|",
    "V.7 |:PRINT",
    "VD.7|7|",
    "VDU 7;7|X",
    "\xef7|",
];
// Syntax errors on both.
const NeitherBasic = [
    "EXT X=0",
    "EXT=0",
    "EX.#0=0",
    'ERROR 3,"x"',
    "VDU|",
    "VDU |",
    "VDU 7,|",
    "VDU 7; |",
    "VDU 7||",
    "VDU 7|,7",
    "VDU 7|;",
    "PRINT 7|",
    "X=7|",
];
// Fine on both.
const BothBasics = ["EXTX=0", "PRINT EXT#0", "COLOUR.", "COLO.1"];

describe("BASIC IV highlighting", () => {
    registerBbcBasicLanguage();
    afterEach(() => useBasicIV(false));

    it.each(BasicIVOnly)("accepts %j only on the Master", text => {
        expect(isInvalid(text)).toBe(true);
        useBasicIV(true);
        expect(isInvalid(text)).toBe(false);
    });
    it.each(NeitherBasic)("flags %j on both", text => {
        expect(isInvalid(text)).toBe(true);
        useBasicIV(true);
        expect(isInvalid(text)).toBe(true);
    });
    it.each(BothBasics)("accepts %j on both", text => {
        expect(isInvalid(text)).toBe(false);
        useBasicIV(true);
        expect(isInvalid(text)).toBe(false);
    });
    it("reads COLOR as the keyword on the Master", () => {
        useBasicIV(true);
        expect(editor.tokenize("COLOR 1", "BBCBASIC")[0][0].type).toBe("keyword.BBCBASIC");
    });
});
