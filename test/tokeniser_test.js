import {afterEach, describe, expect, it} from "vitest";
import {tokeniseBasicII, tokeniserFor} from "../src/tokeniser";
import {BasicIIDialect, isBasicIV, ModelBDialect, setBasicIV} from "../src/parser/dialect";
import {romBytes} from "../src/parser/lexer";
import {tokenise} from "../src/parser/recogniser";
import {LenientThanRom, RomTokens} from "./rom-tables";

const hex = text => [...text].map(c => c.charCodeAt(0).toString(16).padStart(2, "0")).join(" ");
// The bytes of a one-line program after its header (CR, line number, length) and before its end (CR, &FF).
const lineBytes = program => hex(program).split(" ").slice(4, -2).join(" ");
const bytesOf = (text, dialect) => hex(String.fromCharCode(...romBytes(tokenise(text, dialect))));

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
            expect(wrong.map(({text}) => text)).toEqual(
                RomTokens.map(([text]) => text).filter(text => LenientThanRom.includes(text)),
            );
        },
    );

    it("should give BASIC II's own bytes for every recorded row, as the ROM does", () => {
        const wrong = RomTokens.filter(([text]) => !/^\d/.test(text))
            .map(([text, recorded]) => ({text, recorded, ours: bytesOf(text, BasicIIDialect)}))
            .filter(({recorded, ours}) => ours !== recorded);
        expect(wrong).toEqual([]);
    });

    it.each([
        ["ED.", "45 44 2e"],
        ["EDIT", "45 44 49 54"],
        ["COLOUR 1", "fb 20 31"],
    ])("should not read %s as a Master's keyword", (text, bytes) => {
        expect(lineBytes(tokeniseBasicII(text))).toBe(bytes);
    });

    it("should follow the Model B's BASIC whatever the editor is set to, and leave the setting alone", () => {
        setBasicIV(true);
        expect(lineBytes(tokeniseBasicII("COLOR 1"))).toBe("fb 20 31");
        expect(lineBytes(tokeniseBasicII("COLORS=7"))).toBe("43 4f 4c 4f 52 53 3d 37");
        expect(isBasicIV()).toBe(true);
    });

    it("should lay a program out as BASIC stores it", () => {
        expect(hex(tokeniseBasicII("10 REM a\n\n300 END"))).toBe(
            "0d 00 0a 08 20 f4 20 61 0d 01 2c 06 20 e0 0d ff",
        );
        expect(() => tokeniseBasicII(`10 REM ${"x".repeat(300)}`)).toThrow(/> 251/);
    });
});

// COLOR, the US spelling of COLOUR, is read as it on the Model B where it starts a statement, is followed by an expression
// and then the end of the statement, and could not be a variable; BASIC II's ROM says Mistake to it (README).
describe("COLOR on a Model B", () => {
    // The text, and the text as if the COLOR that is COLOUR were written so.
    it.each([
        ["COLOR 7", "COLOUR 7"],
        ["COLOR7", "COLOUR7"],
        ["COLOR X", "COLOUR X"],
        ["COLOR7.5", "COLOUR7.5"],
        ["COLOR(1)", "COLOUR(1)"],
        ["COLOR?1", "COLOUR?1"],
        ["COLOR 7:COLOR 1", "COLOUR 7:COLOUR 1"],
        ["IFC%COLORC%ELSECOLORD%:NEXT", "IFC%COLOURC%ELSECOLOURD%:NEXT"],
        ["X=1:REP.COLORX:P.;X:X=X+1:U.X>7", "X=1:REP.COLOURX:P.;X:X=X+1:U.X>7"],
        ["ONERRORCOLOR7:GOTO1000", "ONERRORCOLOUR7:GOTO1000"],
        ["LETCOLOR=3:COLORCOLOR", "LETCOLOR=3:COLOURCOLOR"],
        ["IFX THEN COLOR 1 ELSE COLOR 2", "IFX THEN COLOUR 1 ELSE COLOUR 2"],
        ["  COLOR 7", "  COLOUR 7"],
    ])("should tokenise %s as %s", (text, written) => {
        expect(bytesOf(text, ModelBDialect)).toBe(bytesOf(written, BasicIIDialect));
    });

    // The text is what BASIC II's ROM makes of it, the characters as they are.
    it.each([
        "COLORS=7",
        "LETCOLOR=3",
        "COLOR=7",
        "COLOR(1)=7",
        "COLOR?1=7",
        "COLOR",
        "COLOR 1,2",
        "COLOR 1 2",
        "COLOR 7=",
        "PRINT COLOR",
        "X=COLOR",
        "X=1:Y=COLOR 1",
        "color 7",
        "GCOLOR 1",
        "EDITED=FALSE",
        "REM COLOR 7",
        'PRINT "COLOR 7"',
        "DATA COLOR 7",
        "*COLOR 7",
        "[OPT0:\\ COLOR 7",
        'X$="COLOR":COLORS=1',
    ])("should leave %s as the ROM tokenises it", text => {
        expect(bytesOf(text, ModelBDialect)).toBe(bytesOf(text, BasicIIDialect));
    });

    it("should run the same decision as the highlighter on a program, line by line", () => {
        const program = '10 COLOR 1\n20 COLORS=7\n30 PRINT "OK"';
        expect(hex(tokeniseBasicII(program))).toBe(
            hex(tokeniseBasicII('10 COLOUR 1\n20 COLORS=7\n30 PRINT "OK"')),
        );
    });
});
