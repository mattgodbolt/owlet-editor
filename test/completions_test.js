import {registerBbcBasicLanguage} from "../src/bbcbasic";
import {completionContext, completionItems} from "../src/completions";
import {BasicIIDialect, BasicIVDialect, ModelBDialect} from "../src/parser/dialect";
import {readLines} from "../src/parser/highlight";
import {expandCode} from "../src/expand-code";
import Examples from "../src/examples.yaml";
import {generate} from "../tools/rom-oracle/generate.mjs";
import {keywords} from "../src/tokens";
import {describe, expect, it} from "vitest";
import assert from "assert";
import {readFileSync} from "fs";
import {env} from "process";
import {editor} from "monaco-editor/editor/editor.api";

registerBbcBasicLanguage(ModelBDialect);

const Cursor = "‸";

// The completions offered with the cursor at the "‸" that keep what has been typed of the word, as Monaco filters them.
function offered(textWithCursor, dialect = ModelBDialect) {
    const lines = textWithCursor.split("\n");
    const lineIndex = lines.findIndex(line => line.includes(Cursor));
    const position = {lineNumber: lineIndex + 1, column: lines[lineIndex].indexOf(Cursor) + 1};
    const model = editor.createModel(textWithCursor.replace(Cursor, ""), "BBCBASIC");
    try {
        return completionItems(model, position, dialect)
            .filter(item =>
                item.label
                    .toUpperCase()
                    .startsWith(model.getValueInRange(item.range).toUpperCase()),
            )
            .map(item => item.label)
            .sort();
    } finally {
        model.dispose();
    }
}

// A keyword where BASIC would stop (a lone LOG at the start of a line) is not somewhere to offer it.
const keywordTokens = recogniser =>
    recogniser.tokens.filter(token => token.kind === "keyword" && !token.invalid);

const isMachineCode = token =>
    !["string", "comment", "data", "oscli"].includes(token.kind) &&
    /[\u0100-\u011f]/.test(token.text);

// Types each keyword of the program one letter at a time where it stands, and returns the ones that a prefix of
// would not have offered, as "line: text typed". A line with a control character outside a string or comment is
// machine code that followed a newline byte in a REM or DATA, not BASIC.
function hiddenKeywords(program) {
    const lines = program.split("\n");
    const hidden = [];
    readLines(program, ModelBDialect).forEach(({tokens, problems}, lineIndex) => {
        const line = lines[lineIndex];
        if (tokens.some(isMachineCode)) return;
        // The generator mixes strings and numbers at random, and a keyword that would be a Type mismatch is hidden.
        if (problems.some(problem => problem.message?.startsWith("Type mismatch"))) return;
        for (const item of keywordTokens({tokens})) {
            if (!/^[A-Z]/.test(item.text)) continue;
            const typed = item.text.replace(/[.(]$/, "");
            const before = [...lines.slice(0, lineIndex), line.slice(0, item.start)].join("\n");
            // Once FN or PROC is typed in full a name follows it.
            const lengths = ["FN", "PROC"].includes(item.kw.keyword)
                ? typed.length - 1
                : typed.length;
            for (let length = 1; length <= lengths; length++) {
                const context = completionContext(before + typed.slice(0, length), ModelBDialect);
                const shown = context && context.labels && context.startColumn === item.start + 1;
                if (!(shown && context.labels.includes(item.kw.keyword))) {
                    hidden.push(
                        `${lineIndex + 1}: ${line.slice(0, item.start)}${typed.slice(0, length)}`,
                    );
                    break;
                }
            }
        }
    });
    return hidden;
}

describe("Completions", () => {
    it("should offer the same after COLOR as after COLOUR, and never COLOR itself", () => {
        for (const after of [" X‸", " 7:PRI‸", " 7:‸"]) {
            expect(offered(`COLOR${after}`)).toEqual(offered(`COLOUR${after}`));
        }
        expect(offered("COL‸")).not.toContain("COLOR");
        expect(offered("COLOR‸")).toEqual([]);
    });
    it("should offer the keywords that can be typed where the cursor is", () => {
        const cases = [
            ["PRI‸", ["PRINT"]],
            ["pri‸", ["PRINT"]],
            ["10PRI‸", ["PRINT"]],
            ["10 PRI‸", ["PRINT"]],
            ["X=1:PRI‸", ["PRINT"]],
            ["X=PRI‸", []],
            ["PRINT A‸", ["ABS", "ACS", "ADVAL", "ASC", "ASN", "ATN"]],
            ["MOD‸", ["MODE"]],
            ["X=MOD‸", []],
            ["X=RN‸", ["RND"]],
            ["RN‸", []],
            ["TI‸", ["TIME"]],
            ["X=TI‸", ["TIME"]],
            ["X=INS‸", ["INSTR("]],
            // An E straight after a number starts a word: 7ELSE is 7 then ELSE.
            ["X=E‸", ["EOF#", "ERL", "ERR", "EVAL", "EXP", "EXT#"]],
            ["X=7E‸", ["EOR"]],
            ["GCOL0,7E‸", ["EOR"]],
            ["X=1.5E‸", ["EOR"]],
            ["PRINT 7EL‸", []],
            ["IF X PRINT 7EL‸", ["ELSE"]],
            ["IF0E‸", ["ELSE", "END", "ENDPROC", "ENVELOPE", "EOR"]],
            ["LIS‸", []],
            ["REPEAT PRI‸", ["PRINT"]],
            ["IFX THENPRI‸", ["PRINT"]],
            ["IFX THEN‸", ["THEN"]],
            ["IFX=1PRI‸", ["PRINT"]],
            ["IFX=1ELSEPRI‸", ["PRINT"]],
            ["ON ERROR PRI‸", ["PRINT"]],
            ["ON ERROR OF‸", ["OFF"]],
            ["ON X GOS‸", ["GOSUB"]],
            ["GOTO 10 A‸", []],
            ["GOTO X A‸", ["AND"]],
            ["TRACE O‸", ["OFF", "ON", "OPENIN", "OPENOUT", "OPENUP"]],
            ["DEF PR‸", ["PROC"]],
            ["FORI=1T‸", ["TO"]],
            ["IFA%THE‸", ["THEN"]],
            ['PRINT"A"TA‸', ["TAN", "TAB("]],
            ["[OPT 0:LDA #AS‸", ["ASC", "ASN"]],
            ["[OPT 0\nLDA #0:ST‸", []],
            ["[OPT 0\n]:PRI‸", ["PRINT"]],
            ["[\n.loop ST‸", []],
            ["[\nLDA AS‸", ["ASC", "ASN"]],
        ];
        for (const [text, expected] of cases)
            assert.deepStrictEqual(offered(text), [...expected].sort(), text);
    });

    // Each word that is not a value is offered only in the statements BBC BASIC II reads it in (see StatementWords).
    it("should offer TOP, SPC, TAB(, LINE, TO, STEP, THEN, ON, OFF and ERROR only where the ROM reads them", () => {
        const cases = [
            // [text, every completion offered]
            ["A=S‸", ["SGN", "SIN", "SQR", "STR$", "STRING$("]],
            ["A=T‸", ["TAN", "TIME", "TOP", "TRUE"]],
            ["PRINT T‸", ["TAB(", "TAN", "TIME", "TOP", "TRUE"]],
            ["[LDA #T‸", ["TAN", "TIME", "TOP", "TRUE"]],
            ["T‸", ["TIME", "TRACE"]],
            ["FOR I=1 T‸", ["TO"]],
            ["FORI=1T‸", ["TO"]],
            ["FORI=1TO‸", ["TO"]],
            ["FORI=1+T‸", ["TAN", "TIME", "TOP", "TRUE"]],
            ["FORI=T‸", ["TAN", "TIME", "TOP", "TRUE"]],
            ["FORI=1TO10+T‸", ["TAN", "TIME", "TOP", "TRUE"]],
            ["FOR I=1 TO 2:X=T‸", ["TAN", "TIME", "TOP", "TRUE"]],
            ["PRINT S‸", ["SGN", "SIN", "SPC", "SQR", "STR$", "STRING$("]],
            ["PRINT 1;T‸", ["TAB(", "TAN", "TIME", "TOP", "TRUE"]],
            ["PRINT 1:A=S‸", ["SGN", "SIN", "SQR", "STR$", "STRING$("]],
            ["INPUT S‸", ["SPC"]],
            ["INPUT L‸", ["LINE"]],
            ["PRINT L‸", ["LEFT$(", "LEN", "LN", "LOG", "LOMEM"]],
            ["IFX THENPRINT S‸", ["SGN", "SIN", "SPC", "SQR", "STR$", "STRING$("]],
            ["FOR I=1 TO 10 S‸", ["STEP"]],
            ["IFX FORI=1T‸", ["TO"]],
            ["DEFPROCa(X)FORI=1T‸", ["TO"]],
            ["FORI=1TO10ST‸", ["STEP"]],
            ["PRINT I T‸", ["TAB(", "TAN", "TIME", "TOP", "TRUE"]],
            ["IF X T‸", ["THEN", "TRACE"]],
            ["IF X THEN A=T‸", ["TAN", "TIME", "TOP", "TRUE"]],
            ["PRINT X T‸", ["TAB(", "TAN", "TIME", "TOP", "TRUE"]],
            ["ON ERROR O‸", ["OFF", "ON", "OSCLI"]],
            ["ON ERROR OFF:O‸", ["ON", "OSCLI"]],
            ["ON ERROR PRINT O‸", ["OPENIN", "OPENOUT", "OPENUP"]],
            ["TRACE O‸", ["OFF", "ON", "OPENIN", "OPENOUT", "OPENUP"]],
            ["TRACE ON:O‸", ["ON", "OSCLI"]],
            ["A=O‸", ["OPENIN", "OPENOUT", "OPENUP"]],
            ["PRINT X O‸", ["OPENIN", "OPENOUT", "OPENUP", "OR"]],
            ["ON X G‸", ["GOSUB", "GOTO"]],
            ["ON X P‸", []],
            ["ON E‸", ["EOF#", "ERL", "ERR", "ERROR", "EVAL", "EXP", "EXT#"]],
            ["A=E‸", ["EOF#", "ERL", "ERR", "EVAL", "EXP", "EXT#"]],
            ["ERR‸", []],
            ["IF X THEN ERR‸", []],
            ["IF X ERR‸", []],
            ["ON X GOTO 10 ELS‸", ["ELSE"]],
            ["A=1 ELS‸", []],
            ["IF X THEN A=1 ELSE B=2 ELS‸", []],
            ["ON X GOTO 10,20 ELSE PRINT 3 ELS‸", []],
            ["ON ERROR PRINT 1 ELS‸", []],
            ["TRACE ON:PRINT 1 ELS‸", []],
            ["IF X THEN A=1 ELSE IF Y THEN B=2 ELS‸", ["ELSE"]],
            ["PRINT SPC 3:S‸", ["SOUND", "STOP"]],
        ];
        for (const [text, expected] of cases) assert.deepStrictEqual(offered(text), expected, text);
    });

    // BASIC raises Type mismatch when it runs a binary operator after a string (or a string function argument that
    // is a number), so the recogniser marks it and the word is dropped (#331).
    it("should not offer a word that would be a Type mismatch", () => {
        const cases = [
            // [text, every completion offered]
            ['PRINT"X"D‸', ["DEG"]],
            ['PRINT"X"M‸', ["MID$("]],
            ['PRINT"X"A‸', ["ABS", "ACS", "ADVAL", "ASC", "ASN", "ATN"]],
            ['PRINT"X"O‸', ["OPENIN", "OPENOUT", "OPENUP"]],
            ['PRINT"X"E‸', ["EOF#", "ERL", "ERR", "EVAL", "EXP", "EXT#"]],
            ["PRINT A$ D‸", ["DEG"]],
            ["PRINT(A$)A‸", ["ABS", "ACS", "ADVAL", "ASC", "ASN", "ATN"]],
            ['PRINT"X"+"Y"A‸', ["ABS", "ACS", "ADVAL", "ASC", "ASN", "ATN"]],
            ["PRINT LEFT$(A$,1)A‸", ["ABS", "ACS", "ADVAL", "ASC", "ASN", "ATN"]],
            ["PRINT 1D‸", ["DEG", "DIV"]],
            ["PRINT A%A‸", ["ABS", "ACS", "ADVAL", "AND", "ASC", "ASN", "ATN"]],
            ['PRINT LEN"X"A‸', ["ABS", "ACS", "ADVAL", "AND", "ASC", "ASN", "ATN"]],
            ["PRINT LEN G‸", ["GET$"]],
            ["PRINT ABS G‸", ["GET"]],
            ["PRINT X$(1)+A‸", ["ABS", "ACS", "ADVAL", "ASC", "ASN", "ATN"]],
            ["PRINT FNx D‸", ["DEG", "DIV"]],
        ];
        for (const [text, expected] of cases) assert.deepStrictEqual(offered(text), expected, text);
    });

    // What BASIC reads next is what the recogniser looks for where the text stops (#238, #260).
    it("should offer a word only where the recogniser looks for it", () => {
        const cases = [
            // [text, every completion offered]
            ["IF X X=0 T‸", []],
            ["IF X X=T‸", ["TAN", "TIME", "TOP", "TRUE"]],
            ["IF T‸", ["TAN", "TIME", "TOP", "TRUE"]],
            ["IF X PRINT 1 T‸", ["TAB(", "TAN", "TIME", "TOP", "TRUE"]],
            ["FOR T‸", []],
            ["FOR I=1 S‸", []],
            ["FOR I=1 TO 2 S‸", ["STEP"]],
            ["FOR I=1 TO 2 T‸", []],
            ["PRINT (1 T‸", []],
            ["INPUT LINE S‸", ["SPC"]],
            ["INPUT LINE L‸", []],
            ["ON X S‸", []],
            ["ON 1 E‸", ["EOR"]],
        ];
        for (const [text, expected] of cases) assert.deepStrictEqual(offered(text), expected, text);
    });

    // The cases of #320: the words BASIC would read next, tried one at a time on the current line.
    it("should offer only the keywords that keep the line valid (#320)", () => {
        const both = (text, expected) => [text, expected, expected];
        const cases = [
            // [text, offered on BASIC II, offered on BASIC IV]
            both("X=0 A‸", ["AND"]),
            both("X=0 D‸", ["DIV"]),
            both("X=0 M‸", ["MOD"]),
            both("X=0 O‸", ["OR"]),
            both("X=0 E‸", ["EOR"]),
            both("IF X X=0 E‸", ["ELSE", "EOR"]),
            both("X=0 T‸", []),
            both("IF X X=0 T‸", []),
            both("DEF F‸", ["FN"]),
            both("DEF P‸", ["PROC"]),
            both("DEF A‸", []),
            both("DEF X‸", []),
            both("FOR X = 0 TO 10 S‸", ["STEP"]),
            both("INPUT L‸", ["LINE"]),
            both("INPUT S‸", ["SPC"]),
            both("INPUT T‸", ["TAB("]),
            both("INPUT A‸", []),
            both("ON E‸", ["EOF#", "ERL", "ERR", "ERROR", "EVAL", "EXP", "EXT#"]),
            // An ELSE straight after the IF, or the ON, has no value before it (ojwb, #337).
            both("IF E‸", ["EOF#", "ERL", "ERR", "EVAL", "EXP", "EXT#"]),
            [
                "IF X E‸",
                ["ELSE", "END", "ENDPROC", "ENVELOPE", "EOR"],
                ["ELSE", "END", "ENDPROC", "ENVELOPE", "EOR", "EXT#"],
            ],
            [
                "IF X THEN E‸",
                ["ELSE", "END", "ENDPROC", "ENVELOPE"],
                ["ELSE", "END", "ENDPROC", "ENVELOPE", "EXT#"],
            ],
            both("IF X PRINT 1 E‸", ["ELSE", "EOF#", "EOR", "ERL", "ERR", "EVAL", "EXP", "EXT#"]),
            both("ON X GOTO 10 E‸", ["ELSE", "EOF#", "EOR", "ERL", "ERR", "EVAL", "EXP", "EXT#"]),
            both("IF T‸", ["TAN", "TIME", "TOP", "TRUE"]),
            both("ON X G‸", ["GOSUB", "GOTO"]),
            ["ON X P‸", [], ["PROC"]],
            // No binary operator starts an expression or a subexpression.
            both("X = A‸", ["ABS", "ACS", "ADVAL", "ASC", "ASN", "ATN"]),
            both("PRINT A‸", ["ABS", "ACS", "ADVAL", "ASC", "ASN", "ATN"]),
            both("IF A‸", ["ABS", "ACS", "ADVAL", "ASC", "ASN", "ATN"]),
            both("IF X OR A‸", ["ABS", "ACS", "ADVAL", "ASC", "ASN", "ATN"]),
            both("X = (A‸", ["ABS", "ACS", "ADVAL", "ASC", "ASN", "ATN"]),
            both("X = 1 + D‸", ["DEG"]),
            // The same in inline assembly.
            both("[LDA #A‸", ["ABS", "ACS", "ADVAL", "ASC", "ASN", "ATN"]),
            both("[LDA #0 A‸", ["AND"]),
            both("[\nLDA #0 O‸", ["OR"]),
            both("[OPT 0:LDA #0 T‸", []),
            // The text before the word being wrong tells us nothing, so nothing is dropped.
            both("PRINT ) A‸", ["ABS", "ACS", "ADVAL", "AND", "ASC", "ASN", "ATN"]),
        ];
        for (const [text, basicII, basicIV] of cases) {
            assert.deepStrictEqual(offered(text, BasicIIDialect), basicII, `BASIC II: ${text}`);
            assert.deepStrictEqual(offered(text, BasicIVDialect), basicIV, `BASIC IV: ${text}`);
        }
    });

    // ojwb, #339: a keyword that BASIC stops at with "Missing #" without one (BGET, BPUT, CLOSE, EOF, EXT and PTR on both
    // BASIC II and the Master) is offered with it, unless one follows already.
    it("should offer the keywords that need a # with the # (#339)", () => {
        const cases = [
            // [text, offered]
            ["X=B‸", ["BGET#"]],
            ["X=BG‸", ["BGET#"]],
            ["X=BGET‸", ["BGET#"]],
            ["X=BGET‸#H", ["BGET"]],
            ["X=BGET‸ #H", ["BGET"]],
            ["BP‸", ["BPUT#"]],
            ["BPUT‸", ["BPUT#"]],
            ["CLO‸", ["CLOSE#"]],
            ["CLOSE‸#0", ["CLOSE"]],
            ["X=EO‸", ["EOF#"]],
            ["X=EXT‸", ["EXT#"]],
            ["X=PT‸", ["PTR#"]],
            ["PT‸", ["PTR#"]],
            ["PTR‸", ["PTR#"]],
            ["PRINT BG‸", ["BGET#"]],
            ["PRINT PTR‸", ["PTR#"]],
            ["PRIN‸", ["PRINT"]],
            ["INPU‸", ["INPUT"]],
        ];
        // EXT is also a statement on BASIC IV (EXT#F=1), where it is offered with its # at the start of a statement.
        const statements = [
            // [text, offered on BASIC II, offered on BASIC IV]
            ["EXT‸", [], ["EXT#"]],
            ["EX‸", [], ["EXT#"]],
            ["EXT‸#F=1", [], ["EXT"]],
            ["X=1:EXT‸", [], ["EXT#"]],
            ["EXT#F=1:EXT‸", [], ["EXT#"]],
            ["IF X EXT‸", [], ["EXT#"]],
            ["IF X THEN EX‸", [], ["EXT#"]],
        ];
        for (const [text, expected] of cases) {
            assert.deepStrictEqual(offered(text, BasicIIDialect), expected, `BASIC II: ${text}`);
            assert.deepStrictEqual(offered(text, BasicIVDialect), expected, `BASIC IV: ${text}`);
        }
        for (const [text, basicII, basicIV] of statements) {
            assert.deepStrictEqual(offered(text, BasicIIDialect), basicII, `BASIC II: ${text}`);
            assert.deepStrictEqual(offered(text, BasicIVDialect), basicIV, `BASIC IV: ${text}`);
        }
    });

    // ojwb, #323: an ELSE after the IF's own ELSE is junk, so it is not offered.
    it("should offer ELSE only while an IF or ON is waiting for one", () => {
        const cases = [
            // [text, ELSE offered]
            ['IFX%=Y%PRINT"YES"ELSEPRINT"NO"E‸', false],
            ['IFX%=Y%THENPRINT"YES"ELSEPRINT"NO"E‸', false],
            ["IFX%=Y%PRINT 1 ELSEPRINT X E‸", false],
            ["IFA IFB PRINT 1 ELSE PRINT 2 E‸", false],
            ["IF X THEN IF Y THEN PRINT 1 ELSE PRINT 2 E‸", false],
            ["IF X THEN A=1 ELSE IF Y THEN B=2 ELSE B=3 E‸", false],
            ["IF X THEN A=1 ELSE IF Y THEN B=2 ELSE E‸", false],
            ["IF X THEN A=1 ELSE IF Y THEN B=2 ELSE B=3:E‸", false],
            ["IF X THEN A=1 ELSE IF Y THEN B=2 E‸", true],
            ["IF X PRINT 1 E‸", true],
            ['IFX%=Y%PRINT"YES"E‸', true],
            ["ON X GOTO 10 E‸", true],
        ];
        for (const [text, shown] of cases)
            for (const [name, dialect] of [
                ["II", BasicIIDialect],
                ["IV", BasicIVDialect],
            ])
                expect(offered(text, dialect).includes("ELSE"), `BASIC ${name}: ${text}`).toBe(
                    shown,
                );
    });

    it("should not offer THEN after the EXT# statement that follows IF on BASIC IV", () => {
        const {labels} = completionContext("IF X EXT#F=1 ", BasicIVDialect);
        assert(!labels.includes("THEN"));
    });

    it("should offer nothing where no keyword can be typed", () => {
        const cases = [
            'PRINT "PRI‸',
            'PRINT "PRI‸"',
            "REM PRI‸",
            "REM ‸",
            'PRINT "A ‸',
            "*FX ‸",
            "DATA PRI‸",
            "DATA 1,‸",
            "*PRI‸",
            "X=&F‸",
            "X=&‸",
            "X=&G‸",
            "X=1‸",
            "10‸",
            "[\nLDA‸",
            "[\nLDA #0 \\ PRI‸",
        ];
        for (const text of cases) assert.deepStrictEqual(offered(text), [], text);
    });

    it("should offer the program's own FN and PROC names after FN and PROC", () => {
        const cases = [
            ["DEFPROCabc\nPROCa‸", ["abc"]],
            ["DEFPROCabc\nPROC‸", ["abc"]],
            ["DEFPROCabc:PROCa‸", ["abc"]],
            ["PROCa‸\nDEF PROCabc", ["abc"]],
            ["PROCdraw\nPROCd‸", ["draw"]],
            ["DEFFNabc\nX=FNa‸", ["abc"]],
            ["DEFPROCsomeproc\nX=FNsome‸", []],
            ["DEFFNsomefn\nPROCsome‸", []],
            ["DEFPROCabc\nDEFPROCa‸", []],
            ["PROCabc\nDEF PROCa‸", []],
            ["DEFFNabc\nDEF FNa‸", []],
            ["DEFPROCabc\nPRO.a‸", ["abc"]],
            ["DEFPROCab\nPROCab‸", ["ab"]],
        ];
        for (const [text, expected] of cases)
            assert.deepStrictEqual(offered(text), [...expected].sort(), text);
    });

    // Lines between them using every keyword a program can use, each where BASIC II reads it.
    const everyKeyword = [
        "10MODE 1:CLS:CLG:COLOUR 1:GCOL 0,1:VDU 23,1,0;0;0;0;:WIDTH 0",
        "20ON ERROR REPORT:PRINT ERL,ERR:END",
        "30ON ERROR OFF:TRACE ON:TRACE OFF:TRACE 100",
        "40DIM A%(10):LET Y=ABS ACS ASN ATN COS DEG EXP INT LN LOG RAD SGN SIN SQR TAN 1",
        '50X=PI*RND(1) DIV 2 MOD 3 AND NOT TRUE OR FALSE EOR 1:Y=USR 0+EVAL "1"+VAL "2"+LEN "3"+ASC "4"',
        '60A$=CHR$ 65+GET$+INKEY$ 0+LEFT$("A",1)+MID$("A",1)+RIGHT$("A",1)+STR$ 1+STRING$(2,"A")',
        '70B=INSTR("A","A")+GET+INKEY 0+ADVAL 0+POINT(0,0)+POS+VPOS+COUNT',
        "80FOR I=1 TO 10 STEP 2:NEXT:REPEAT UNTIL TRUE",
        "90IF X THEN PRINT TAB(1);SPC 2 ELSE PRINT",
        "100IF X PRINT ELSE GOTO 10",
        "110ON X GOTO 10,20 ELSE GOSUB 30",
        '120INPUT LINE A$:INPUT "X",X:READ X:RESTORE:DATA 1,2',
        "130DEF PROCa(X):LOCAL Y:ENDPROC",
        "140DEF FNb=1",
        "150PROCa(FNb)",
        '160C%=OPENIN "F":D%=OPENOUT "F":E%=OPENUP "F":BPUT#C%,BGET#D%:PTR#C%=EXT#C%+PTR#D%:CLOSE#C%:IF EOF#C% STOP',
        "170PAGE=&1900:TIME=0:LOMEM=HIMEM:HIMEM=LOMEM:X=PAGE+TIME",
        "180MOVE 0,0:DRAW 1,1:PLOT 85,1,1:SOUND 1,-15,1,1:ENVELOPE 1,1,1,1,1,1,1,1,1,1,1,1,1,1",
        '190CALL &FFEE:CHAIN "X":RUN:CLEAR:OSCLI "FX":RETURN',
        "200REM done",
        '210[OPT 0:.loop LDA #ASC "A":EQUS STR$ 1:]',
    ].join("\n");

    it("should not hide any keyword where it is used", () => {
        const used = new Set();
        for (const recogniser of readLines(everyKeyword, ModelBDialect)) {
            for (const token of keywordTokens(recogniser)) used.add(token.kw.keyword);
        }
        const programKeywords = keywords
            .map(kw => kw.keyword)
            .filter(kw => !ModelBDialect.immediateCommands.includes(kw));
        assert.deepStrictEqual(
            programKeywords.filter(kw => !used.has(kw)),
            [],
        );
        assert.deepStrictEqual(hiddenKeywords(everyKeyword), []);
    });

    // Programs of our own: the bundled examples, the oracle generator's random statements with a fixed seed (not its
    // exhaustive probes or assembler, which are not what a person types), and every keyword that starts with E run
    // into the end of a number (7ELSE reads as 7 then ELSE).
    const ownPrograms = () => {
        const chunk = (lines, size) =>
            Array.from({length: Math.ceil(lines.length / size)}, (_, i) =>
                lines.slice(i * size, (i + 1) * size).join("\n"),
            );
        const afterNumber = keywords
            .map(kw => kw.keyword)
            .filter(kw => kw.startsWith("E"))
            .flatMap(kw =>
                ["X=7", "GCOL0,7", "A=16", "IF0", "X=1.5", "?s=12", "PRINT .5"].map(
                    // ELSE is only read after an IF or ON.
                    lead =>
                        (kw === "ELSE" && !lead.startsWith("IF") ? "IF X THEN " : "") + lead + kw,
                ),
            );
        return [
            ...Examples.examples.map(({basic}) => basic).filter(Boolean),
            ...chunk(
                generate({seed: 1, count: 1500})
                    .slice(generate({count: 0}).length)
                    .filter(({shape}) => !shape.startsWith("assembler"))
                    .map(({text}) => text),
                100,
            ),
            afterNumber.join("\n"),
        ];
    };

    it("should not hide any keyword in our own programs", () => {
        const hidden = ownPrograms().flatMap((text, i) =>
            hiddenKeywords(text).map(where => `program ${i} ${where}`),
        );
        assert.deepStrictEqual(hidden, []);
    });

    // A file of saved programs as a JSON array of {id, text}, for a corpus that cannot be checked in:
    // OWLET_CORPUS=programs.json npx vitest run test/completions_test.js
    const corpus = env.OWLET_CORPUS;
    it.runIf(corpus)("should not hide any keyword in the corpus of saved programs", () => {
        const hidden = JSON.parse(readFileSync(corpus, "utf8")).flatMap(({id, text}) =>
            [...hiddenKeywords(expandCode(text, ModelBDialect)), ...hiddenKeywords(text)].map(
                where => `${id} ${where}`,
            ),
        );
        assert.deepStrictEqual(hidden, []);
    });
});
