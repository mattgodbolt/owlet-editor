import {afterEach, beforeEach, describe, expect, it} from "vitest";
import assert from "assert";
import {editor} from "monaco-editor/esm/vs/editor/editor.api";
import {getSyntaxMarkers, getWarnings, registerBbcBasicLanguage, useBasicIV} from "../src/bbcbasic";
import {completionContext} from "../src/completions";
import {setBasicIV} from "../src/parser/dialect";
import {programProblems} from "../src/parser/highlight";
import {lexLine, romBytes} from "../src/parser/lexer";
import {masterVerdicts, verdicts, wrongMessages, wrongRows} from "./rom-tables";
import MasterTokens from "./rom-tokens-master.json";
import MasterVerdicts from "./rom-verdicts-master.json";

const hex = bytes => bytes.map(b => b.toString(16).padStart(2, "0")).join(" ");
// Whether the recogniser says BASIC stops at the line, or would if the line ended there.
const stops = text => programProblems(text).some(problem => !problem.stricter);

// Lines BASIC IV runs that are marked on purpose (see the README): what follows a complete instruction is ignored.
const StricterThanRom = [
    "[OPT0:ADC (&70)+1:]",
    "[OPT0:AND (&70)+1:]",
    "[OPT0:CMP (&70)+1:]",
    "[OPT0:EOR (&70)+1:]",
    "[OPT0:LDA (&70)+1:]",
    "[OPT0:ORA (&70)+1:]",
    "[OPT0:SBC (&70)+1:]",
    "[OPT0:STA (&70)+1:]",
    "[OPT0:JMP (&70)+1:]",
    "[OPT0:LDA (&70),Ya:]",
    "[OPT0:LDA (&70),y,x:]",
    "[OPT0:INC A,X:]",
    "[OPT0:ST: &70:]",
    "[OPT0:ST:ply:]",
    "[OPT0:STAH.,X:]",
    ...["CPX", "CPY", "TRB", "TSB"].flatMap(m =>
        ["&70,X", "&70,x", "&1234,Y", "&1234,y", "(&70),Y", "(&70),y"].map(
            o => `[OPT0:${m} ${o}:]`,
        ),
    ),
    "[OPT0:TSB &70,Y:]",
];
// Lines BASIC IV rejects that the recogniser does not mark: false-valids are measured, not gated (see the README).
const KnownGaps = ["EDIT=1"];

// What BASIC II rejects and BASIC IV runs, each a row of both recorded tables.
const OnlyOnBasicIV = [
    "VDU 23,255,255|",
    "V.7|",
    "VDU 7|8",
    "VDU 7,8|",
    "VDU 7|:PRINT",
    "VDU 7|X",
    "VDU 7 |",
    "VDU 1 2|",
    "VDU 1|2|3|",
    "EXT#X=1",
    "EXT #X=1",
    "IF 1 THEN EXT#0=0",
    "COLOR 1",
    "COLOR1",
    "COLOR.",
    "COLOR 1:COLOR.",
    "ON 1 PROCp",
    "ON X PROCp,PROCq",
    "ON 1 PROCp ELSE PRINT",
    "ON 1 PROCp,",
    'TIME$="a"',
    'TIME$ ="a"',
    "X$=TIME$",
    'X$=TIME$+"a"',
    "PRINT TIME$",
    "PRINT TIME$;TIME$",
    "PRINT LEN TIME$",
    "[OPT0:BRA P%:]",
    "[OPT0:PHX:]",
    "[OPT0:PHY:]",
    "[OPT0:PLX:]",
    "[OPT0:PLY:]",
    "[OPT0:INA:]",
    "[OPT0:DEA:]",
    "[OPT0:STZ &70:]",
    "[OPT0:STZ &70,X:]",
    "[OPT0:STZ &1234:]",
    "[OPT0:STZ &70,x:]",
    "[OPT0:TRB &70:]",
    "[OPT0:TSB &1234:]",
    "[OPT0:BIT #1:]",
    "[OPT0:LDA (&70):]",
    "[OPT0:STA (&70):]",
    "[OPT0:LDA &70,x:]",
    "[OPT0:LDA &1234,y:]",
    "[OPT0:LDA (&70,x):]",
    "[OPT0:LDA (&70),y:]",
    "[OPT0:equb 1:]",
    "[OPT0:EQUb 1:]",
    "[OPT0:EQUw 1:]",
    "[OPT0:ORa 1:]",
];
// What both run, and what neither does.
const OnBothBasics = [
    "COLOUR.",
    "COLO.1",
    "[OPT0:LDA #1:]",
    "[OPT0:INC A:]",
    "[OPT0:ASL A:]",
    "[OPT0:LDA (&70,X):]",
    "[OPT0:LDA (&70),Y:]",
    "[OPT0:JMP (&1234):]",
    "[OPT0:LDX &1234,Y:]",
    "[OPT0:NOP:]",
];
const OnNeitherBasic = [
    "VDU|",
    "VDU 7;|",
    "VDU 7|;",
    "VDU 7||",
    "VDU 7,|",
    "VDU 7|,7",
    "PRINT 7|",
    "X=7|",
    'ERROR 5,"x"',
    "ERROR 5",
    "EXT X=0",
    "EXT=1",
    "EXT#",
    "COLOR",
    "COLOR 1,2",
    "ON 1 FNf",
    "ON 1 PROCq(",
    "TIME$=",
    "TIME$$",
    "[OPT0:LDX &70,x:]",
    "[OPT0:LDY &70,y:]",
    "[OPT0:STZ &1234,Y:]",
    "[OPT0:STZ #1:]",
    "[OPT0:BRA #1:]",
    "[OPT0:JMP (&1234,Y):]",
    "[OPT0:JMP (&1234,Xa):]",
    "[OPT0:LDA (&70),Z:]",
    "[OPT0:LDA (&70,Y):]",
    "[OPT0:LDA (&70:]",
    "[OPT0:LDA (&70,Xa):]",
    "[OPT0:EQUq 1:]",
    "[OPT0:RMB0 &70:]",
    "[OPT0:WAI:]",
    "[OPT0:BBR0 &70,P%:]",
];

describe("BASIC IV", () => {
    beforeEach(() => setBasicIV(true));
    afterEach(() => setBasicIV(false));

    it("should tokenise each line as the Master's BASIC does", () => {
        const wrong = MasterTokens.flatMap(([text, recorded]) => {
            const ours = hex(romBytes(lexLine(text)));
            return ours === recorded.replace(/( 20)+$/, "") ? [] : [{text, recorded, ours}];
        });
        assert.deepStrictEqual(wrong, []);
    });
    it("should mark an error in each line BASIC IV stops at with one, and none where it runs", () => {
        assert.deepStrictEqual(
            wrongRows(MasterVerdicts, {stricter: StricterThanRom, gaps: KnownGaps}),
            [],
        );
    });
    it("should give the error BASIC IV gives, or none where it does not know it", () => {
        assert.deepStrictEqual(wrongMessages(MasterVerdicts), []);
    });
    it("should word a bad hexadecimal number as BASIC IV does", () => {
        const [{message}] = getSyntaxMarkers("X=&G");
        expect(message).toMatch(/^Expected a hex digit .*\(BASIC: Bad Hex\)$/);
        setBasicIV(false);
        expect(getSyntaxMarkers("X=&G")[0].message).toContain("Bad HEX");
    });
});

describe("Each BASIC's own recorded rows", () => {
    afterEach(() => setBasicIV(false));

    it.each(OnlyOnBasicIV)("%j is red for BASIC II and runs on BASIC IV", text => {
        expect(verdicts.get(text)).not.toBe("ok");
        expect(masterVerdicts.get(text)).toBe("ok");
        expect(stops(text)).toBe(true);
        setBasicIV(true);
        expect(stops(text)).toBe(false);
    });
    it.each(["[OPT0:JMP (&1234,X):]", "[OPT0:JMP (&1234,x):]"])(
        "%j is red for BASIC II and runs on BASIC IV (BASIC II's own row waits for #224)",
        text => {
            expect(masterVerdicts.get(text)).toBe("ok");
            expect(stops(text)).toBe(true);
            setBasicIV(true);
            expect(stops(text)).toBe(false);
        },
    );
    it.each(OnBothBasics)("%j runs on both", text => {
        expect(masterVerdicts.get(text)).toBe("ok");
        expect(stops(text)).toBe(false);
        setBasicIV(true);
        expect(stops(text)).toBe(false);
    });
    it.each(OnNeitherBasic)("%j stops both", text => {
        expect(verdicts.get(text) ?? masterVerdicts.get(text)).not.toBe("ok");
        expect(masterVerdicts.get(text)).not.toBe("ok");
        const marked = text => stops(text) || getSyntaxMarkers(text).length > 0;
        expect(marked(text)).toBe(true);
        setBasicIV(true);
        expect(marked(text)).toBe(true);
    });
});

describe("The editor on the Master", () => {
    beforeEach(() => registerBbcBasicLanguage());
    afterEach(() => useBasicIV(false));

    // The colour of the character at the offset in the editor's own reading of the line.
    const colourAt = (text, offset) => {
        const model = editor.createModel(text, "BBCBASIC");
        try {
            model.tokenization.forceTokenization(1);
            const tokens = model.tokenization.getLineTokens(1);
            return tokens.getForeground(tokens.findTokenIndexAtOffset(offset));
        } finally {
            model.dispose();
        }
    };
    const redAt = (text, offset) => colourAt(text, offset) === colourAt(")", 0);

    it("should colour a line again when the machine changes", () => {
        expect(redAt("V.23,255,255|", 12)).toBe(true);
        expect(redAt("[BRA P%", 1)).toBe(true);
        useBasicIV(true);
        expect(redAt("V.23,255,255|", 12)).toBe(false);
        expect(redAt("[BRA P%", 1)).toBe(false);
        useBasicIV(false);
        expect(redAt("V.23,255,255|", 12)).toBe(true);
    });
    it("should read COLOR as the keyword on the Master", () => {
        const keyword = colourAt("COLOUR 1", 0);
        expect(colourAt("COLOR 1", 0)).not.toBe(keyword);
        useBasicIV(true);
        expect(colourAt("COLOR 1", 0)).toBe(keyword);
    });
    it("should mark the lines BASIC IV stops at, not those BASIC II does", () => {
        const text = "V.7|\nVDU|";
        expect(getSyntaxMarkers(text).map(marker => marker.startLineNumber)).toEqual([1, 2]);
        useBasicIV(true);
        expect(getSyntaxMarkers(text).map(marker => marker.startLineNumber)).toEqual([2]);
    });
    it("should warn about lower case keywords BASIC IV has", () => {
        expect(getWarnings("color 1")).toEqual([]);
        useBasicIV(true);
        expect(getWarnings("color 1").map(warning => warning.message)).toEqual([
            "BASIC keywords should be upper case, did you mean COLOR?",
        ]);
    });
    it("should offer the keywords BASIC IV has", () => {
        const offered = text => completionContext(text).labels;
        expect(offered("")).not.toContain("EXT");
        expect(offered("X=")).not.toContain("EDIT");
        useBasicIV(true);
        expect(offered("")).toContain("EXT");
        expect(offered("X=")).toContain("EXT");
        expect(offered("").concat(offered("X="))).not.toContain("EDIT");
    });
});
