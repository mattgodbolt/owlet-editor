import {afterEach, beforeEach, describe, expect, it} from "vitest";
import assert from "assert";
import {editor} from "monaco-editor/editor/editor.api";
import {getSyntaxMarkers, getWarnings, registerBbcBasicLanguage} from "../src/bbcbasic";
import {completionContext} from "../src/completions";
import {BasicIIDialect, BasicIVDialect, ModelBDialect} from "../src/parser/dialect";
import {programProblems, readLines} from "../src/parser/highlight";
import {lexLine, romBytes} from "../src/parser/lexer";
import {
    MasterTokens,
    MasterVerdicts,
    masterVerdicts,
    verdicts,
    wrongMessages,
    wrongRows,
} from "./rom-tables";

const hex = bytes => bytes.map(b => b.toString(16).padStart(2, "0")).join(" ");
// Whether the recogniser says BASIC stops at the line, or would if the line ended there.
const stops = (text, dialect) =>
    programProblems(readLines(text, dialect)).some(problem => !problem.stricter);

// Lines BASIC IV runs that are marked on purpose (see the README): what follows a complete instruction is ignored, and
// an ELSE that no IF is waiting for.
const StricterThanRom = [
    "X%=6ELSE7",
    "PRINT 1 ELSE PRINT 2",
    "A=1:B=2 ELSE C=3",
    "X%=6ELSE )",
    "IF 0 THEN PRINT 1 ELSE PRINT 2 ELSE PRINT 3",
    "IF 0 THEN PRINT 1 ELSE PRINT 2 ELSE )",
    "IF 0 THEN A=1 ELSE C=3:D=4 ELSE E=5",
    "[OPT0:NOP;x:]",
    "[OPT0:NOP ;x:]",
    "[OPT0:BNE &70;x:]",
    "[OPT0:JMP &70 ;x:]",
    "[OPT0:EQUB 1;x:]",
    '[OPT0:EQUS "a";x:]',
    "[OPT0:ASL A;x:]",
    "[OPT0:LDA (&70),Y;x:]",
    "[OPT0:LDA #1;PRINT:]",
    "[OPT0:LDA #1;:NOP:]",
    "[OPT0:LDA #1;x",
    "[OPT0:LDA #1|x:]",
    "[OPT0:ADC (&70)+1:]",
    "[OPT0:AND (&70)+1:]",
    "[OPT0:CMP (&70)+1:]",
    "[OPT0:EOR (&70)+1:]",
    "[OPT0:LDA (&70)+1:]",
    "[OPT0:ORA (&70)+1:]",
    "[OPT0:SBC (&70)+1:]",
    "[OPT0:STA (&70)+1:]",
    "[OPT0:JMP (&70)+1:]",
    ...["(1)+(2,X)", "(1)+2", "(1)+(2)", "(1) LDA 2", "(1))+2", "(1)(2)", "(1)+(2,Y)"].map(
        o => `[OPT0:JMP ${o}:]`,
    ),
    "[OPT0:JMP (1)+(2,X)]",
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
    it("should tokenise each line as the Master's BASIC does", () => {
        const wrong = MasterTokens.flatMap(([text, recorded]) => {
            const ours = hex(romBytes(lexLine(text, BasicIVDialect)));
            return ours === recorded.replace(/( 20)+$/, "") ? [] : [{text, recorded, ours}];
        });
        assert.deepStrictEqual(wrong, []);
    });
    it("should mark an error in each line BASIC IV stops at with one, and none where it runs", () => {
        assert.deepStrictEqual(
            wrongRows(MasterVerdicts, {
                stricter: StricterThanRom,
                dialect: BasicIVDialect,
            }),
            [],
        );
    });
    it("should give the error BASIC IV gives, or none where it does not know it", () => {
        assert.deepStrictEqual(wrongMessages(MasterVerdicts, [], BasicIVDialect), []);
    });
    it.each([["EDITED=FALSE"], ["EDIT 10"], ["A=1:ED."], ["IF A THEN EDIT"]])(
        "should say Syntax error at %j, where a program starts a statement with EDIT",
        text => {
            expect(getSyntaxMarkers(text, BasicIVDialect).map(m => m.message)).toEqual([
                expect.stringContaining("(BASIC: Syntax error)"),
            ]);
        },
    );
    it("should not mark EDIT where BASIC IV does not stop at it", () => {
        expect(getSyntaxMarkers("edited=FALSE", BasicIVDialect)).toEqual([]);
        expect(getSyntaxMarkers("REM EDIT 10", BasicIVDialect)).toEqual([]);
        expect(getSyntaxMarkers("EDITED=FALSE", ModelBDialect)).toEqual([]);
    });
    it("should word a bad hexadecimal number as BASIC IV does", () => {
        const [{message}] = getSyntaxMarkers("X=&G", BasicIVDialect);
        expect(message).toMatch(/^Expected a hex digit .*\(BASIC: Bad Hex\)$/);
        expect(getSyntaxMarkers("X=&G", ModelBDialect)[0].message).toContain("Bad HEX");
    });
    it.each([
        ["ON 1 PRINT", false, "Expected GOTO or GOSUB here, not PRINT (BASIC: ON syntax)"],
        ["ON 1 PRINT", true, "Expected GOTO, GOSUB or PROC here, not PRINT (BASIC: ON syntax)"],
        ["ON 1 PROCp", false, "Expected GOTO or GOSUB here, not PROC (BASIC: ON syntax)"],
        ["ON 1 PROCp", true, null],
    ])("should name only what ON accepts: %j on BASIC IV %j", (text, basicIV, expected) => {
        const dialect = basicIV ? BasicIVDialect : ModelBDialect;
        expect(getSyntaxMarkers(text, dialect)[0]?.message ?? null).toBe(expected);
    });
});

describe("Each BASIC's own recorded rows", () => {
    it.each(OnlyOnBasicIV)("%j is red for BASIC II and runs on BASIC IV", text => {
        expect(verdicts.get(text)).not.toBe("ok");
        expect(masterVerdicts.get(text)).toBe("ok");
        expect(stops(text, BasicIIDialect)).toBe(true);
        expect(stops(text, BasicIVDialect)).toBe(false);
    });
    it.each(["[OPT0:JMP (&1234,X):]", "[OPT0:JMP (&1234,x):]"])(
        "%j is an Index error on BASIC II and runs on BASIC IV",
        text => {
            expect(verdicts.get(text)).toBe("Index");
            expect(masterVerdicts.get(text)).toBe("ok");
            expect(stops(text, ModelBDialect)).toBe(true);
            expect(stops(text, BasicIVDialect)).toBe(false);
        },
    );
    // A ( after JMP is indirect addressing: what follows the ) is ignored on both BASICs.
    it.each([
        ["[OPT0:JMP (1)+(2,X):]", "ok", "ok"],
        ["[OPT0:JMP (1)+2:]", "ok", "ok"],
        ["[OPT0:JMP (1) LDA 2:]", "ok", "ok"],
        ["[OPT0:JMP (1,X):]", "Index", "ok"],
        ["[OPT0:JMP (1)+(2,Y):]", "ok", "ok"],
        ["[OPT0:JMP (&1234,Y):]", "Index", "Index"],
        ["[OPT0:JMP (1:]", "Index", "Index"],
        ["[OPT0:JSR (1)+(2,X):]", "Missing )", "Missing )"],
    ])("%j is %s on BASIC II and %s on BASIC IV", (text, basicII, basicIV) => {
        expect(verdicts.get(text)).toBe(basicII);
        expect(masterVerdicts.get(text)).toBe(basicIV);
        const message = dialect =>
            programProblems(readLines(text, dialect)).find(problem => !problem.stricter)?.message;
        expect(stops(text, ModelBDialect)).toBe(basicII !== "ok");
        if (basicII !== "ok") expect(message(ModelBDialect)).toBe(basicII);
        expect(stops(text, BasicIVDialect)).toBe(basicIV !== "ok");
        if (basicIV !== "ok") expect(message(BasicIVDialect)).toBe(basicIV);
    });
    it.each(OnBothBasics)("%j runs on both", text => {
        expect(masterVerdicts.get(text)).toBe("ok");
        expect(stops(text, ModelBDialect)).toBe(false);
        expect(stops(text, BasicIVDialect)).toBe(false);
    });
    it.each(OnNeitherBasic)("%j stops both", text => {
        expect(verdicts.get(text) ?? masterVerdicts.get(text)).not.toBe("ok");
        expect(masterVerdicts.get(text)).not.toBe("ok");
        const marked = (text, dialect) =>
            stops(text, dialect) || getSyntaxMarkers(text, dialect).length > 0;
        expect(marked(text, ModelBDialect)).toBe(true);
        expect(marked(text, BasicIVDialect)).toBe(true);
    });
});

describe("The editor on the Master", () => {
    beforeEach(() => registerBbcBasicLanguage(ModelBDialect));
    afterEach(() => registerBbcBasicLanguage(ModelBDialect));

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
        registerBbcBasicLanguage(BasicIVDialect);
        expect(redAt("V.23,255,255|", 12)).toBe(false);
        expect(redAt("[BRA P%", 1)).toBe(false);
        registerBbcBasicLanguage(ModelBDialect);
        expect(redAt("V.23,255,255|", 12)).toBe(true);
    });
    it("should read COLOR as the keyword on the Master wherever it is, and on a Model B only where it is COLOUR", () => {
        const keyword = colourAt("COLOUR 1", 0);
        expect(colourAt("COLOR 1", 0)).toBe(keyword);
        expect(colourAt("COLORS=7", 0)).not.toBe(keyword);
        registerBbcBasicLanguage(BasicIVDialect);
        expect(colourAt("COLOR 1", 0)).toBe(keyword);
        expect(colourAt("COLORS=7", 0)).toBe(keyword);
    });
    it("should mark the lines BASIC IV stops at, not those BASIC II does", () => {
        const text = "V.7|\nVDU|";
        const lines = dialect =>
            getSyntaxMarkers(text, dialect).map(marker => marker.startLineNumber);
        expect(lines(ModelBDialect)).toEqual([1, 2]);
        expect(lines(BasicIVDialect)).toEqual([2]);
    });
    it("should warn about lower case keywords BASIC IV has", () => {
        expect(getWarnings("color 1", ModelBDialect)).toEqual([]);
        expect(getWarnings("color 1", BasicIVDialect).map(warning => warning.message)).toEqual([
            "BASIC keywords should be upper case, did you mean COLOR?",
        ]);
    });
    it("should offer the keywords BASIC IV has", () => {
        const offered = (text, dialect) => completionContext(text, dialect).labels;
        expect(offered("", ModelBDialect)).not.toContain("EXT");
        expect(offered("X=", ModelBDialect)).not.toContain("EDIT");
        expect(offered("", BasicIVDialect)).toContain("EXT");
        expect(offered("X=", BasicIVDialect)).toContain("EXT");
        expect(offered("", BasicIVDialect).concat(offered("X=", BasicIVDialect))).not.toContain(
            "EDIT",
        );
        expect(offered("ON X ", ModelBDialect)).not.toContain("PROC");
        expect(offered("ON X ", BasicIVDialect)).toContain("PROC");
    });
});
