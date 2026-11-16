import {registerBbcBasicLanguage} from "../src/bbcbasic";
import {completionContext, completionItems} from "../src/completions";
import {readLines} from "../src/parser/highlight";
import {expandCode} from "../src/expand-code";
import Examples from "../src/examples.yaml";
import {generate} from "../tools/rom-oracle/generate.mjs";
import {immediateCommands, keywords} from "../src/tokens";
import {describe, expect, it} from "vitest";
import assert from "assert";
import {readFileSync} from "fs";
import {env} from "process";
import {editor} from "monaco-editor/editor/editor.api";

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
    readLines(program).forEach(({tokens}, lineIndex) => {
        const line = lines[lineIndex];
        if (tokens.some(isMachineCode)) return;
        for (const item of keywordTokens({tokens})) {
            if (!/^[A-Z]/.test(item.text)) continue;
            const typed = item.text.replace(/[.(]$/, "");
            const before = [...lines.slice(0, lineIndex), line.slice(0, item.start)].join("\n");
            // Once FN or PROC is typed in full a name follows it.
            const lengths = ["FN", "PROC"].includes(item.kw.keyword)
                ? typed.length - 1
                : typed.length;
            for (let length = 1; length <= lengths; length++) {
                const context = completionContext(before + typed.slice(0, length));
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
            ["PRINT A‸", ["AND", "ABS", "ACS", "ADVAL", "ASC", "ASN", "ATN"]],
            ["MOD‸", ["MODE"]],
            ["X=MOD‸", ["MOD"]],
            ["X=RN‸", ["RND"]],
            ["RN‸", []],
            ["TI‸", ["TIME"]],
            ["X=TI‸", ["TIME"]],
            ["X=INS‸", ["INSTR("]],
            // An E straight after a number starts a word: 7ELSE is 7 then ELSE.
            ["X=E‸", ["ELSE", "EOF", "EOR", "ERL", "ERR", "EVAL", "EXP", "EXT"]],
            ["X=7E‸", ["ELSE", "EOF", "EOR", "ERL", "ERR", "EVAL", "EXP", "EXT"]],
            ["GCOL0,7E‸", ["ELSE", "EOF", "EOR", "ERL", "ERR", "EVAL", "EXP", "EXT"]],
            ["X=1.5E‸", ["ELSE", "EOF", "EOR", "ERL", "ERR", "EVAL", "EXP", "EXT"]],
            ["PRINT 7EL‸", ["ELSE"]],
            [
                "IF0E‸",
                [
                    "ELSE",
                    "END",
                    "ENDPROC",
                    "ENVELOPE",
                    "EOF",
                    "EOR",
                    "ERL",
                    "ERR",
                    "EVAL",
                    "EXP",
                    "EXT",
                ],
            ],
            ["LIS‸", []],
            ["REPEAT PRI‸", ["PRINT"]],
            ["IFX THENPRI‸", ["PRINT"]],
            ["IFX THEN‸", ["THEN"]],
            ["IFX=1PRI‸", ["PRINT"]],
            ["IFX=1ELSEPRI‸", ["PRINT"]],
            ["ON ERROR PRI‸", ["PRINT"]],
            ["ON ERROR OF‸", ["OFF"]],
            ["ON X GOS‸", ["GOSUB"]],
            ["GOTO 10 A‸", ["AND", "ABS", "ACS", "ADVAL", "ASC", "ASN", "ATN"]],
            ["TRACE O‸", ["OFF", "ON", "OPENIN", "OPENOUT", "OPENUP", "OR"]],
            ["DEF PR‸", ["PRINT", "PROC"]],
            ["FORI=1T‸", ["TAN", "TIME", "TO", "TOP", "TRUE"]],
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
            // [text, offered, not offered]
            ["A=S‸", ["SQR", "STR$", "STRING$("], ["SPC", "STEP", "STOP", "SOUND"]],
            ["A=T‸", ["TAN", "TIME", "TOP", "TRUE"], ["TAB(", "TO", "THEN", "TRACE"]],
            ["PRINT T‸", ["TAB(", "TOP"], ["TO"]],
            ["[LDA #T‸", ["TOP"], ["TO"]],
            ["T‸", [], ["TOP"]],
            ["FOR I=1 T‸", ["TO"], []],
            ["PRINT S‸", ["SPC", "SQR"], ["STEP", "STOP"]],
            ["PRINT 1;T‸", ["TAB(", "TAN"], ["TO", "THEN"]],
            ["PRINT 1:A=S‸", ["SQR"], ["SPC"]],
            ["INPUT S‸", ["SPC"], ["STEP"]],
            ["INPUT L‸", ["LINE", "LEFT$(", "LEN"], ["LOCAL", "LIST"]],
            ["PRINT L‸", ["LEFT$(", "LEN"], ["LINE"]],
            ["IFX THENPRINT S‸", ["SPC"], ["STEP"]],
            ["FOR I=1 TO 10 S‸", ["STEP", "SQR"], ["SPC"]],
            ["FOR I=1 T‸", ["TO", "TAN"], ["THEN", "TAB("]],
            ["IFX FORI=1T‸", ["TO"], ["THEN"]],
            ["DEFPROCa(X)FORI=1T‸", ["TO"], ["THEN"]],
            ["FORI=1TO10ST‸", ["STEP", "STR$"], ["STOP"]],
            ["PRINT I T‸", ["TAN", "TAB("], ["TO", "THEN"]],
            ["IF X T‸", ["THEN", "TAN"], ["TO", "TAB("]],
            ["IF X THEN A=T‸", ["TAN"], ["THEN", "TO"]],
            ["PRINT X T‸", ["TAN"], ["THEN"]],
            ["ON ERROR O‸", ["OFF", "ON", "OSCLI"], ["OR", "OPENIN"]],
            ["ON ERROR OFF:O‸", ["ON", "OSCLI"], ["OFF", "OR", "OPENIN"]],
            ["ON ERROR PRINT O‸", ["OR"], ["OFF", "ON"]],
            ["TRACE O‸", ["OFF", "ON", "OR", "OPENIN"], ["OSCLI"]],
            ["TRACE ON:O‸", ["ON", "OSCLI"], ["OFF", "OR"]],
            ["A=O‸", ["OPENIN", "OR"], ["ON", "OFF", "OSCLI"]],
            ["PRINT X O‸", ["OR"], ["ON", "OFF"]],
            ["ON X G‸", ["GOTO", "GOSUB", "GET"], ["GCOL"]],
            ["ON X P‸", ["PI", "POS"], ["PRINT", "PLOT", "PROC"]],
            ["ON E‸", ["ERROR", "EOF"], []],
            ["A=E‸", ["EOF", "ERL", "ERR"], ["ERROR", "END", "ENVELOPE"]],
            ["ERR‸", [], ["ERROR", "ERL"]],
            ["IF X THEN ERR‸", [], ["ERROR"]],
            ["IF X ERR‸", [], ["ERROR"]],
            ["ON X GOTO 10 ELS‸", ["ELSE"], []],
            ["A=1 ELS‸", ["ELSE"], []],
            ["PRINT SPC 3:S‸", ["SOUND", "STOP"], ["SPC", "STEP", "SQR"]],
        ];
        for (const [text, shown, hidden] of cases) {
            const items = offered(text);
            for (const word of shown) assert(items.includes(word), `${text} offers ${word}`);
            for (const word of hidden) assert(!items.includes(word), `${text} hides ${word}`);
        }
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
        for (const recogniser of readLines(everyKeyword)) {
            for (const token of keywordTokens(recogniser)) used.add(token.kw.keyword);
        }
        const programKeywords = keywords
            .map(kw => kw.keyword)
            .filter(kw => !immediateCommands.includes(kw));
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
                    lead => lead + kw,
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
            [...hiddenKeywords(expandCode(text)), ...hiddenKeywords(text)].map(
                where => `${id} ${where}`,
            ),
        );
        assert.deepStrictEqual(hidden, []);
    });
});
