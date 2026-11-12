import {registerBbcBasicLanguage} from "../src/bbcbasic";
import {completionContext, completionItems, lineItems} from "../src/completions";
import {expandCode, immediateCommands, keywords} from "../src/tokens";
import {describe, it} from "vitest";
import assert from "assert";
import {readFileSync} from "fs";
import {env} from "process";
import {editor} from "monaco-editor/esm/vs/editor/editor.api";

registerBbcBasicLanguage();

const Cursor = "‸";

// The completions offered with the cursor at the "‸" that keep what has been typed of the word, as Monaco filters them.
function offered(textWithCursor) {
    const lines = textWithCursor.split("\n");
    const lineIndex = lines.findIndex(line => line.includes(Cursor));
    const position = {lineNumber: lineIndex + 1, column: lines[lineIndex].indexOf(Cursor) + 1};
    const model = editor.createModel(textWithCursor.replace(Cursor, ""), "BBCBASIC");
    try {
        return completionItems(model, position)
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

const isMachineCode = item =>
    !/string|comment/.test(item.type) && /[\u0100-\u011f]/.test(item.text);

// Types each keyword of the program one letter at a time where it stands, and returns the ones that a prefix of
// would not have offered, as "line: text typed". A line with a control character outside a string or comment is
// machine code that followed a newline byte in a REM or DATA, not BASIC.
function hiddenKeywords(program) {
    const lines = program.split("\n");
    const lineTokens = editor.tokenize(program, "BBCBASIC");
    const hidden = [];
    lines.forEach((line, lineIndex) => {
        const items = lineItems(line, lineTokens[lineIndex]);
        if (items.some(isMachineCode)) return;
        for (const item of items) {
            if (!item.kw || !/^[A-Z]/.test(item.text)) continue;
            const typed = item.text.replace(/[.(]$/, "");
            const before = [...lines.slice(0, lineIndex), line.slice(0, item.offset)].join("\n");
            // Once FN or PROC is typed in full a name follows it.
            const lengths = ["FN", "PROC"].includes(item.kw.keyword)
                ? typed.length - 1
                : typed.length;
            for (let length = 1; length <= lengths; length++) {
                const context = completionContext(before + typed.slice(0, length));
                const shown = context && context.labels && context.startColumn === item.offset + 1;
                if (!(shown && context.labels.includes(item.kw.keyword))) {
                    hidden.push(
                        `${lineIndex + 1}: ${line.slice(0, item.offset)}${typed.slice(0, length)}`,
                    );
                    break;
                }
            }
        }
    });
    return hidden;
}

describe("Completions", () => {
    it("should offer the keywords that can be typed where the cursor is", () => {
        const cases = [
            ["PRI‸", ["PRINT"]],
            ["pri‸", ["PRINT"]],
            ["10PRI‸", ["PRINT"]],
            ["10 PRI‸", ["PRINT"]],
            ["X=1:PRI‸", ["PRINT"]],
            ["X=PRI‸", []],
            ["PRINT A‸", ["AND", "ABS", "ACS", "ADVAL", "ASC", "ASN", "ATN"]],
            ["MOD‸", ["MODE"]],
            ["X=MOD‸", ["MOD"]],
            ["X=RN‸", ["RND"]],
            ["RN‸", []],
            ["TI‸", ["TIME"]],
            ["X=TI‸", ["TIME"]],
            ["X=INS‸", ["INSTR("]],
            ["LIS‸", []],
            ["REPEAT PRI‸", ["PRINT"]],
            ["IFX THENPRI‸", ["PRINT"]],
            ["IFX THEN‸", ["THEN"]],
            ["IFX=1PRI‸", ["PRINT"]],
            ["IFX=1ELSEPRI‸", ["PRINT"]],
            ["ON ERROR PRI‸", ["PRINT"]],
            ["ON ERROR OF‸", ["OFF"]],
            ["ON X GOS‸", ["GOSUB"]],
            ["TRACE O‸", ["OFF", "ON", "OPENIN", "OPENOUT", "OPENUP", "OR", "OSCLI"]],
            ["DEF PR‸", ["PRINT", "PROC"]],
            ["FORI=1T‸", ["TAN", "THEN", "TO", "TAB(", "TIME", "TRUE"]],
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
        everyKeyword.split("\n").forEach((line, i) => {
            for (const item of lineItems(line, editor.tokenize(everyKeyword, "BBCBASIC")[i])) {
                if (item.kw) used.add(item.kw.keyword);
            }
        });
        const programKeywords = keywords
            .map(kw => kw.keyword)
            .filter(kw => !immediateCommands.includes(kw));
        assert.deepStrictEqual(
            programKeywords.filter(kw => !used.has(kw)),
            [],
        );
        assert.deepStrictEqual(hiddenKeywords(everyKeyword), []);
    });

    // A file of saved programs, as a JSON array of {id, text}.
    const corpus = env.OWLET_CORPUS;
    it.runIf(corpus)("should not hide any keyword in the corpus of saved programs", () => {
        const hidden = JSON.parse(readFileSync(corpus, "utf8")).flatMap(({id, text}) =>
            [...hiddenKeywords(expandCode(text)), ...hiddenKeywords(text)].map(
                where => `${id} ${where}`,
            ),
        );
        assert.deepStrictEqual(hidden, []);
    });
});
