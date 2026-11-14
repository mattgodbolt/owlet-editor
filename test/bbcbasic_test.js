import {
    codeActionProvider,
    getWarnings,
    LanguageId,
    registerBbcBasicLanguage,
    tokenChar,
} from "../src/bbcbasic";
import {keywords} from "../src/tokens";
import {describe, it} from "vitest";
import assert from "assert";
import {editor, MarkerSeverity} from "monaco-editor/esm/vs/editor/editor.api";

registerBbcBasicLanguage();

// Each line's tokens, as "offset:type" separated by spaces.
function tokens(text) {
    return editor
        .tokenize(text, LanguageId)
        .map(line =>
            line.map(t => `${t.offset}:${t.type.replace(`.${LanguageId}`, "")}`).join(" "),
        );
}

// The source text of each token of the given type, on every line.
function spans(text, type) {
    const lines = text.split("\n");
    return editor
        .tokenize(text, LanguageId)
        .flatMap((line, l) =>
            line.flatMap((t, i) =>
                t.type === `${type}.${LanguageId}`
                    ? [
                          lines[l].slice(
                              t.offset,
                              i + 1 < line.length ? line[i + 1].offset : undefined,
                          ),
                      ]
                    : [],
            ),
        );
}

// Each bracket Monaco finds, as [column, isUnmatched].
function brackets(text) {
    const model = editor.createModel(text, LanguageId);
    try {
        model.tokenization.forceTokenization(model.getLineCount());
        return model.bracketPairs
            .getBracketsInRange(model.getFullModelRange())
            .toArray()
            .map(b => [b.range.startColumn, b.isInvalid]);
    } finally {
        model.dispose();
    }
}

const unmatched = text => brackets(text).flatMap(([column, invalid]) => (invalid ? [column] : []));

const openers = keywords.filter(kw => kw.keyword.endsWith("(")).map(tokenChar);

function checkWarnings(text, ...expected) {
    assert.deepStrictEqual(
        getWarnings(text),
        expected.map(x => ({
            severity: MarkerSeverity.Warning,
            ...x,
            startLineNumber: 1,
            endLineNumber: 1,
        })),
        text,
    );
}

const caseWarning = (keyword, startColumn) => ({
    message: `BASIC keywords should be upper case, did you mean ${keyword}?`,
    startColumn,
    endColumn: startColumn + keyword.length,
});

describe("Tokenisation", () => {
    describe("keywords and names", () => {
        it("should read keywords, abbreviations and tokens that abut each other as keywords", () => {
            for (const text of [
                "PRINT",
                "CALL",
                "RESTORE",
                "PRINTLEN",
                "P.LEN",
                "P.",
                "C.",
                "R.",
                "TIME",
            ])
                assert.deepStrictEqual(tokens(text), ["0:keyword"], text);
            assert.deepStrictEqual(tokens("PRINTA$"), ["0:keyword 5:variable"]);
            assert.deepStrictEqual(tokens("IFVALA$PRINTA$.1"), [
                "0:keyword 5:variable 7:keyword 12:variable 14:number.float",
            ]);
            assert.deepStrictEqual(tokens("TIME r"), ["0:keyword 4:white 5:variable"]);
        });
        it("should read names with a type suffix", () => {
            for (const text of ["A%", "X%", "LONGVAR%", "@%", "LDA"])
                assert.deepStrictEqual(tokens(text), ["0:variable"], text);
            assert.deepStrictEqual(tokens("N=1"), ["0:variable 1:operator 2:number"]);
            assert.deepStrictEqual(tokens("N%=1"), ["0:variable 2:operator 3:number"]);
            assert.deepStrictEqual(tokens("N$ = 1"), [
                "0:variable 2:white 3:operator 4:white 5:number",
            ]);
        });
        it("should allow $ in abbreviated tokens, but only before a literal dot", () => {
            assert.deepStrictEqual(tokens('P.STRING$.2,"HO")'), [
                "0:keyword 10:number 11:operator 12:string.quote 13:string 15:string.quote 16:delimiter.parenthesis",
            ]);
            for (const text of ["A$=LEFT$A$", "A$=MID$X"])
                assert.deepStrictEqual(spans(text, "keyword"), [], text);
        });
        it("should not treat BG as an abbreviation without the dot", () => {
            // BGET abbreviates to B., BG. and BGE. but plain BG is just a variable.
            for (const text of ["BG=1", "BG%=2", 'BG$=""'])
                assert.deepStrictEqual(spans(text, "keyword"), [], text);
            assert.deepStrictEqual(spans("A=BG.#1", "keyword"), ["BG."]);
            assert.deepStrictEqual(spans("A=BG.#1", "symbol"), ["#"]);
        });
        it("should not read a conditional keyword, or its abbreviation, before a letter or digit", () => {
            assert.deepStrictEqual(tokens("TIMER"), ["0:variable"]);
            // See #36. An abbreviation stands for the first keyword in the table with that prefix (B. is BGET, R. is
            // RETURN), so it is conditional if that keyword is, whatever later keywords share the prefix. BASIC reads
            // _ as a letter here.
            const names =
                "H.TO H._ TI._X B.X BG.X BP.X CLO.X EO.X PT.X E.X EN.X ER.X O.X R.X RE.X".split(
                    " ",
                );
            for (const text of names) assert.deepStrictEqual(spans(text, "invalid"), [text], text);
            for (const text of ["A=B. #X", "R.:", "RE.", "P.X", "I.X", "F.X", "D.X", "REP.X"])
                assert.deepStrictEqual(spans(text, "invalid"), [], text);
        });
        it("should read a keyword and a dot as the abbreviation of an earlier keyword it begins", () => {
            // END. is ENDPROC, MOD. is MODE and so on, since those come first in the table.
            for (const text of ["END.", "ON ERR.", "A=GET.", "A=INKEY.5", "A=8MOD.3"])
                assert.deepStrictEqual(
                    spans(text, "keyword").slice(-1),
                    [text.match(/[A-Z]+\./)[0]],
                    text,
                );
            assert.deepStrictEqual(spans("END.X", "invalid"), ["END.X"]);
            assert.deepStrictEqual(spans("A=8MOD 3", "keyword"), ["MOD"]);
        });
        it("should allow FN and PROC names starting with a digit", () => {
            assert.deepStrictEqual(tokens("DEFFN3D PROC1to1:PRO.2too:=FN42"), [
                "0:keyword 5:variable 7:white 8:keyword 12:variable 16:symbol 17:keyword 21:variable 25:symbol 26:operator 27:keyword 29:variable",
            ]);
        });
        it("should highlight a keyword that cannot start a statement", () => {
            // See #151, checked on the ROM, where each invalid case is a syntax error.
            const cases = [
                ['ERROR5,"x"', ["ERROR"]],
                ["RND(-TIME)", ["RND"]],
                ["STEP1", ["STEP"]],
                ["TOOMUCH=1", ["TO"]],
                ["A=1:ABS A", ["ABS"]],
                ["IF A THEN TO", ["TO"]],
                ["IF 0 THEN 10 ELSE FNf", ["FN"]],
                ["A.", ["A."]],
                ["10 THEN", ["THEN"]],
                ["\u0185", ["\u0185"]],
                // PTR, PAGE and TIME as functions (tokens &8F, &90, &91) cannot start a statement, their statement
                // forms can.
                ["\u018f#0=1", ["\u018f#"]],
                ["\u0190=1", ["\u0190"]],
                ["\xcf#0=1", []],
                ["\xd0=1", []],
                ["ON ERROR OFF", []],
                ['ON ERROR PRINT "x"', []],
                ["TIME=0", []],
                ["PTR#0=0:HIMEM=HIMEM", []],
                ["ELSE", []],
                ["IF 1 THEN ELSE", []],
                ["RNDX=1", []],
                ["MODE 7", []],
            ];
            for (const [text, invalid] of cases)
                assert.deepStrictEqual(spans(text, "invalid"), invalid, text);
        });
    });

    describe("numbers", () => {
        it("should read integers, decimals and exponents", () => {
            const floats = [
                "123.450",
                "1.",
                ".5",
                ".",
                "123.450E-1",
                "2E4",
                "9E+",
                "9E-",
                "9.E+",
                ".9E-",
                ".E-",
            ];
            // After A= so as not to be a line number.
            for (const [text, type] of [
                ["123450", "number"],
                ...floats.map(n => [n, "number.float"]),
            ])
                assert.deepStrictEqual(
                    tokens(`A=${text}`),
                    [`0:variable 1:operator 2:${type}`],
                    text,
                );
            // See #26.
            assert.deepStrictEqual(tokens("FORJ%=2E4TO22400STEP100"), [
                "0:keyword 3:variable 5:operator 6:number.float 9:keyword 11:number 16:keyword 20:number",
            ]);
            assert.deepStrictEqual(tokens("P.$.114338E6"), ["0:keyword 2:operator 3:number.float"]);
        });
        it("should read a dot after a value as a number only where one value can follow another", () => {
            // See #85, #149, #150 and #162, checked on the ROM: PRINT, VDU and INPUT take one value directly after
            // another, so P.X. prints X and then 0, but Y=X.7 is a syntax error and Z. is a Mistake. A number may end
            // in an empty exponent, as 1E does.
            assert.deepStrictEqual(tokens("P.X.\nY=X.7\nPRIT."), [
                "0:keyword 2:variable 3:number.float",
                "0:variable 1:operator 2:variable 3:invalid",
                "0:variable 4:invalid",
            ]);
            const cases = [
                ["PRINT X.7", []],
                ["V.X.", []],
                ["VDU X.7,1", []],
                ["INPUT X.", ["."]],
                ["I.X.7", [".7"]],
                ["A=BGET##1", ["#"]],
                ['PRINT "a".5', []],
                ["PRINT STR$(1);.5", []],
                ["VDU1,2.5", []],
                ["IF 0 THEN P.X. ELSE P.Y.", []],
                ["X=Y.5", [".5"]],
                ["Z.", ["."]],
                ["X%=X%.5", [".5"]],
                ["x=x.5", [".5"]],
                ["FOR I=1 TO X.", ["."]],
                ["FOR I=X. TOP", ["."]],
                ["A=X. TO", ["."]],
                ["IF X. THEN PRINT", ["."]],
                ["COLOUR X.", ["."]],
                ["PRINT#X.,1", ["."]],
                ["INPUT#X.,Y", ["."]],
                ["P.X.:Y=X.", ["."]],
                ["PRINT 1E.5", []],
                ["VDU 1E.5", []],
                ["P.1E.X", []],
                ["PRINT 1.5E.5 +1", []],
                ["PRINT 5.E.5:", []],
                ["PRINT 1E.5ERL", []],
                ["PRINT 1E+.5", []],
                ["PRINT 1E .5", []],
            ];
            for (const [text, invalid] of cases)
                assert.deepStrictEqual(spans(text, "invalid"), invalid, text);
        });
    });

    describe("TOP and ~", () => {
        it("should treat TO followed by P as the single keyword TOP", () => {
            assert.deepStrictEqual(spans("PRINT TOP", "keyword"), ["PRINT", "TOP"]);
            assert.deepStrictEqual(spans("PRINT TOP", "variable"), []);
            assert.deepStrictEqual(spans("A=TOP+1", "keyword"), ["TOP"]);
            assert.deepStrictEqual(spans("X=TOP-PAGE", "keyword"), ["TOP", "PAGE"]);
            assert.deepStrictEqual(spans("[LDA #TOP MOD 256", "keyword"), ["LDA", "TOP", "MOD"]);
            assert.deepStrictEqual(spans("[LDA #TOP MOD 256", "invalid"), []);
        });
        it("should read TO P in a FOR statement as the loop's TO unless an operand is expected", () => {
            // Each case's variables, then its keywords if they are not just FOR, TOP and TO.
            const cases = [
                // The first TOP is the function, the second is TO then the variable P.
                ["F.P=TOP TOP:P.P:N.", ["P", "P", "P"], ["F.", "TOP", "TO", "P.", "N."]],
                ["FOR I=1 TO P", ["I", "P"], ["FOR", "TO"]],
                ["FOR I=1TOP", ["I", "P"], ["FOR", "TO"]],
                ["FOR I=(TOP) TO TOP+1", ["I"], ["FOR", "TOP", "TO", "TOP"]],
                ["FOR I=A+TOP TO P STEP 2", ["I", "A", "P"], ["FOR", "TOP", "TO", "STEP"]],
                // The FOR statement ends at a colon.
                ["FOR I=1 TO 2:PRINT TOP", ["I"], ["FOR", "TO", "PRINT", "TOP"]],
                // After a keyword that takes an operand, TOP is still the function.
                ["FOR I=ABS TOP TO TOP", ["I"], ["FOR", "ABS", "TOP", "TO", "TOP"]],
                ["FOR I=AB. TOP TO TOP", ["I"], ["FOR", "AB.", "TOP", "TO", "TOP"]],
                ["FOR I=AB.TOP TO TOP", ["I"]],
                ["FOR I=XY.TOP", ["I", "XY", "P"]],
                ["FOR I=1 AND TOP TO 2", ["I"], ["FOR", "AND", "TOP", "TO"]],
                // Abbreviated and raw token forms, checked against the ROM by running them.
                ["FO.I=TOP TO TOP+1", ["I"], ["FO.", "TOP", "TO", "TOP"]],
                ["\xe3I=\xb8P \xb8 \xb8P+1", ["I"], ["\xe3", "\xb8P", "\xb8", "\xb8P"]],
                ["\xe3P=\xb8P \xb8P:\xf1P", ["P", "P", "P"]],
                ["\xe3I=\u0194\xb8P \xb8 \xb8P", ["I"]],
            ];
            for (const [text, variables, keywordSpans] of cases) {
                assert.deepStrictEqual(spans(text, "variable"), variables, text);
                if (keywordSpans)
                    assert.deepStrictEqual(spans(text, "keyword"), keywordSpans, text);
            }
        });
        it("should only allow ~ in PRINT items and after STR$", () => {
            const valid = [
                ["PRINT ~A", 1],
                ["PRINT ~A,~B", 2],
                ["PRINT A;~B", 1],
                ["PRINT'~A", 1],
                ["P.~A", 1],
                ['PRINT "x"~A', 1],
                ["PRINT A$+STR$~A", 1],
                ["PRINT STR$ ~A", 1],
                ["A$=STR$~(A)", 1],
                ["A$=STR.~A", 1],
                ["IF A THEN PRINT ~A ELSE PRINT ~B", 2],
                ["P.STR.~255", 1],
                ["\xf1\xc3~255", 1],
                ["A$=\xc3~255", 1],
                ["PRINT ~TOP-TOP", 1],
                ["P.~~42", 2],
                ["P.~~~42", 3],
                ["P.STR$~42", 1],
            ];
            for (const [text, count] of valid) {
                assert.deepStrictEqual(spans(text, "invalid"), [], text);
                assert.strictEqual(
                    spans(text, "operator").join("").split("~").length - 1,
                    count,
                    text,
                );
            }
            const invalid = [
                "A=~B",
                "A$=STR$(~12)",
                "A$=\xc3(~1)",
                "PRINT#0,~A",
                "INPUT ~A",
                "VDU ~A",
                "PRINT 1+~A",
                "PRINT (~A)",
                "PRINT TAB(~A)",
                "PRINT ~A:B=~A",
                "PRINT !~A",
                "PRINT ?~A",
                "PRINT ;-~B",
                "PRINT A AND ~B",
                "PRINT A MOD~B",
                "~",
                // See #152: STR$ takes one ~, though PRINT takes any number.
                "P.STR$~~42",
                "A$=STR$~~42",
                "P.STR.~~42",
            ];
            for (const text of invalid) assert.deepStrictEqual(spans(text, "invalid"), ["~"], text);
        });
    });

    describe("statements", () => {
        it("should read the rest of the line after REM as a comment", () => {
            for (const text of [
                "REM a comment with PRINT in it",
                "REM a comment:PRINT",
                "REMthis too",
            ])
                assert.deepStrictEqual(tokens(text), ["0:keyword 3:comment"], text);
            assert.deepStrictEqual(tokens("REM\nPRINT"), ["0:keyword", "0:keyword"]);
        });
        it("should suitably highlight DATA statements", () => {
            const lines = [
                "DATA",
                "D.a b,c",
                "DA.,,,7,",
                "DAT.PI,COS0,SQRLN@%",
                'DATA3 ,"comma,quoted", "esc""ape", qu"te,q", 3x',
            ];
            assert.deepStrictEqual(tokens(lines.join("\n")), [
                "0:keyword",
                "0:keyword 2:string.unquoted 5:symbol 6:string.unquoted",
                "0:keyword 3:symbol 6:string.unquoted 7:symbol",
                "0:keyword 4:string.unquoted 6:symbol 7:string.unquoted 11:symbol 12:string.unquoted",
                "0:keyword 4:string.unquoted 5:white 6:symbol 7:string.quote 8:string 20:string.quote 21:symbol 22:white 23:string.quote 24:string 27:string.quote 29:string 32:string.quote 33:symbol 34:white 35:string.unquoted 40:symbol 41:string.unquoted 43:symbol 44:white 45:string.unquoted",
            ]);
        });
        it("should start each line afresh, whatever ended the line before", () => {
            const firsts = [
                'A$="ABC',
                'DATA "abc',
                'D.1,"x',
                "10PRINT",
                "20PRINT ",
                "30INPUT",
                "PROC",
                "A=FN",
                "A=1 ",
            ];
            for (const first of firsts) {
                assert.deepStrictEqual(
                    tokens([first, "10X=1", "*FX15"].join("\n")).slice(1),
                    ["0:constant.linenum 2:variable 3:operator 4:number", "0:keyword.oscli.string"],
                    first,
                );
            }
            assert.deepStrictEqual(spans('DATA "abc', "string"), ['"abc']);
            assert.deepStrictEqual(spans('D.1,"x', "string"), ['"x']);
        });
        it("should read a * command where a statement starts", () => {
            const cases = [
                ["*INFO", "*INFO"],
                ["10 *INFO", "*INFO"],
                ["P.2*3:*.0:blah", "*.0:blah"],
                ...[
                    "IF1THEN",
                    "IF1THE.",
                    "IF1TH.",
                    "\xe71\u018c",
                    "IF0ELSE",
                    "IF0ELS.",
                    "IF0EL.",
                    "\xe70\u018b",
                ].map(statement => [`${statement}*H.`, "*H."]),
                ...["ONERROR", "ONERRO.", "ONERR.", "\xee\u0185"].map(statement => [
                    `${statement}*H.`,
                    "*H.",
                ]),
                ...["REPEAT ", "REP. ", "REPEA.", "\xf5 "].map(statement => [
                    `${statement}*|`,
                    "*|",
                ]),
                ["REPEAT **", "**"],
                ["REPEAT *FX 0", "*FX 0"],
                ["REPEAT X=X*2", null],
            ];
            for (const [text, command] of cases) {
                assert.deepStrictEqual(
                    spans(text, "keyword.oscli.string"),
                    command ? [command] : [],
                    text,
                );
                assert.deepStrictEqual(spans(text, "invalid"), [], text);
            }
        });
        it("should read as line numbers the numbers that BASIC's RENUMBER renumbers, but not after ERROR", () => {
            // Each checked by RENUMBER on BBC BASIC II.
            const cases = [
                ["IF A THEN 30 ELSE 40", ["30", "40"]],
                ["IF A TH.30 EL.40", ["30", "40"]],
                ["IFX THEN200ELSE210", ["200", "210"]],
                ["GOTO 20:GOSUB 30:G.40:GOS.50:\xe550", ["20", "30", "40", "50", "50"]],
                ["ON X GOTO 10,20 , 30 ELSE 40", ["10", "20", "30", "40"]],
                ["ON ERROR GOTO 70:RESTORE 60:TRACE 130", ["70", "60", "130"]],
                [
                    "LIST 230:AUTO 240:DELETE 10,20:RENUMBER 10,20",
                    ["230", "240", "10", "20", "10", "20"],
                ],
                [
                    "GOTO 10*2:GOTO 150+10:GOTO 230 10:GOTO 10 ,, 20",
                    ["10", "150", "230", "10", "10", "20"],
                ],
                ["GOTO 10;20:GOTO 10.5,20:GOTO 10E2,20:GOTO -10,20", ["10", "10", "10"]],
                ["GOTO &10,20", ["20"]],
                ["ON X GOTO 10,X,20:GOTO (220):GOTO A%*10", ["10"]],
                ["X=1:250:REPEAT 20:PRINT 170", []],
                ["ON X GOTO 240,250 ELSE PRINT 260", ["240", "250"]],
                ['PRINT "GOTO 80":REM GOTO 80\nDATA 90\n*FX 140', []],
            ];
            for (const [text, lineNumbers] of cases) {
                assert.deepStrictEqual(spans(text, "constant.linenum"), lineNumbers, text);
            }
            for (const text of ["ON ERROR 30", 'ERROR 5,"x"', "ON ERR. 30", "\xee\u0185 30"]) {
                assert.deepStrictEqual(spans(text, "constant.linenum"), [], text);
                assert.deepStrictEqual(spans(text, "number"), [text.match(/\d+/)[0]], text);
            }
        });
    });

    describe("strings, symbols and operators", () => {
        it("should handle symbols and operators", () => {
            for (const text of ["!", "=", "^", "'"])
                assert.deepStrictEqual(tokens(text), ["0:operator"], text);
            assert.deepStrictEqual(tokens(":"), ["0:symbol"]);
            assert.deepStrictEqual(tokens("#"), ["0:invalid"]);
            assert.deepStrictEqual(tokens("DEFFNmain:{=0}"), [
                "0:keyword 5:variable 9:symbol 10:invalid 11:operator 12:number 13:invalid",
            ]);
        });
        it("should handle # operator where valid", () => {
            const cases = [
                [
                    "P. #X,D$:CLOSE#X",
                    "0:keyword 2:white 3:symbol 4:variable 5:operator 6:variable 8:symbol 9:keyword 14:symbol 15:variable",
                ],
                [
                    "INPUT#X,A,B$",
                    "0:keyword 5:symbol 6:variable 7:operator 8:variable 9:operator 10:variable",
                ],
                ["U.EOF# Y", "0:keyword 5:symbol 6:white 7:variable"],
                [
                    "c=BGET# (channel)",
                    "0:variable 1:operator 2:keyword 6:symbol 7:white 8:delimiter.parenthesis 9:variable 16:delimiter.parenthesis",
                ],
                ["BP.#N,32", "0:keyword 3:symbol 4:variable 5:operator 6:number"],
                ["P.EXT#C%", "0:keyword 5:symbol 6:variable"],
                [
                    "PTR#f=PT.#f+4",
                    "0:keyword 3:symbol 4:variable 5:operator 6:keyword 9:symbol 10:variable 11:operator 12:number",
                ],
            ];
            for (const [text, expected] of cases)
                assert.deepStrictEqual(tokens(text), [expected], text);
        });
        it("should read strings, and an unterminated one as invalid", () => {
            assert.deepStrictEqual(tokens('P.""C1'), ["0:keyword 2:string.quote 4:variable"]);
            assert.deepStrictEqual(tokens('P."\nP."TEST\nP."ESC""APE\nP."OK"'), [
                "0:keyword 2:invalid.string",
                "0:keyword 2:invalid.string",
                "0:keyword 2:invalid.string",
                "0:keyword 2:string.quote 3:string 5:string.quote",
            ]);
        });
        it("should highlight invalid operators from other languages", () => {
            const lines = [
                "INVALID=1==2OR8!=2**3",
                "IFA><1ORB=<2ORB=>6GOTO10",
                "A+=2",
                "A=B<<C OR D>>E",
            ];
            assert.deepStrictEqual(tokens(lines.join("\n")), [
                "0:variable 7:operator 8:number 9:invalid 11:number 12:keyword 14:number 15:invalid 17:number 18:invalid 20:number",
                "0:keyword 2:variable 3:invalid 5:number 6:keyword 8:variable 9:invalid 11:number 12:keyword 14:variable 15:invalid 17:number 18:keyword 22:constant.linenum",
                "0:variable 1:invalid 3:number",
                "0:variable 1:operator 2:variable 3:invalid 5:variable 6:white 7:keyword 9:white 10:variable 11:invalid 13:variable",
            ]);
        });
    });

    describe("assembler", () => {
        it("should recognise 6502 inside []", () => {
            const cases = [
                [
                    "0[\n1LDA#42",
                    [
                        "0:constant.linenum 1:delimiter.square",
                        "0:constant.linenum 1:keyword 4:symbol 5:number",
                    ],
                ],
                [
                    "[LDA(&70,X)",
                    [
                        "0:delimiter.square 1:keyword 4:delimiter.parenthesis 5:number.hex 8:symbol 9:keyword 10:delimiter.parenthesis",
                    ],
                ],
                [
                    "[STA(&80),Y",
                    [
                        "0:delimiter.square 1:keyword 4:delimiter.parenthesis 5:number.hex 8:delimiter.parenthesis 9:symbol 10:keyword",
                    ],
                ],
                ["[ORA@%,X", ["0:delimiter.square 1:keyword 4:variable 6:symbol 7:keyword"]],
                ["[\nOPTN%", ["0:delimiter.square", "0:keyword.directive 3:variable"]],
                [
                    "[\nEQUB LENA$",
                    ["0:delimiter.square", "0:keyword.directive 4:white 5:keyword 8:variable"],
                ],
                ["[\nEQUSFNx", ["0:delimiter.square", "0:keyword.directive 4:keyword 6:variable"]],
                [
                    "[ROR 80\\comment:ROR80\\comment:]P.",
                    [
                        "0:delimiter.square 1:keyword 4:white 5:number 7:comment 15:symbol 16:keyword 19:number 21:comment 29:symbol 30:delimiter.square 31:keyword",
                    ],
                ],
                // ; starts a comment only after a mnemonic or directive, and each line starts a new statement.
                ["[;notacomment", ["0:delimiter.square 1:operator 2:variable"]],
                [
                    "[NOP ; a\n;notacomment",
                    ["0:delimiter.square 1:keyword 4:white 5:comment", "0:operator 1:variable"],
                ],
            ];
            for (const [text, expected] of cases)
                assert.deepStrictEqual(tokens(text), expected, text);
        });
        it("should highlight tokens invalid in assembler", () => {
            const text = [
                "[LDA CLEAR+CLG+CLS+DEF+ENDPROC+END+LINE+NEW+OLD+OFF",
                "STA RETURN+REPEAT+REPORT+RUN+STEP+SPC+STOP+TO+TAB(1):]",
            ].join("\n");
            assert.deepStrictEqual(
                spans(text, "invalid"),
                "CLEAR CLG CLS DEF ENDPROC END LINE NEW OLD OFF RETURN REPEAT REPORT RUN STEP SPC STOP TO TAB(".split(
                    " ",
                ),
            );
            // The raw END token is tagged as a string too, which keeps it out of bracket matching.
            assert.deepStrictEqual(spans("[\nLDA #\u00e0\n]", "invalid.string"), ["\u00e0"]);
        });
        it("should treat a ; comment as text up to the next colon, whatever it says", () => {
            for (const comment of [
                "LOAD THE ACCUMULATOR",
                "END OF LOOP",
                "the FOR loop",
                "IF EQUAL THEN",
                '"x',
                "]",
            ])
                assert.deepStrictEqual(
                    spans(`[OPT3:LDA #1 ; ${comment}:]`, "invalid"),
                    [],
                    comment,
                );
            for (const text of [
                "[LDA &70,X ; LOAD THE",
                "[.l LDA #1 ; if x",
                "[NOP\nRTS ; END OF LOOP",
                "[EQUB 1 ; FOR",
            ])
                assert.deepStrictEqual(spans(text, "invalid"), [], text);
            assert.deepStrictEqual(spans("[OPT3:LDA #1 ; fine:FOR:]", "invalid"), ["FOR"]);
            // BASIC ignores the rest of a complete instruction, but anything there but a comment is a mistake.
            assert.deepStrictEqual(spans("[NOP PRINT", "invalid"), ["PRINT"]);
        });
        it("should read letters in the case BASIC takes them", () => {
            // Mnemonics, OPT and EQU in any case; the accumulator, an index register and EQU's size only in upper
            // case, except that LDX and STX take y and LDY and STY take x.
            const cases = [
                ["[lda42,X", ["lda", "X"], []],
                ["[.l Lda #1", ["Lda"], []],
                ["[ldax", ["lda"], []],
                ["[ASL A", ["ASL", "A"], []],
                ["[asl a", ["asl"], []],
                ["[LDA 42,x", ["LDA"], ["x"]],
                ["[lda (&70,x)", ["lda"], ["x"]],
                ["[LDA (&70), y", ["LDA"], ["y"]],
                ["[LDX &70,x", ["LDX"], ["x"]],
                ["[LDX &70,y", ["LDX", "y"], []],
                ["[sty &70,x", ["sty", "x"], []],
                // BASIC reads no index after these.
                ["[LDA #1,x", ["LDA"], []],
                ["[JSR &70,x", ["JSR"], []],
                ["[LDA ASC(MID$(A$,x,1))", ["LDA", "ASC", "MID$("], []],
                ["[equb 1", [], ["equb"]],
                ["[EQUw 1", [], ["EQUw"]],
                ["[Ora 1:orA 1:oRA 1", ["Ora", "orA", "oRA"], []],
                ["[ORa 1", [], ["ORa"]],
            ];
            for (const [text, keywords, invalid] of cases) {
                assert.deepStrictEqual(spans(text, "keyword"), keywords, text);
                assert.deepStrictEqual(spans(text, "invalid"), invalid, text);
            }
            assert.deepStrictEqual(spans("[opt 3:eqUW 1", "keyword.directive"), ["opt", "eqUW"]);
        });
        it("should allow STR$~ in an expression", () => {
            for (const text of ["[OPT3:EQUS STR$~(255):]", "[OPT3:EQUB ASC(STR$~A%):]"])
                assert.deepStrictEqual(spans(text, "invalid"), [], text);
            assert.deepStrictEqual(spans("[OPT3:EQUS STR$~~(255):]", "invalid"), ["~"]);
        });
        it("should read an operand's names and keywords as BASIC reads them", () => {
            // A mnemonic is only a mnemonic where a statement starts, and BASIC reads PIX and TIMER as names.
            const cases = [
                ["[LDA TAXRATE", ["TAXRATE"]],
                ["[EQUB 1 LDA 2", ["LDA"]],
                ["[LDA #PIX", ["PIX"]],
                ["[LDA #TIMER", ["TIMER"]],
                ["[LDA #PI", []],
            ];
            for (const [text, variables] of cases)
                assert.deepStrictEqual(spans(text, "variable"), variables, text);
            // LEFT$. is LEFT$( abbreviated, which an operand can use.
            assert.deepStrictEqual(spans("[LDA LEFT$.A$,1)", "invalid"), []);
        });
    });
});

describe("Bracket matching", () => {
    it("should pair each ) with its (, including the hidden ( of keywords, abbreviations and tokens", () => {
        const hidden = [
            "RIGHT$(",
            "RIGHT$.",
            "RI.",
            "LE.",
            "MI.",
            "MID$(",
            "TAB(",
            "POINT(",
            "STRING$(",
        ];
        const cases = [
            ...[...hidden, ...openers].map(keyword => [`P.${keyword}A$,1)`, []]),
            ['A$="OWLET":P.RI.A$,1)LE.A$,2)MI.A$,4,1)MI.A$,3,1)', []], // #114
            ["P.(1+2))", [8]],
            ["P.RI.A$,1))", [11]],
            ["P.RIGHT$(A$,1))", [15]],
            ["PRI.A$,1)", [9]], // PRI. is PRINT, not RIGHT$(
        ];
        for (const [text, columns] of cases) assert.deepStrictEqual(unmatched(text), columns, text);
    });
    it("should make only the ( of a keyword that ends in ( a bracket, so the keyword is coloured as one", () => {
        // #170: Q$=MID$(Q$,2) must colour MID$ like STR$, with only the ( in the bracket colour.
        for (const text of ["Q$=MID$(Q$,2)+STR$(Q%)", "P.RIGHT$(A$,1)", "P.TAB(3)", "X=POINT(1,2)", "A$=STRING$(2,A$)"])
            assert.strictEqual(brackets(text)[0][0], text.indexOf("(") + 1, text);
        assert.deepStrictEqual(brackets("Q$=MID$(Q$,2)").map(([start]) => start), [8, 13]);
    });
    it("should ignore brackets in strings, comments and * commands", () => {
        for (const text of ['P."RI.A$,1)"', "REM RI.A$,1)", "*FX 1)", "10 *RUN RI.("])
            assert.deepStrictEqual(brackets(text), [], text);
    });
    it("should never treat a raw token that is not an opener as a bracket", () => {
        for (const char of keywords.map(tokenChar).filter(char => !openers.includes(char))) {
            for (const text of [
                char,
                `PRINT ${char}`,
                `IFX ${char}`,
                `A=1:${char}:B=2`,
                `[\n${char}\n]`,
            ])
                assert.deepStrictEqual(
                    unmatched(text),
                    [],
                    `U+${char.codePointAt(0).toString(16)} in ${text}`,
                );
        }
    });
    it("has a known limitation: an abbreviated opener straight after a keyword leaves its close unmatched", () => {
        // Monaco merges neighbouring same-coloured tokens, so its \b-guarded opener match fails in "PRINTLE.".
        assert.deepStrictEqual(unmatched("PRINTLE.A$,1)"), [13]);
        assert.deepStrictEqual(unmatched("PRINT LE.A$,1)"), []);
        assert.deepStrictEqual(unmatched("PRINTLEFT$(A$,1)"), []);
        // A dot before the opener is a word boundary, so fully abbreviated code is fine, unless a keyword with no
        // abbreviation (LEN) comes first.
        assert.deepStrictEqual(unmatched("P.LE.A$,1)"), []);
        assert.deepStrictEqual(unmatched("P.LENMI.A$,2)"), [13]);
    });
});

describe("Line warnings", () => {
    it("should not generate warnings on lines that are fine", () => {
        const cases = [
            "COLOUR 123",
            'P."I am a mongoose"',
            "colour%=123",
            "colour$=a$",
            // A variable that merely starts with a keyword is fine: only a whole lower-case keyword is suspicious.
            ...["radius%", "order%", "cosang", "sinang", "colour3", "printer$", "print_x"].map(
                name => `${name}=1`,
            ),
            // Lower-case immediate commands are often names.
            "old=new",
            "auto=delete+load/list+renumber*save",
            "H. TO",
            "P.TO",
            "A=H.",
        ];
        for (const text of cases) checkWarnings(text);
    });
    it("should warn on keywords typed in lower case", () => {
        checkWarnings("colour", caseWarning("COLOUR", 1));
        checkWarnings("chr$", caseWarning("CHR$", 1));
        checkWarnings('print"hi"', caseWarning("PRINT", 1));
        // A name ends at a `$`, and a keyword ends at its bracket, so whatever follows them is not part of the name.
        checkWarnings("A=left$(B$,1)", caseWarning("LEFT$(", 3));
        checkWarnings("P.chr$65", caseWarning("CHR$", 3));
        checkWarnings("A$=inkey$0", caseWarning("INKEY$", 4));
        checkWarnings("A=len(B$)", caseWarning("LEN", 3));
        // The whole name is a keyword when something that cannot be part of a name follows it.
        for (const follower of [",", ":", ";", " ", "."])
            checkWarnings(`print${follower}`, caseWarning("PRINT", 1));
        // Both GET and GET$ are tokens - check that doesn't trip us up.
        checkWarnings("A$=get$", caseWarning("GET$", 4));
        // Each line of a program, wherever its text starts.
        const where = getWarnings("  colour\nX=1:chr$").map(w => [
            w.startLineNumber,
            w.startColumn,
        ]);
        assert.deepStrictEqual(where, [
            [1, 3],
            [2, 5],
        ]);
    });
    it("should warn on invalid operators from other languages", () => {
        const cases = [
            ["==", "=", 1],
            ["!=", "<>", 1],
            ["A=2**3", "^", 4],
            ["><", "<>", 1],
            ["=<", "<=", 1],
            ["=>", ">=", 1],
        ];
        for (const [text, replacement, startColumn] of cases) {
            const operator = text.slice(startColumn - 1, startColumn + 1);
            checkWarnings(text, {
                message: `${operator} is not a BBC BASIC operator, did you mean ${replacement}?`,
                startColumn,
                endColumn: startColumn + 2,
            });
        }
    });
    it("should suggest a space after an abbreviation that is followed by letters", () => {
        const cases = [
            ["H.TO", "H. TO", 1],
            ["F.A=1 TO H.TO8", "H. TO8", 10],
        ];
        for (const [text, fixed, startColumn] of cases) {
            checkWarnings(text, {
                message: `H. is not read as an abbreviation when followed directly by letters or digits, did you mean "${fixed}"?`,
                code: "space-after-abbreviation",
                startColumn,
                endColumn: startColumn + fixed.length - 1,
            });
        }
    });
});

describe("Quick fixes", () => {
    // Applies the first quick fix for the line's first warning and returns the line as the edit leaves it.
    function applyQuickFix(text) {
        const model = editor.createModel(text, LanguageId);
        try {
            const markers = getWarnings(text);
            const {actions} = codeActionProvider.provideCodeActions(model, markers[0], {markers});
            const {title, edit} = actions[0];
            const {range, text: inserted} = edit.edits[0].textEdit;
            const result =
                text.slice(0, range.startColumn - 1) + inserted + text.slice(range.endColumn - 1);
            return {title, result};
        } finally {
            model.dispose();
        }
    }

    it("should insert a space after the abbreviation", () => {
        assert.deepStrictEqual(applyQuickFix("H.TO"), {
            title: "Insert a space after H.",
            result: "H. TO",
        });
        assert.deepStrictEqual(applyQuickFix("F.A=1 TO H.TO8"), {
            title: "Insert a space after H.",
            result: "F.A=1 TO H. TO8",
        });
    });
    it("should replace a keyword typed in lower case, or an operator from another language", () => {
        assert.deepStrictEqual(applyQuickFix("colour"), {
            title: "Replace with COLOUR",
            result: "COLOUR",
        });
        assert.deepStrictEqual(applyQuickFix("A=2**3"), {title: "Replace with ^", result: "A=2^3"});
    });
});
