import {afterEach, describe, expect, it} from "vitest";
import {tokeniseBasicII, tokeniserFor} from "../src/tokeniser";
import {isBasicIV, setBasicIV} from "../src/parser/dialect";
import {RomTokens} from "./rom-tables";

const hex = text => [...text].map(c => c.charCodeAt(0).toString(16).padStart(2, "0")).join(" ");
// The bytes of a one-line program after its header (CR, line number, length) and before its end (CR, &FF).
const lineBytes = program => hex(program).split(" ").slice(4, -2).join(" ");

describe("Tokeniser", () => {
    afterEach(() => setBasicIV(false));

    it("should choose the tokeniser of the machine's BASIC", () => {
        const tokenisers = {master: {name: "BASIC IV"}, b: {name: "BASIC II"}};
        expect(tokeniserFor(tokenisers, {isMaster: false})).toBe(tokenisers.b);
        expect(tokeniserFor(tokenisers, {isMaster: true})).toBe(tokenisers.master);
    });

    it.each([false, true])(
        "should tokenise each line as BASIC II does when the highlighter uses BASIC IV: %s",
        basicIV => {
            setBasicIV(basicIV);
            const wrong = RomTokens.filter(([text]) => !/^\d/.test(text))
                .map(([text, recorded]) => ({
                    text,
                    recorded,
                    ours: lineBytes(tokeniseBasicII(text)),
                }))
                .filter(({recorded, ours}) => ours !== recorded);
            expect(wrong).toEqual([]);
        },
    );

    it.each([
        ["COLOR 1", "43 4f 4c 4f 52 20 31"],
        ["ED.", "45 44 2e"],
        ["EDIT", "45 44 49 54"],
        ["COLOUR 1", "fb 20 31"],
    ])("should not read %s as a Master's keyword", (text, bytes) => {
        expect(lineBytes(tokeniseBasicII(text))).toBe(bytes);
    });

    it("should follow the Model B's BASIC whatever the editor is set to, and leave the setting alone", () => {
        setBasicIV(true);
        expect(lineBytes(tokeniseBasicII("COLOR 1"))).toBe("43 4f 4c 4f 52 20 31");
        expect(isBasicIV()).toBe(true);
    });

    it("should lay a program out as BASIC stores it", () => {
        expect(hex(tokeniseBasicII("10 REM a\n\n300 END"))).toBe(
            "0d 00 0a 08 20 f4 20 61 0d 01 2c 06 20 e0 0d ff",
        );
        expect(() => tokeniseBasicII(`10 REM ${"x".repeat(300)}`)).toThrow(/> 251/);
    });
});
