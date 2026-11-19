import {
    BasicIIDialect,
    BasicIVDialect,
    ModelBDialect,
    canStartStatement,
} from "../src/parser/dialect";
import {highlightLine, programProblems, readLines} from "../src/parser/highlight";
import {lexLine, romBytes} from "../src/parser/lexer";
import {
    BracketFunction,
    ChannelFunction,
    ExpectingRecogniser,
    ExpressionCount,
    NoArgument,
    OneArgument,
    Recogniser,
    TextKeyword,
} from "../src/parser/recogniser";
import {Flags} from "../src/tokens";
import {
    invalidSpans,
    LenientThanRom,
    RomTokens,
    RomVerdicts,
    verdicts,
    wrongMessages,
    wrongRows,
} from "./rom-tables";
import {describe, it} from "vitest";
import assert from "assert";

const hex = bytes => bytes.map(b => b.toString(16).padStart(2, "0")).join(" ");

// The rows of a recorded table on which the function's answer differs from the recorded one, with both answers.
const disagreements = (rows, answer) =>
    rows.flatMap(([text, recorded]) => {
        const ours = answer(text);
        return ours === recorded ? [] : [{text, recorded, ours}];
    });

describe("Lexer", () => {
    it("should tokenise each line as BASIC II does", () => {
        assert.deepStrictEqual(
            disagreements(RomTokens, text => hex(romBytes(lexLine(text, ModelBDialect)))),
            [],
        );
    });
});

// Lines BASIC II rejects that the recogniser does not mark: false-valids are measured, not gated (see the README).
// A "(" after a space can belong to a FN or PROC call or not, depending on its DEF.
const KnownGaps = ["X=FNf (1)", "PROCp (1)", 'LIST IF "a"'];

// Lines BASIC II runs that are marked on purpose (see the README): anything but a comment after a complete assembler
// instruction, and a character in a mnemonic that is not a letter but that BASIC reads as one.
const StricterThanRom = [
    "[OPT0:JMP (&70)+1:]",
    ...["(1)+(2,X)", "(1)+2", "(1)+(2)", "(1) LDA 2", "(1))+2", "(1)(2)", "(1)+(2,Y)"].map(
        o => `[OPT0:JMP ${o}:]`,
    ),
    "[OPT0:JMP (1)+(2,X)]",
    "[OPT0:STƀ 9:]",
    "[OPT0:STƂ 9:]",
    "[OPT0:ČDA 9:]",
    "[OPT0:ƀDA 9:]",
    "[OPT0:ƂDA 9:]",
    "[OPT0:LĄA 9:]",
    "[OPT0:LƀA 9:]",
    "[OPT0:LƂA 9:]",
    "[OPT0:LƄA 9:]",
    "[OPT0:LDā 9:]",
    "[OPT0:LDƀ 9:]",
    "[OPT0:LDƂ 9:]",
    "[OPT0:ēTA 9:]",
    "[OPT0:ƀTA 9:]",
    "[OPT0:ƂTA 9:]",
    "[OPT0:SĔA 9:]",
    "[OPT0:SƀA 9:]",
    "[OPT0:SƂA 9:]",
    "[OPT0:SƄA 9:]",
    "[OPT0:STā 9:]",
    "[OPT0:ăPX 9:]",
    "[OPT0:ƀPX 9:]",
    "[OPT0:ƂPX 9:]",
    "[OPT0:CĐX 9:]",
    "[OPT0:CƀX 9:]",
    "[OPT0:CƂX 9:]",
    "[OPT0:CPĘ 9:]",
    "[OPT0:CPƀ 9:]",
    "[OPT0:CPƂ 9:]",
    "[OPT0:ĉNX:]",
    "[OPT0:IĎX:]",
    "[OPT0:IƀX:]",
    "[OPT0:IƂX:]",
    "[OPT0:INĘ:]",
    "[OPT0:ĔAX:]",
    "[OPT0:TāX:]",
    "[OPT0:TƀX:]",
    "[OPT0:TƂX:]",
    "[OPT0:TAĘ:]",
    "[OPT0:āND 9:]",
    "[OPT0:ƀND 9:]",
    "[OPT0:ƂND 9:]",
    "[OPT0:AĎD 9:]",
    "[OPT0:AƀD 9:]",
    "[OPT0:AƂD 9:]",
    "[OPT0:ANĄ 9:]",
    "[OPT0:ANƀ 9:]",
    "[OPT0:ANƂ 9:]",
    "[OPT0:ďPT0:]",
    "[OPT0:OĐT0:]",
    "[OPT0:OƀT0:]",
    "[OPT0:OƂT0:]",
    "[OPT0:OPĔ0:]",
    "[OPT0:OPƀ0:]",
    "[OPT0:OPƂ0:]",
    "[OPT0:ąQUB 9:]",
    "[OPT0:ƀQUB 9:]",
    "[OPT0:ƂQUB 9:]",
    "[OPT0:EđUB 9:]",
    "[OPT0:EƀUB 9:]",
    "[OPT0:EƂUB 9:]",
    "[OPT0:EQĕB 9:]",
    "[OPT0:EQƀB 9:]",
    "[OPT0:EQƂB 9:]",
    "[OPT0:STAH.,X:]",
    "[OPT0:LDAUSR@%+GET:]",
    "[OPT0:LDAH.:]",
    "[OPT0:EQUBH.:]",
    "[OPT0:ORAH.:]",
    "[OPT0:JMPH.:]",
    "[OPT0:ASLH.:]",
    "[OPT0:LDAP.,X:]",
    "[OPT0:LDAPRINT 5:]",
    "[OPT0:staH.,x:]",
    "[OPT0:LDAGETX 5:]",
    "[OPT0:NOP PAGE:]",
    "[OPT0:INXH.:]",
    "[OPT0:NOPPAGE:]",
    "[OPT0:NOP PRINT:]",
    "[OPT0:LDA #1 FOR:]",
    "[OPT0:LDA #1 hello:]",
    "[OPT0:NOP 5:]",
    "[OPT0:NOP =1:]",
    '[OPT0:LDA #1 "x":]',
    "[OPT0:LDA #1 ,X:]",
    "[OPT0:LDA #1,x:]",
    "[OPT0:JSR &70,x:]",
    "[OPT0:EQUB 1 LDA 2:]",
    "[OPT0:BRK 1:]",
    "[OPT0:TAX X:]",
    "[OPT0:ROR A | Anagram of ROAR:]",
    "[OPT0:ROR A Anagram of ROAR:]",
    "[OPT0:BIT &70,X:]",
    "[OPT0:BIT &70,Y:]",
    "[OPT0:BIT (&70),Y:]",
    "[OPT0:CPX &70,X:]",
    "[OPT0:CPX &70,Y:]",
    "[OPT0:CPX (&70),Y:]",
    "DIM P% 99:[OPT0:STA &70,XX:]",
    "[STA &70,XX:]",
    "[STA &70,Xa:]",
    "[STA &70,X1:]",
    "[STA &70,Xfoo:]",
    "[STA &70,Y1:]",
    "[LDA (&70),YY:]",
    "[LDX &70,yy:]",
    "[LDY &70,Xx:]",
    "[ASL &70,XX:]",
    "[LDA (&70,X)X:]",
    "[. lab LDA #1]",
    "[NOP]:]",
    "[NOP]:NOP",
    "[LDA #1]:]",
    "[LDA #1]]",
    "[LDA #1]:NOP:]",
    "[LDA #1]:]:PRINT",
    "[OPT0:LDA #1]:tax=1",
    "[OPT0:NOP]:]:P%=P%+5",
    "[ST89:]",
    "[OPT0:ST89:]",
    "[OPT0:LDA 1:LD! 1:]",
    "[OPT0:LD89:]",
    "[OPT0:LD99:]",
    "[OPT0:LD89 &70:]",
    "[OPT0:LD!5:]",
    "[OPT0:ST!76:]",
    "[OPT0:LD90:]",
    "[OPT0:ST\u0001 9:]",
    "[OPT0:TA8:]",
    "[OPT0:IN9:]",
    "[OPT0:CP8 5:]",
    "[OPT0:CP9 5:]",
    "[OPT0:J-P &70:]",
    "[OPT0:3EC:]",
    "[OPT0:B2K:]",
    "[OPT0:O2A 5:]",
    "[OPT0:/RA 5:]",
    "[OPT0:EO2 5:]",
    "[OPT0:E/R 5:]",
    "[OPT0:AN$ 5:]",
    "[OPT0:!ND 5:]",
    "[OPT0:OP4 0:]",
    "[OPT0:O0T 0:]",
    // BASIC II reads no index after BIT, CPX and CPY, and nothing after the register of (&70),Y.
    "[OPT0:BIT &70,x:]",
    "[OPT0:BIT &1234,Y:]",
    "[OPT0:BIT &1234,y:]",
    "[OPT0:BIT (&70),y:]",
    "[OPT0:CPX &70,x:]",
    "[OPT0:CPX &1234,Y:]",
    "[OPT0:CPX &1234,y:]",
    "[OPT0:CPX (&70),y:]",
    "[OPT0:CPY &70,X:]",
    "[OPT0:CPY &70,x:]",
    "[OPT0:CPY &1234,Y:]",
    "[OPT0:CPY &1234,y:]",
    "[OPT0:CPY (&70),Y:]",
    "[OPT0:CPY (&70),y:]",
    "[OPT0:LDA (&70),Ya:]",
];

const invalid = text => invalidSpans(text, BasicIIDialect);

// Lines where BASIC's error is not the one the recogniser gives for that kind of mistake: H.TO8 is not read as HIMEM.
const OtherWording = ["F.A=H.TO8^5:?A=42:N."];

describe("A raw token byte", () => {
    // The bot and BASIC keep the low eight bits of a character, so other programs pick other characters for a byte.
    it.each([
        ["EVAL", 0xa0],
        ["OPENUP", 0xad],
        ["PRINT", 0xf1],
        ["AND", 0x80],
    ])("%s is read from any character whose low eight bits are its byte", (keyword, byte) => {
        const chars = [byte, byte + 0x100, byte + 0x200, byte + 0x300].map(code =>
            String.fromCharCode(code),
        );
        const bytes = chars.map(char => romBytes(lexLine(`10 X=${char}`, ModelBDialect)));
        assert.deepStrictEqual(
            bytes.map(line => line.at(-1)),
            chars.map(() => byte),
        );
        for (const char of chars) {
            const token = lexLine(`10 ${char}`, ModelBDialect).find(
                token => token.kind === "keyword",
            );
            assert.strictEqual(token?.kw.keyword, keyword);
            assert.strictEqual(token.raw, true);
        }
    });
    // The ROM tokenises each of these pairs to the same bytes: every UTF-16 code unit is kept to its low eight bits.
    it.each([
        ['10 \u0141$="x"', '10 A$="x"'],
        ["10 A$=\u0122x\u0122", '10 A$="x"'],
        ["10 P\u0152INT 1", "10 PRINT 1"],
        ["10 PRINT\u01201", "10 PRINT 1"],
        ["10 PRINT \u0131\u0132", "10 PRINT 12"],
    ])("%j is %j", (alias, plain) => {
        assert.deepStrictEqual(
            romBytes(lexLine(alias, ModelBDialect)),
            romBytes(lexLine(plain, ModelBDialect)),
        );
        assert.deepStrictEqual(
            highlightLine(alias, ModelBDialect).tokens,
            highlightLine(plain, ModelBDialect).tokens,
        );
    });
    it("leaves a control byte alone, since U+010A is data and not a line break", () => {
        assert.strictEqual(
            lexLine('10 A$="\u010a"', ModelBDialect).find(token => token.kind === "string").closed,
            true,
        );
    });
});

describe("Recogniser", () => {
    it("should mark an error in each line BASIC II stops at with one, and none where it runs", () => {
        assert.deepStrictEqual(
            wrongRows(RomVerdicts, {
                stricter: StricterThanRom,
                gaps: KnownGaps,
                dialect: BasicIIDialect,
            }),
            [],
        );
    });
    it("should give the error BASIC II gives, or none where it does not know it", () => {
        assert.deepStrictEqual(wrongMessages(RomVerdicts, OtherWording, BasicIIDialect), []);
    });
    it("should not let errors inside nested reads use up the nesting limit", () => {
        const text = `[${"LDA #(:".repeat(70)}LDA #1:]`;
        const {tokens} = highlightLine(text, ModelBDialect);
        const marked = tokens.filter(token => token.type === "invalid");
        assert.strictEqual(marked.length, 70);
        assert.ok(marked.every(token => token.offset < text.lastIndexOf("LDA #1")));
    });
    it("should still miss the known gaps, which come out of the list when they are fixed", () => {
        for (const text of KnownGaps) {
            assert.notStrictEqual(verdicts.get(text), "ok", text);
            assert.ok(
                highlightLine(text, ModelBDialect).tokens.every(
                    token => !token.type.startsWith("invalid"),
                ),
                text,
            );
        }
    });
});

// The text of each run of tokens marked invalid.
const redRuns = text => {
    const runs = [];
    for (const [start, end] of invalid(text)) {
        if (runs.length && runs[runs.length - 1][1] === start) runs[runs.length - 1][1] = end;
        else runs.push([start, end]);
    }
    return runs.map(([start, end]) => text.slice(start, end));
};

// The text of each token marked invalid.
const red = text => invalid(text).map(([start, end]) => text.slice(start, end));

// Every prefix of each line, as typed a key at a time, and the prefixes that are red: only those that no ending can
// make valid, such as a number after a complete GOTO.
const Typed = [
    ["GOTO 20", []],
    ["FOR I=1 TO 10", []],
    ["FOR I=1 TO 10 STEP 2", []],
    ["IF A=1 THEN PRINT 2", []],
    ["PRINT (1+2)", []],
    ["A$=LEFT$(B$,3)", []],
    ["REPEAT UNTIL X=1", []],
    ["10 GOSUB 100", []],
    ["DEF PROCfoo", []],
    ['PRINT "HI"', []],
    ["X=1+2*3", []],
    ["X=1 AND 2", []],
    ["ON X GOTO 10", []],
    ["ENDPROC", []],
    ["[LDA (&70),Y", []],
    ["[EQUB 1", []],
    ["GOTO 20 30", ["GOTO 20 3", "GOTO 20 30"]],
    ["X=1 THEN", ["X=1 T", "X=1 TH", "X=1 THE", "X=1 THEN"]],
];

describe("A line typed a key at a time", () => {
    it.each(Typed)(
        "%s should be red only where no ending could make it valid",
        (line, expected) => {
            const prefixes = [...line].map((_, i) => line.slice(0, i + 1));
            assert.deepStrictEqual(
                prefixes.filter(prefix => invalid(prefix).length),
                expected,
            );
        },
    );
});

// BASIC stops at the first token that cannot continue the statement and never reads the rest of it, up to the next
// colon, ELSE, or the ] that ends an assembler block: all of that is red, and it is what the marker covers.
describe("A statement BASIC stops at", () => {
    it.each([
        ["I am a badger", ["am a badger"]],
        ["X Y Z", ["Y Z"]],
        ["PRINT 1 2 3", []],
        ["GOTO 20 30:PRINT 5", ["30"]],
        ["GOTO 20 30 40:PRINT 5 6", ["30 40"]],
        ["PRINT 1: I am a badger:PRINT 2", ["am a badger"]],
        ["IF A=1 THEN PRINT ) ELSE PRINT 2", [")"]],
        ["IF A=1 THEN PRINT ) 1 ELSE PRINT 2 3", [") 1"]],
        ["PRINT (1 2 3):PRINT 4 5", ["2 3)"]],
        ['I am "a:b" badger:X Y', ['am "a:b" badger', "Y"]],
        ["X Y REM hi", ["Y"]],
        ["[LDA CLEAR 1 2:NOP:]", ["CLEAR 1 2"]],
        ["IF A THEN [LDA CLEAR 1 ELSE PRINT 2", ["CLEAR 1"]],
    ])("%s should be red on %j", (text, expected) => {
        assert.deepStrictEqual(redRuns(text), expected);
        const {tokens} = highlightLine(text, ModelBDialect);
        assert.ok(tokens.every(token => !token.type.startsWith("invalid") || !token.bracket));
        const marked = programProblems(readLines(text, ModelBDialect)).filter(
            problem => !problem.unfinished,
        );
        assert.deepStrictEqual(
            marked.map(({start, end}) => text.slice(start, end)),
            expected,
        );
    });
    it("should leave the marker at the single [ of a block that is never closed", () => {
        const problems = programProblems(readLines("[NOP\nLDA CLEAR 1 2", ModelBDialect));
        assert.deepStrictEqual(
            problems.map(({line, start, end, unclosed}) => [line, start, end, unclosed]),
            [[1, 0, 1, true]],
        );
    });
});

describe("Text that is wrong, not unfinished", () => {
    it.each([
        ["GOTO 20 30", ["30"]],
        ["PRINT )", [")"]],
        ["PRINT A)", [")"]],
        ["PRINT I)", [")"]],
        ["A=1'", ["'"]],
        ["X=1+*", ["*"]],
        ["X=1 TH", ["TH"]],
        ["END 1", ["1"]],
        ["PRINT (1+2))", [")"]],
        ["A$=LEFT$(X$,1,", [","]],
        ["X=RND(1,", [","]],
        ["X=RND(1,:P.", [","]],
        ["A$=LEFT$(X$,1,:P.", [","]],
        ["GOTO:PRINT", ["GOTO"]],
        ["FOR I=1 TO:NEXT", ["TO"]],
        ["FOR I:PRINT I:NEXT", ["I"]],
        ["A=1:FOR I:NEXT", ["I"]],
        ["IF A THEN PRINT:FOR I:NEXT", ["I"]],
    ])("%s should be red", (text, expected) => {
        assert.deepStrictEqual(red(text), expected);
    });
});

// The text at each key of a line typed in front of `after`, with Monaco's auto-closing "(": a typed ")" goes over the
// one it inserted.
function keysTyped(typed, after = "") {
    let before = "";
    let closing = "";
    return [...typed].map(key => {
        if (key === ")" && closing.startsWith(")")) closing = closing.slice(1);
        else if (key === "(") closing = `)${closing}`;
        before += key;
        return before + closing + after;
    });
}

describe("A line typed in an editor that closes brackets", () => {
    it.each([
        ["PRINT (1+2)*3"],
        ["A$=LEFT$(B$,2)"],
        ['PRINT TAB(1,2);"x"'],
        ["PROCbox(1,2)"],
        ["DIM a(10)"],
        ["PRINT LEFT$(A$,LEN(B$))"],
    ])("%s should be red on no key", typed => {
        assert.deepStrictEqual(
            keysTyped(typed).filter(text => invalid(text).length),
            [],
        );
    });
    it("should be unfinished at the ) with the last argument missing, and red with one too many", () => {
        const [problem] = programProblems(readLines("A$=LEFT$(B$)", ModelBDialect));
        assert.deepStrictEqual(invalid("A$=LEFT$(B$)"), []);
        assert.strictEqual(problem.unfinished, true);
        assert.strictEqual("A$=LEFT$(B$)".slice(problem.start, problem.end), ")");
        assert.deepStrictEqual(red("A$=LEFT$(B$,1,2)"), [",2)"]);
    });
});

// COLOR, the US spelling, as the editor's Model B reads it: COLOUR where it starts a statement, is followed by an
// expression and then the end of the statement, and could not be a variable; BASIC II's ROM says Mistake to it.
describe("COLOR on the editor's Model B", () => {
    const redB = text => invalidSpans(text, ModelBDialect).map(([a, b]) => text.slice(a, b));
    const kinds = (text, dialect) =>
        readLines(text, dialect)[0]
            .tokens.filter(t => t.kind !== "white")
            .map(t => `${t.kind} ${t.text}`);

    it("should agree with every recorded row of BASIC II but the ones it is lenient on", () => {
        assert.deepStrictEqual(
            wrongRows(RomVerdicts, {
                stricter: StricterThanRom,
                gaps: KnownGaps,
                lenient: LenientThanRom,
                dialect: ModelBDialect,
            }),
            [],
        );
        assert.deepStrictEqual(wrongMessages(RomVerdicts, OtherWording, ModelBDialect), []);
    });
    it("should leave BASIC II's own dialect as the ROM reads COLOR", () => {
        assert.deepStrictEqual(red("COLOR 1"), ["1"]);
        assert.deepStrictEqual(kinds("COLOR 1", BasicIIDialect), ["name COLOR", "number 1"]);
    });
    it.each([
        "COLOR7",
        "COLOR 7",
        "COLOR X",
        "COLOR(1)",
        "COLORC%",
        "COLOR7:COLOR 1",
        "IFC%COLORC%ELSECOLORD%:NEXT",
        "X=1:REP.COLORX:P.;X:X=X+1:U.X>7",
        "ONERRORCOLOR7:GOTO1000",
        "LETCOLOR=3:COLORCOLOR",
        "IF X THEN COLOR 1 ELSE COLOR 2",
        "10 COLOR 1",
    ])("%s should be COLOUR where it starts a statement, and not red", text => {
        assert.deepStrictEqual(redB(text), []);
        assert.ok(readLines(text, ModelBDialect)[0].colors.length > 0, text);
        assert.ok(
            readLines(text, ModelBDialect)[0].tokens.some(
                t => t.kind === "keyword" && t.text === "COLOR",
            ),
            text,
        );
    });
    it.each([
        ["COLORS=7", ["name COLORS", "punct =", "number 7"]],
        ["COLOR=7", ["name COLOR", "punct =", "number 7"]],
        ["COLOR(1)=7", ["name COLOR", "punct (", "number 1", "punct )", "punct =", "number 7"]],
        ["COLOR?1=7", ["name COLOR", "punct ?", "number 1", "punct =", "number 7"]],
        ["LETCOLOR=3", ["keyword LET", "name COLOR", "punct =", "number 3"]],
        [
            "LETCOLOR=3:COLORCOLOR",
            [
                "keyword LET",
                "name COLOR",
                "punct =",
                "number 3",
                "punct :",
                "keyword COLOR",
                "name COLOR",
            ],
        ],
        ["X=COLOR", ["name X", "punct =", "name COLOR"]],
        ["PRINT COLOR 1", ["keyword PRINT", "name COLOR", "number 1"]],
        ["color 7", ["name color", "number 7"]],
        ["REM COLOR 7", ["keyword REM", "comment  COLOR 7"]],
        ["DATA COLOR 7", ["keyword DATA", "data  COLOR 7"]],
        ['PRINT "COLOR 7"', ["keyword PRINT", 'string "COLOR 7"']],
        ["COLOR 1,2", ["name COLOR", "number 1", "punct ,", "number 2"]],
        ["COLOR 7 7", ["name COLOR", "number 7", "number 7"]],
        ["EDITED=FALSE", ["name EDITED", "punct =", "keyword FALSE"]],
    ])("%s should keep COLOR as characters", (text, expected) => {
        assert.deepStrictEqual(kinds(text, ModelBDialect), expected);
    });
    it("should be red where BASIC II is, when COLOR is not COLOUR", () => {
        assert.deepStrictEqual(redB("COLOR 1,2"), ["1,2"]);
        assert.deepStrictEqual(redB("color 7"), ["7"]);
        assert.deepStrictEqual(redB("COLOR 7 7"), ["7 7"]);
        assert.deepStrictEqual(redB("X=COLOR 1"), ["1"]);
    });
    it("should stay a variable, not red, while it is typed", () => {
        const [problem] = programProblems(readLines("COLOR", ModelBDialect));
        assert.deepStrictEqual(redB("COLOR"), []);
        assert.strictEqual(problem.unfinished, true);
        assert.deepStrictEqual(kinds("COLOR", ModelBDialect), ["name COLOR"]);
    });
    it.each([
        "COLOR 7",
        "COLOR7",
        "COLORS=7",
        "IFC%COLORC%ELSECOLORD%:NEXT",
        "X=1:REP.COLORX:P.;X:X=X+1:U.X>7",
        "ONERRORCOLOR7:GOTO1000",
        "LETCOLOR=3:COLORCOLOR",
        "COLOR(1)=3",
        "COLOR X:COLOR Y",
    ])("%s should be red on no key when typed a key at a time", typed => {
        assert.deepStrictEqual(
            keysTyped(typed).filter(text => redB(text).length),
            [],
        );
    });
    it.each(["COL.7", "COLO.7", "COLOUR 7", "GCOL 0,1", "COLOURS=7"])(
        "should read %s as BASIC II does",
        text => {
            assert.deepStrictEqual(kinds(text, ModelBDialect), kinds(text, BasicIIDialect));
        },
    );
});

// Text typed in front of existing text is red where BASIC stops at a colon, ELSE or keyword that follows a statement
// still to be finished: no typing at the end of the line mends that.
describe("A line typed in front of existing text", () => {
    it.each([
        [
            "FOR I=1 TO 10",
            ":PRINT I:NEXT",
            [
                "F",
                "FO",
                "FOR",
                "FOR ",
                "FOR I",
                "FOR I=",
                "FOR I=1",
                "FOR I=1 ",
                "FOR I=1 T",
                "FOR I=1 TO",
                "FOR I=1 TO ",
            ],
        ],
        ["GOTO 100", ":REM x", ["G", "GO", "GOT", "GOTO", "GOTO "]],
        [
            "IF A=1 THEN ",
            " PRINT 2",
            ["I", "IF", "IF ", "IF A=", "IF A=1 T", "IF A=1 TH", "IF A=1 THE"],
        ],
        ["X=1+2", ":PRINT X", ["X", "X=", "X=1+"]],
    ])("%s typed before %j should be red only on %j", (typed, after, prefixes) => {
        const reds = keysTyped(typed, after)
            .map((text, i) => [text, typed.slice(0, i + 1)])
            .filter(([text]) => invalid(text).length)
            .map(([, prefix]) => prefix);
        assert.deepStrictEqual(reds, prefixes);
    });
});

describe("A keyword that is the start of a longer one", () => {
    it.each(["MOD", "IF A THEN MOD", "A=TO", "X=1:A=TO", "A=INKEY", "[OR"])(
        "%s should not be red while it could grow",
        text => {
            assert.deepStrictEqual(red(text), []);
        },
    );
    it.each([["MODX", ["MODX"]]])("%s should be red", (text, expected) => {
        assert.deepStrictEqual(red(text), expected);
    });
});

const AliasMessage = (char, letter) =>
    `BASIC reads ${char} as ${letter} here (it compares only part of each character); probably a typo`;
const PrefixMessage = (prefix, kind, char, word, tail, meant) =>
    `${prefix} is not an instruction: the ${kind} letter is missing. BASIC reads the ${char} as ${word[2]} (${word})${tail}; probably ${meant} was meant`;
const Address = ", so what follows is the address";

// BASIC compares only the low five bits of each character of a mnemonic (the ROM rows in test/rom/verdicts), so
// it reads a non-letter as a letter, which is marked on purpose. Where that is the third character, the two letters
// before it are marked, as they are not an instruction on their own (Olly Betts, #174).
describe("A character in a mnemonic that BASIC reads as a letter", () => {
    it.each([
        ["[LD89", "LD", PrefixMessage("LD", "register", "8", "LDX", Address, "LDA, LDX or LDY")],
        ["[ST89", "ST", PrefixMessage("ST", "register", "8", "STX", Address, "STA, STX or STY")],
        [
            "[OPT0:ST89:]",
            "ST",
            PrefixMessage("ST", "register", "8", "STX", Address, "STA, STX or STY"),
        ],
        [
            "[OPT0:ST!76:]",
            "ST",
            PrefixMessage("ST", "register", "!", "STA", Address, "STA, STX or STY"),
        ],
        [
            "[OPT0:LD90:]",
            "LD",
            PrefixMessage("LD", "register", "9", "LDY", Address, "LDA, LDX or LDY"),
        ],
        [
            "[OPT0:LD99:]",
            "LD",
            PrefixMessage("LD", "register", "9", "LDY", Address, "LDA, LDX or LDY"),
        ],
        ["[LD! 5", "LD", PrefixMessage("LD", "register", "!", "LDA", Address, "LDA, LDX or LDY")],
        ["[CP8 5", "CP", PrefixMessage("CP", "register", "8", "CPX", Address, "CPX or CPY")],
        ["[CP9 5", "CP", PrefixMessage("CP", "register", "9", "CPY", Address, "CPX or CPY")],
        ["[TA8", "TA", PrefixMessage("TA", "register", "8", "TAX", "", "TAX or TAY")],
        ["[IN9", "IN", PrefixMessage("IN", "last", "9", "INY", "", "INX, INY or INC")],
        [
            "[OP4 0",
            "OP",
            PrefixMessage("OP", "last", "4", "OPT", ", so what follows is the operand", "OPT"),
        ],
        ["[OPT0:AN$ 5:]", "AN", PrefixMessage("AN", "last", "$", "AND", Address, "AND")],
        ["[BE1 5", "BE", PrefixMessage("BE", "last", "1", "BEQ", Address, "BEQ")],
        [
            "[OPT0:ST\u0001 9:]",
            "ST",
            PrefixMessage("ST", "register", "\u0001", "STA", Address, "STA, STX or STY"),
        ],
    ])(
        "%s should be red on the letters before it, saying what is missing",
        (text, prefix, message) => {
            assert.deepStrictEqual(red(text), [prefix]);
            assert.deepStrictEqual(
                programProblems(readLines(text, ModelBDialect))
                    .filter(problem => problem.stricter)
                    .map(({start, end, message}) => [text.slice(start, end), message]),
                [[prefix, message]],
            );
        },
    );
    // With the character before the third there is no prefix to blame, so just that character is red.
    it.each([
        ["[J-P &70", [[2, 3, "-", "M"]]],
        ["[3EC", [[1, 2, "3", "S"]]],
        ["[/RA 5", [[1, 2, "/", "O"]]],
        ["[O2A 5", [[2, 3, "2", "R"]]],
        ["[OPT0:!ND 5:]", [[6, 7, "!", "A"]]],
        ["[OPT0:E/R 5:]", [[7, 8, "/", "O"]]],
        ["[OPT0:B2K:]", [[7, 8, "2", "R"]]],
    ])("%s should be red on the character, with what BASIC reads it as", (text, expected) => {
        assert.deepStrictEqual(
            programProblems(readLines(text, ModelBDialect))
                .filter(problem => problem.stricter)
                .map(({start, end, message}) => [start, end, message]),
            expected.map(([start, end, char, letter]) => [start, end, AliasMessage(char, letter)]),
        );
        assert.deepStrictEqual(
            red(text),
            expected.map(([start, end]) => text.slice(start, end)),
        );
    });
    // BASIC takes an AND, EOR or OR token among the first three characters as the mnemonic and drops what is before it.
    it.each([
        ["[OPT0:ST\u0180 9:]", "ST"],
        ["[OPT0:LD\u0182 9:]", "LD"],
        ["[OPT0:L\u0184A 9:]", "L"],
        ["[OPT0:I\u0180X:]", "I"],
    ])("%s should be red on what BASIC drops before the token", (text, dropped) => {
        assert.deepStrictEqual(red(text), [dropped]);
        assert.match(
            programProblems(readLines(text, ModelBDialect)).find(problem => problem.stricter)
                .message,
            /^BASIC drops the \w+ before the token/,
        );
    });
    it.each([
        "[LDX 9",
        "[ldx 9",
        "[LDA89",
        "[OPT0:LDA 1:]",
        "[Ldx &70,y",
        "[OPT0:ora 5:]",
        "[oRA 5",
        "[ORA 5",
        "[AND 5",
        "[AN. 5",
        "[EOR 5",
        "[eOr 5",
        "[opt0",
        "[EQUB 1",
        "[.LD89 LDA 1",
    ])("%s should not be red", text => {
        assert.deepStrictEqual(red(text), []);
    });
});

// Keys typed one at a time: the letters of an instruction that is still being typed are not red, and a digit or
// symbol straight after LD or ST is, as no letter of a register follows it.
describe("An instruction typed one key at a time", () => {
    it.each([["[LDA 1"], ["[STA &70"], ["[LDX 5,"], ["[TAX"], ["[INY"], ["[OPT0:CPX 1:]"]])(
        "%s typed one key at a time should never be red",
        text => {
            for (let n = 1; n <= text.length; ++n) {
                const typed = text.slice(0, n);
                assert.deepStrictEqual(
                    programProblems(readLines(typed, ModelBDialect)).filter(
                        problem => problem.stricter,
                    ),
                    [],
                    typed,
                );
                assert.deepStrictEqual(red(typed), [], typed);
            }
        },
    );
    it.each([["[L", "[LD", "[S", "[ST"]])(
        "%s, %s, %s and %s should be unfinished, not red",
        (...texts) => {
            for (const text of texts) {
                assert.deepStrictEqual(red(text), [], text);
                assert.deepStrictEqual(
                    programProblems(readLines(text, ModelBDialect)).map(problem => [
                        problem.unfinished,
                        problem.stricter,
                    ]),
                    [[true, false]],
                    text,
                );
            }
        },
    );
    it("should mark LD as soon as a digit follows it, since no letter of a register can come after", () => {
        assert.deepStrictEqual(red("[LD8"), ["LD"]);
    });
});

// BASIC ignores what follows a complete instruction up to the next colon, so the first thing there that is not a
// comment is red, and only that: the rest of the statement is ignored with it.
describe("Junk after a complete instruction", () => {
    const stricter = text =>
        programProblems(readLines(text, ModelBDialect)).filter(problem => problem.stricter);
    it.each([
        ["[OPT0:LDA #1 hello:]", "hello"],
        ["[OPT0:NOP 5 6:]", "5"],
        ["[OPT0:LDA #1 ,X:]", ","],
        ["[OPT0:NOP =1:]", "="],
        ["[OPT0:LDA #1 PRINT 2:]", "PRINT"],
        ["[OPT0:NOP]:NOP", "]"],
        ["[OPT0:LDA #1]]", "]"],
    ])("%s should be red on its first junk token only", (text, junk) => {
        assert.deepStrictEqual(red(text), [junk]);
    });
    it.each([
        "[OPT0:LDA #1 ;comment:]",
        "[OPT0:LDA #1 \\comment:]",
        "[OPT0:LDA #1:]:tax=1",
        "[OPT0:NOP:]:P%=P%+5",
        "[OPT0:LDA #1:LDX #2 ;c:NOP:]",
    ])("%s should not be red", text => {
        assert.deepStrictEqual(red(text), []);
    });
    it("should mark the second ] of NOP]:] as closing the block, not as junk", () => {
        assert.deepStrictEqual(red("[OPT0:NOP]:]:P%=P%+5"), ["]"]);
        assert.deepStrictEqual(stricter("[OPT0:NOP]:]:P%=P%+5").length, 1);
    });
    it.each([
        ["[OPT0:NOP]", "]", "BASIC ignores this ] and goes on assembling"],
        ["[OPT0:NOP 5", "5", "BASIC ignores everything after a complete instruction"],
    ])("%s should say what BASIC does and what was probably meant", (text, junk, begins) => {
        const [problem] = stricter(text);
        assert.strictEqual(text.slice(problem.start, problem.end), junk);
        assert.strictEqual(problem.code, "junk-after-instruction");
        assert.ok(problem.message.startsWith(begins), problem.message);
        assert.match(problem.message, junk === "]" ? /a : is missing/ : /a ; is missing/);
    });
    // BASIC tokenises a keyword only at the start of a word, so one straight after a mnemonic is a variable's name.
    it.each([
        ["[OPT0:STAH.,X:]", "H.", ".", "H. here is read as the variable H, not the keyword"],
        ["[OPT0:LDAUSR@%+GET:]", "USR@%", "@%", "USR here is read as the variable USR"],
        ["[OPT0:EQUBH.:]", "H.", ".", "H. here is read as the variable H"],
    ])(
        "%s should show %j as one problem, red on %j, that says a space was probably meant",
        (text, shown, junk, begins) => {
            const [problem] = stricter(text);
            assert.deepStrictEqual(red(text), [junk]);
            assert.strictEqual(text.slice(problem.start, problem.end), shown);
            assert.strictEqual(problem.code, "space-after-mnemonic");
            assert.ok(problem.message.startsWith(begins), problem.message);
            assert.match(problem.message, /follows (?:STA|LDA|EQUB) with no space/);
            assert.match(problem.message, /probably a space was meant after (?:STA|LDA|EQUB)$/);
        },
    );
    it.each([
        ["[OPT0:NOPPAGE:]", "PAGE"],
        ["[OPT0:INXH.:]", "H"],
        ["[OPT0:LDAP.,X:]", "."],
        ["[OPT0:LDAPRINT 5:]", "5"],
        ["[OPT0:LDAGETX 5:]", "5"],
    ])(
        "%s should still say a ; is probably missing, as a space would not mend it",
        (text, junk) => {
            const [problem] = stricter(text);
            assert.strictEqual(text.slice(problem.start, problem.end), junk);
            assert.strictEqual(problem.code, "junk-after-instruction");
        },
    );
    it("should leave the block open after a ] that is ignored, so the next line is assembled", () => {
        const [first, second] = programProblems(
            readLines("[LDA #1]\ntax=1\n]", ModelBDialect),
        ).filter(p => p.stricter);
        assert.deepStrictEqual([first.line, first.start], [1, 7]);
        assert.deepStrictEqual([second.line, second.start], [2, 3]);
    });
});

// What the grammar has for each keyword in the table: a statement rule, a value rule, or a place it is read inside
// another statement. A keyword added to a table without one of these fails here, instead of being read as anything.
describe.each([
    ["BASIC II", BasicIIDialect],
    ["BASIC IV", BasicIVDialect],
])("The grammar's rules for the keywords of %s", (_, dialect) => {
    const statements = dialect.keywords.filter(kw => canStartStatement(dialect, kw));
    const values = dialect.keywords.filter(kw => kw.flags & Flags.Expr);
    const problemCount = text => readLines(text, dialect)[0].problems.length;
    const spellings = rows => [...new Set(rows.map(kw => kw.keyword))].sort();

    // The statements read as far as their end of line with no rule: AUTO to SAVE are commands for the prompt, which
    // a program that runs into one stops at, DATA and REM are text, and ELSE ends the statement before it.
    const WithoutRule = [
        "AUTO",
        "DATA",
        "DELETE",
        "ELSE",
        "LIST",
        "LOAD",
        "REM",
        "RENUMBER",
        "SAVE",
    ];
    // The words that are neither a value nor a statement, each with text that BASIC reads it after.
    const ReadInsideStatement = {
        ERROR: "ON ",
        LINE: "INPUT ",
        OFF: "ON ERROR ",
        STEP: "FOR I=1 TO 2 ",
        SPC: "PRINT ",
        "TAB(": "PRINT ",
        THEN: "IF 1 ",
        TO: "FOR I=1 ",
    };
    // The operators between two values, which are read where one value follows another.
    const Infix = ["AND", "DIV", "EOR", "MOD", "OR"];

    it("should have a rule for every statement, bar those it deliberately skips", () => {
        // Any text after a statement with a rule is an error; one without a rule skips the rest of the line.
        const probe = kw => (kw === "DEF" ? "DEF FN )" : `${kw} )`);
        const skipped = statements.filter(kw => problemCount(probe(kw.keyword)) === 0);
        assert.deepStrictEqual(spellings(skipped), WithoutRule);
    });

    it("should read each statement, bare or with an operand, without an exception", () => {
        for (const {keyword} of statements)
            for (const operand of ["", " 1", " A$", " 1,2", ' "x"', " #1"])
                assert.doesNotThrow(() => readLines(keyword + operand, dialect), keyword + operand);
    });

    it("should read each value with a rule, bare or with its operand", () => {
        const operands = ["", " 1", "#1", "(1)", "(1,2)", "1,2)", "1,2,3)", " A$"];
        const unread = values.filter(
            kw =>
                !Infix.includes(kw.keyword) &&
                operands.every(operand => problemCount(`A=${kw.keyword}${operand}`) > 0),
        );
        assert.deepStrictEqual(spellings(unread), []);
        for (const keyword of Infix)
            assert.strictEqual(problemCount(`A=1 ${keyword} 2`), 0, keyword);
    });

    it("should make each keyword a value, a statement or a word read inside a statement", () => {
        const other = dialect.keywords.filter(
            kw => !(kw.flags & Flags.Expr) && !canStartStatement(dialect, kw),
        );
        assert.deepStrictEqual(spellings(other), Object.keys(ReadInsideStatement).sort());
        const both = values.filter(kw => canStartStatement(dialect, kw));
        assert.deepStrictEqual(spellings(both), dialect.basicIV ? ["EXT"] : []);
    });

    it("should look for each word read inside a statement where it is read", () => {
        for (const [keyword, before] of Object.entries(ReadInsideStatement)) {
            const reading = new ExpectingRecogniser(before, false, dialect);
            reading.line();
            assert(reading.words.has(keyword), `${keyword} after ${before}`);
        }
    });
});

describe("The spellings the grammar names", () => {
    const table = new Set(BasicIVDialect.keywords.map(kw => kw.keyword));
    const spellingsIn = {
        NoArgument: [...NoArgument],
        OneArgument: [...OneArgument],
        ChannelFunction: [...ChannelFunction],
        BracketFunction: Object.keys(BracketFunction),
        ExpressionCount: Object.keys(ExpressionCount),
        TextKeyword: [...TextKeyword],
    };

    it("should all be keywords of BASIC IV's table, which has BASIC II's", () => {
        for (const [name, spellings] of Object.entries(spellingsIn))
            assert.deepStrictEqual(
                spellings.filter(spelling => !table.has(spelling)),
                [],
                name,
            );
    });

    it("should have a statement rule only for a statement keyword", () => {
        const statements = new Set(
            BasicIVDialect.keywords
                .filter(kw => canStartStatement(BasicIVDialect, kw))
                .map(kw => kw.keyword),
        );
        const rules = Object.getOwnPropertyNames(Recogniser.prototype).filter(name =>
            /^[A-Z][A-Z$]*$/.test(name),
        );
        assert.deepStrictEqual(
            [...rules, ...spellingsIn.ExpressionCount].filter(name => !statements.has(name)),
            [],
        );
    });
});
