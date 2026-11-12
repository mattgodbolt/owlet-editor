import {getWarnings, registerBbcBasicLanguage} from "../src/bbcbasic";
import {keywords} from "../src/tokens";
import {describe, it, vi, afterEach} from "vitest";
import assert from "assert";
import {editor, languages, MarkerSeverity, Range} from "monaco-editor/esm/vs/editor/editor.api";

function checkTokens(text, ...expected) {
    const tokenized = editor.tokenize(text.join("\n"), "BBCBASIC").map(line =>
        line.map(t => ({
            offset: t.offset,
            type: t.type.replace(".BBCBASIC", ""),
        })),
    );
    assert.deepStrictEqual(tokenized, [...expected]);
}

describe("Tokenisation", () => {
    registerBbcBasicLanguage();
    it("should recognise simple tokens", () => {
        checkTokens(["PRINT"], [{offset: 0, type: "keyword"}]);
        checkTokens(["CALL"], [{offset: 0, type: "keyword"}]);
        checkTokens(["RESTORE"], [{offset: 0, type: "keyword"}]);
    });
    it("should recognise abutting tokens", () => {
        // we recognise this as two separate tokens, though the editor coalesces them into one.
        checkTokens(["PRINTLEN"], [{offset: 0, type: "keyword"}]);
        checkTokens(["P.LEN"], [{offset: 0, type: "keyword"}]);
    });
    it("should recognise tokens abutting variables", () => {
        // we recognise this as two separate tokens, though the editor coalesces them into one.
        checkTokens(
            ["PRINTA$"],
            [
                {offset: 0, type: "keyword"},
                {offset: 5, type: "variable"},
            ],
        );
    });
    it("should work with assignments", () => {
        checkTokens(
            ["N=1"],
            [
                {offset: 0, type: "variable"},
                {offset: 1, type: "operator"},
                {offset: 2, type: "number"},
            ],
        );
        checkTokens(
            ["N%=1"],
            [
                {offset: 0, type: "variable"},
                {offset: 2, type: "operator"},
                {offset: 3, type: "number"},
            ],
        );
        checkTokens(
            ["N$=1"],
            [
                {offset: 0, type: "variable"},
                {offset: 2, type: "operator"},
                {offset: 3, type: "number"},
            ],
        );
        checkTokens(
            ["N$ = 1"],
            [
                {offset: 0, type: "variable"},
                {offset: 2, type: "white"},
                {offset: 3, type: "operator"},
                {offset: 4, type: "white"},
                {offset: 5, type: "number"},
            ],
        );
    });
    describe("number checks", () => {
        // These all need a variable assignment at first to prevent the number
        // being interpreted as a line number.
        const checkNum = (text, type) => {
            checkTokens(
                [`A=${text}`],
                [
                    {offset: 0, type: "variable"},
                    {offset: 1, type: "operator"},
                    {
                        offset: 2,
                        type: type,
                    },
                ],
            );
        };
        it("should recognise integer numbers", () => {
            checkNum("123450", "number");
        });
        it("should recognise floating point numbers", () => {
            checkNum("123.450", "number.float");
        });
        it("should recognise floating point numbers in E format", () => {
            checkNum("123.450E-1", "number.float");
            checkNum("2E4", "number.float");
            checkNum("9E+", "number.float");
            checkNum("9E-", "number.float");
            checkNum("9.E+", "number.float");
            checkNum("9.E-", "number.float");
            checkNum(".9E+", "number.float");
            checkNum(".9E-", "number.float");
            checkNum("3.14E+", "number.float");
            checkNum("2.7E-", "number.float");
            checkNum(".E-", "number.float");
            checkNum(".E+", "number.float");
        });
        it("should handle floating numbers with no suffix", () => {
            checkNum("1.", "number.float");
        });
        it("should handle floating numbers with no prefix", () => {
            checkNum("1.", "number.float");
        });
        it("should handle floating numbers with no suffix", () => {
            checkNum(".5", "number.float");
        });
        it("should handle a single decimal point being a number", () => {
            checkNum(".", "number.float");
        });
    });
    it("should handle awkward cases", () => {
        // See https://github.com/mattgodbolt/owlet-editor/issues/26
        checkTokens(
            ["FORJ%=2E4TO22400STEP100"],
            [
                {offset: 0, type: "keyword"}, // FOR
                {offset: 3, type: "variable"}, // J%
                {offset: 5, type: "operator"}, // =
                {offset: 6, type: "number.float"}, // 2E4
                {offset: 9, type: "keyword"}, // TO
                {offset: 11, type: "number"}, // 22400
                {offset: 16, type: "keyword"}, // STEP
                {offset: 20, type: "number"}, // 100
            ],
        );
    });
    it("should recognise percent variables", () => {
        checkTokens(["A%"], [{offset: 0, type: "variable"}]);
        checkTokens(["X%"], [{offset: 0, type: "variable"}]);
        checkTokens(["LONGVAR%"], [{offset: 0, type: "variable"}]);
        checkTokens(["@%"], [{offset: 0, type: "variable"}]);
    });
    it("should recognise abbreviations", () => {
        checkTokens(["P."], [{offset: 0, type: "keyword"}]);
        checkTokens(["C."], [{offset: 0, type: "keyword"}]);
        checkTokens(["R."], [{offset: 0, type: "keyword"}]);
    });
    it("should allow $ in abbreviated tokens", () => {
        checkTokens(
            ['P.STRING$.2,"HO")'],
            [
                {offset: 0, type: "keyword"},
                {offset: 10, type: "number"},
                {offset: 11, type: "operator"},
                {offset: 12, type: "string.quote"},
                {offset: 13, type: "string"},
                {offset: 15, type: "string.quote"},
                {offset: 16, type: "delimiter.parenthesis"},
            ],
        );
    });
    it("should read a dot after a name as a number only where one value can follow another", () => {
        // See #85, #149 and #150, checked on the ROM: PRINT, VDU and INPUT take one value directly after another,
        // so P.X. prints X and then 0, but Y=X.7 is a syntax error and Z. is a Mistake.
        checkTokens(
            ["P.X.", "Y=X.7", "PRIT."],
            [
                {offset: 0, type: "keyword"},
                {offset: 2, type: "variable"},
                {offset: 3, type: "number.float"},
            ],
            [
                {offset: 0, type: "variable"},
                {offset: 1, type: "operator"},
                {offset: 2, type: "variable"},
                {offset: 3, type: "invalid"},
            ],
            [
                {offset: 0, type: "variable"},
                {offset: 4, type: "invalid"},
            ],
        );
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
        ];
        for (const [text, invalid] of cases) {
            assert.deepStrictEqual(spans(text, "invalid"), invalid, text);
        }
    });
    it("should not treat BG as an abbreviation without the dot", () => {
        // BGET abbreviates to B., BG. and BGE. but plain BG is just a variable.
        for (const text of ["BG=1", "BG%=2", 'BG$=""']) {
            assert.deepStrictEqual(spans(text, "keyword"), [], text);
        }
        assert.deepStrictEqual(spans("A=BG.#1", "keyword"), ["BG."]);
        assert.deepStrictEqual(spans("A=BG.#1", "symbol"), ["#"]);
    });
    it("should not recognize 6502 outside of []", () => {
        checkTokens(["LDA"], [{offset: 0, type: "variable"}]);
    });
    it("should recognise 6502 inside []", () => {
        checkTokens(
            ["0[", "1LDA#42"],
            [
                {offset: 0, type: "constant.linenum"},
                {offset: 1, type: "delimiter.square"},
            ],
            [
                {offset: 0, type: "constant.linenum"},
                {offset: 1, type: "keyword"},
                {offset: 4, type: "symbol"},
                {offset: 5, type: "number"},
            ],
        );
        checkTokens(
            ["[LDA(&70,X)"],
            [
                {offset: 0, type: "delimiter.square"},
                {offset: 1, type: "keyword"},
                {offset: 4, type: "delimiter.parenthesis"},
                {offset: 5, type: "number.hex"},
                {offset: 8, type: "symbol"},
                {offset: 9, type: "keyword"},
                {offset: 10, type: "delimiter.parenthesis"},
            ],
        );
        checkTokens(
            ["[STA(&80),Y"],
            [
                {offset: 0, type: "delimiter.square"},
                {offset: 1, type: "keyword"},
                {offset: 4, type: "delimiter.parenthesis"},
                {offset: 5, type: "number.hex"},
                {offset: 8, type: "delimiter.parenthesis"},
                {offset: 9, type: "symbol"},
                {offset: 10, type: "keyword"},
            ],
        );
        checkTokens(
            ["[ORA@%,X"],
            [
                {offset: 0, type: "delimiter.square"},
                {offset: 1, type: "keyword"},
                {offset: 4, type: "variable"},
                {offset: 6, type: "symbol"},
                {offset: 7, type: "keyword"},
            ],
        );
        checkTokens(
            ["[", "OPTN%"],
            [{offset: 0, type: "delimiter.square"}],
            [
                {offset: 0, type: "keyword.directive"},
                {offset: 3, type: "variable"},
            ],
        );
        checkTokens(
            ["[", "EQUB LENA$"],
            [{offset: 0, type: "delimiter.square"}],
            [
                {offset: 0, type: "keyword.directive"},
                {offset: 4, type: "white"},
                {offset: 5, type: "keyword"},
                {offset: 8, type: "variable"},
            ],
        );
        checkTokens(
            ["[", "EQUSFNx"],
            [{offset: 0, type: "delimiter.square"}],
            [
                {offset: 0, type: "keyword.directive"},
                {offset: 4, type: "keyword"},
                {offset: 6, type: "variable"},
            ],
        );
        checkTokens(
            ["[ROR 80\\comment:ROR80\\comment:]P."],
            [
                {offset: 0, type: "delimiter.square"},
                {offset: 1, type: "keyword"},
                {offset: 4, type: "white"},
                {offset: 5, type: "number"},
                {offset: 7, type: "comment"},
                {offset: 15, type: "symbol"},
                {offset: 16, type: "keyword"},
                {offset: 19, type: "number"},
                {offset: 21, type: "comment"},
                {offset: 29, type: "symbol"},
                {offset: 30, type: "delimiter.square"},
                {offset: 31, type: "keyword"},
            ],
        );
        // Regression test - `;` was incorrectly treated as a comment.
        checkTokens(
            ["[;notacomment"],
            [
                {offset: 0, type: "delimiter.square"},
                {offset: 1, type: "operator"},
                {offset: 2, type: "variable"},
            ],
        );
    });
    it("should highlight tokens invalid in assembler", () => {
        checkTokens(
            [
                "[LDA CLEAR+CLG+CLS+DEF+ENDPROC+END+LINE+NEW+OLD+OFF",
                "STA RETURN+REPEAT+REPORT+RUN+STEP+SPC+STOP+TO+TAB(1):]"
            ],
            [
                {offset: 0, type: "delimiter.square"},
                {offset: 1, type: "keyword"},
                {offset: 4, type: "white"},
                {offset: 5, type: "invalid"},
                {offset: 10, type: "operator"},
                {offset: 11, type: "invalid"},
                {offset: 14, type: "operator"},
                {offset: 15, type: "invalid"},
                {offset: 18, type: "operator"},
                {offset: 19, type: "invalid"},
                {offset: 22, type: "operator"},
                {offset: 23, type: "invalid"},
                {offset: 30, type: "operator"},
                {offset: 31, type: "invalid"},
                {offset: 34, type: "operator"},
                {offset: 35, type: "invalid"},
                {offset: 39, type: "operator"},
                {offset: 40, type: "invalid"},
                {offset: 43, type: "operator"},
                {offset: 44, type: "invalid"},
                {offset: 47, type: "operator"},
                {offset: 48, type: "invalid"},
            ],
            [
                {offset: 0, type: "keyword"},
                {offset: 3, type: "white"},
                {offset: 4, type: "invalid"},
                {offset: 10, type: "operator"},
                {offset: 11, type: "invalid"},
                {offset: 17, type: "operator"},
                {offset: 18, type: "invalid"},
                {offset: 24, type: "operator"},
                {offset: 25, type: "invalid"},
                {offset: 28, type: "operator"},
                {offset: 29, type: "invalid"},
                {offset: 33, type: "operator"},
                {offset: 34, type: "invalid"},
                {offset: 37, type: "operator"},
                {offset: 38, type: "invalid"},
                {offset: 42, type: "operator"},
                {offset: 43, type: "invalid"},
                {offset: 45, type: "operator"},
                {offset: 46, type: "invalid"},
                {offset: 50, type: "number"},
                {offset: 51, type: "delimiter.parenthesis"},
                {offset: 52, type: "symbol"},
                {offset: 53, type: "delimiter.square"},
            ],
        );
    });
    it("should notice REM statements", () => {
        checkTokens(
            ["REM this is a comment"],
            [
                {offset: 0, type: "keyword"},
                {offset: 3, type: "comment"},
            ],
        );
        checkTokens(
            ["REM this is a comment and has PRINT in it"],
            [
                {offset: 0, type: "keyword"},
                {offset: 3, type: "comment"},
            ],
        );
        checkTokens(
            ["REM this is a comment doesn't ends at a colon:PRINT"],
            [
                {offset: 0, type: "keyword"},
                {offset: 3, type: "comment"},
            ],
        );
        checkTokens(
            ["REMthis is also a comment"],
            [
                {offset: 0, type: "keyword"},
                {offset: 3, type: "comment"},
            ],
        );
        checkTokens(
            ["REM", "PRINT"],
            [{offset: 0, type: "keyword"}],
            [{offset: 0, type: "keyword"}],
        );
    });
    it("should suitably highlight DATA statements", () => {
        checkTokens(
            [
                "DATA",
                "D.a b,c",
                "DA.,,,7,",
                "DAT.PI,COS0,SQRLN@%",
                "DATA3 ,\"comma,quoted\", \"esc\"\"ape\", qu\"te,q\", 3x",
            ],
            [
                {offset: 0, type: "keyword"},
            ],
            [
                {offset: 0, type: "keyword"},
                {offset: 2, type: "string.unquoted"},
                {offset: 5, type: "symbol"},
                {offset: 6, type: "string.unquoted"},
            ],
            [
                {offset: 0, type: "keyword"},
                {offset: 3, type: "symbol"},
                {offset: 6, type: "string.unquoted"},
                {offset: 7, type: "symbol"},
            ],
            [
                {offset: 0, type: "keyword"},
                {offset: 4, type: "string.unquoted"},
                {offset: 6, type: "symbol"},
                {offset: 7, type: "string.unquoted"},
                {offset: 11, type: "symbol"},
                {offset: 12, type: "string.unquoted"},
            ],
            [
                {offset: 0, type: "keyword"},
                {offset: 4, type: "string.unquoted"},
                {offset: 5, type: "white"},
                {offset: 6, type: "symbol"},
                {offset: 7, type: "string.quote"},
                {offset: 8, type: "string"},
                {offset: 20, type: "string.quote"},
                {offset: 21, type: "symbol"},
                {offset: 22, type: "white"},
                {offset: 23, type: "string.quote"},
                {offset: 24, type: "string"},
                {offset: 27, type: "string.quote"},
                {offset: 29, type: "string"},
                {offset: 32, type: "string.quote"},
                {offset: 33, type: "symbol"},
                {offset: 34, type: "white"},
                {offset: 35, type: "string.unquoted"},
                {offset: 40, type: "symbol"},
                {offset: 41, type: "string.unquoted"},
                {offset: 43, type: "symbol"},
                {offset: 44, type: "white"},
                {offset: 45, type: "string.unquoted"},
            ],
        );
    });
    it("should start each line afresh, whatever ended the line before", () => {
        for (const first of ['A$="ABC', 'DATA "abc', 'D.1,"x', "10PRINT", "20PRINT ", "30INPUT", "PROC", "A=FN", "A=1 "]) {
            const [, ...next] = editor.tokenize([first, "10X=1", "*FX15"].join("\n"), "BBCBASIC");
            assert.deepStrictEqual(
                next.map(line => line.map(t => t.type.replace(".BBCBASIC", ""))),
                [["constant.linenum", "variable", "operator", "number"], ["keyword.oscli.string"]],
                first,
            );
        }
        assert.deepStrictEqual(spans('DATA "abc', "string"), ['"abc']);
        assert.deepStrictEqual(spans('D.1,"x', "string"), ['"x']);
    });
    it("should handle symbols and operators", () => {
        checkTokens(["!"], [{offset: 0, type: "operator"}]);
        checkTokens([":"], [{offset: 0, type: "symbol"}]);
        checkTokens(["="], [{offset: 0, type: "operator"}]);
        checkTokens(["^"], [{offset: 0, type: "operator"}]);
        checkTokens(["'"], [{offset: 0, type: "operator"}]);
    });
    // The source text of each token of the given type.
    function spans(text, type) {
        const [line] = editor.tokenize(text, "BBCBASIC");
        return line.flatMap((t, i) =>
            t.type.replace(".BBCBASIC", "") === type ?
                [text.slice(t.offset, i + 1 < line.length ? line[i + 1].offset : text.length)] :
                [],
        );
    }
    it("should treat TO followed by P as the single keyword TOP", () => {
        assert.deepStrictEqual(spans("PRINT TOP", "keyword"), ["PRINT", "TOP"]);
        assert.deepStrictEqual(spans("PRINT TOP", "variable"), []);
        assert.deepStrictEqual(spans("A=TOP+1", "keyword"), ["TOP"]);
        assert.deepStrictEqual(spans("X=TOP-PAGE", "keyword"), ["TOP", "PAGE"]);
        assert.deepStrictEqual(spans("[LDA #TOP MOD 256", "keyword"), ["LDA", "TOP", "MOD"]);
        assert.deepStrictEqual(spans("[LDA #TOP MOD 256", "invalid"), []);
    });
    it("should read TO P in a FOR statement as the loop's TO unless an operand is expected", () => {
        // The first TOP is the function, the second is TO then the variable P.
        assert.deepStrictEqual(spans("F.P=TOP TOP:P.P:N.", "keyword"), ["F.", "TOP", "TO", "P.", "N."]);
        assert.deepStrictEqual(spans("F.P=TOP TOP:P.P:N.", "variable"), ["P", "P", "P"]);
        assert.deepStrictEqual(spans("FOR I=1 TO P", "keyword"), ["FOR", "TO"]);
        assert.deepStrictEqual(spans("FOR I=1TOP", "variable"), ["I", "P"]);
        assert.deepStrictEqual(spans("FOR I=(TOP) TO TOP+1", "keyword"), ["FOR", "TOP", "TO", "TOP"]);
        assert.deepStrictEqual(spans("FOR I=A+TOP TO P STEP 2", "keyword"), ["FOR", "TOP", "TO", "STEP"]);
        // The FOR statement ends at a colon.
        assert.deepStrictEqual(spans("FOR I=1 TO 2:PRINT TOP", "keyword"), ["FOR", "TO", "PRINT", "TOP"]);
        // After a keyword that takes an operand, TOP is still the function.
        assert.deepStrictEqual(spans("FOR I=ABS TOP TO TOP", "keyword"), ["FOR", "ABS", "TOP", "TO", "TOP"]);
        assert.deepStrictEqual(spans("FOR I=ABS TOP TO TOP", "variable"), ["I"]);
        assert.deepStrictEqual(spans("FOR I=AB. TOP TO TOP", "keyword"), ["FOR", "AB.", "TOP", "TO", "TOP"]);
        assert.deepStrictEqual(spans("FOR I=AB.TOP TO TOP", "variable"), ["I"]);
        assert.deepStrictEqual(spans("FOR I=XY.TOP", "variable"), ["I", "XY", "P"]);
        assert.deepStrictEqual(spans("FOR I=1 AND TOP TO 2", "keyword"), ["FOR", "AND", "TOP", "TO"]);
        // Abbreviated and raw token forms, checked against the ROM by running them.
        assert.deepStrictEqual(spans("FO.I=TOP TO TOP+1", "keyword"), ["FO.", "TOP", "TO", "TOP"]);
        assert.deepStrictEqual(spans("\xe3I=\xb8P \xb8 \xb8P+1", "keyword"), ["\xe3", "\xb8P", "\xb8", "\xb8P"]);
        assert.deepStrictEqual(spans("\xe3P=\xb8P \xb8P:\xf1P", "variable"), ["P", "P", "P"]);
        assert.deepStrictEqual(spans("\xe3I=\u0194\xb8P \xb8 \xb8P", "variable"), ["I"]);
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
            assert.strictEqual(spans(text, "operator").join("").split("~").length - 1, count, text);
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
        for (const text of invalid) {
            assert.deepStrictEqual(spans(text, "invalid"), ["~"], text);
        }
    });
    it("should correctly handle invalid symbols", () => {
        checkTokens(
            ["DEFFNmain:{=0}"],
            [
                {offset: 0, type: "keyword"},
                {offset: 5, type: "variable"},
                {offset: 9, type: "symbol"},
                {offset: 10, type: "invalid"},
                {offset: 11, type: "operator"},
                {offset: 12, type: "number"},
                {offset: 13, type: "invalid"},
            ]
        );
        checkTokens(["#"], [{offset: 0, type: "invalid"}]);
    });
    it("should handle # operator where valid", () => {
        checkTokens(
            ["P. #X,D$:CLOSE#X"],
            [
                {offset: 0, type: "keyword"},
                {offset: 2, type: "white"},
                {offset: 3, type: "symbol"},
                {offset: 4, type: "variable"},
                {offset: 5, type: "operator"},
                {offset: 6, type: "variable"},
                {offset: 8, type: "symbol"},
                {offset: 9, type: "keyword"},
                {offset: 14, type: "symbol"},
                {offset: 15, type: "variable"},
            ]
        );
        checkTokens(
            ["INPUT#X,A,B$"],
            [
                {offset: 0, type: "keyword"},
                {offset: 5, type: "symbol"},
                {offset: 6, type: "variable"},
                {offset: 7, type: "operator"},
                {offset: 8, type: "variable"},
                {offset: 9, type: "operator"},
                {offset: 10, type: "variable"},
            ]
        );
        checkTokens(
            ["U.EOF# Y"],
            [
                {offset: 0, type: "keyword"},
                {offset: 5, type: "symbol"},
                {offset: 6, type: "white"},
                {offset: 7, type: "variable"},
            ]
        );
        checkTokens(
            ["c=BGET# (channel)"],
            [
                {offset: 0, type: "variable"},
                {offset: 1, type: "operator"},
                {offset: 2, type: "keyword"},
                {offset: 6, type: "symbol"},
                {offset: 7, type: "white"},
                {offset: 8, type: "delimiter.parenthesis"},
                {offset: 9, type: "variable"},
                {offset: 16, type: "delimiter.parenthesis"},
            ]
        );
        checkTokens(
            ["BP.#N,32"],
            [
                {offset: 0, type: "keyword"},
                {offset: 3, type: "symbol"},
                {offset: 4, type: "variable"},
                {offset: 5, type: "operator"},
                {offset: 6, type: "number"},
            ]
        );
        checkTokens(
            ["P.EXT#C%"],
            [
                {offset: 0, type: "keyword"},
                {offset: 5, type: "symbol"},
                {offset: 6, type: "variable"},
            ]
        );
        checkTokens(
            ["PTR#f=PT.#f+4"],
            [
                {offset: 0, type: "keyword"},
                {offset: 3, type: "symbol"},
                {offset: 4, type: "variable"},
                {offset: 5, type: "operator"},
                {offset: 6, type: "keyword"},
                {offset: 9, type: "symbol"},
                {offset: 10, type: "variable"},
                {offset: 11, type: "operator"},
                {offset: 12, type: "number"},
            ]
        );
        checkTokens(["!"], [{offset: 0, type: "operator"}]);
        checkTokens([":"], [{offset: 0, type: "symbol"}]);
        checkTokens(["="], [{offset: 0, type: "operator"}]);
        checkTokens(["^"], [{offset: 0, type: "operator"}]);
        checkTokens(["'"], [{offset: 0, type: "operator"}]);
    });
    it("should not treat C specially after a string", () => {
        checkTokens(
            ['P.""C1'],
            [
                {offset: 0, type: "keyword"},
                {offset: 2, type: "string.quote"},
                {offset: 4, type: "variable"},
            ],
        );
    });
    it("should handle an unterminated string gracefully", () => {
        checkTokens(
            ['P."', 'P."TEST', 'P."ESC""APE', 'P."OK"'],
            [
                {offset: 0, type: "keyword"},
                {offset: 2, type: "invalid.string"},
            ],
            [
                {offset: 0, type: "keyword"},
                {offset: 2, type: "invalid.string"},
            ],
            [
                {offset: 0, type: "keyword"},
                {offset: 2, type: "invalid.string"},
            ],
            [
                {offset: 0, type: "keyword"},
                {offset: 2, type: "string.quote"},
                {offset: 3, type: "string"},
                {offset: 5, type: "string.quote"},
            ],
        );
    });
    it("should tokenise continuation tokens when appropriate", () => {
        checkTokens(["TIME"], [{offset: 0, type: "keyword"}]);
        checkTokens(
            ["TIME r"],
            [
                {offset: 0, type: "keyword"},
                {offset: 4, type: "white"},
                {offset: 5, type: "variable"},
            ],
        );
    });
    it("should not tokenise continuation tokens followed by alphanum", () => {
        checkTokens(["TIMER"], [{offset: 0, type: "variable"}]);
        // Surprisingly even abbreviations are affected by the continuation. See #36.
        checkTokens(["H.TO"], [{offset: 0, type: "invalid"}]);
        // An abbreviation stands for the first keyword in the table with that prefix (B. is BGET, R. is RETURN),
        // so it is conditional if that keyword is, whatever later keywords share the prefix.
        for (const text of ["B.X", "BG.X", "BP.X", "CLO.X", "EO.X", "PT.X", "E.X", "EN.X", "ER.X", "O.X", "R.X", "RE.X"]) {
            assert.deepStrictEqual(spans(text, "invalid"), [text], text);
        }
        for (const text of ["A=B. #X", "R.:", "RE.", "P.X", "I.X", "F.X", "D.X", "REP.X"]) {
            assert.deepStrictEqual(spans(text, "invalid"), [], text);
        }
    });
    it("should read a keyword and a dot as the abbreviation of an earlier keyword it begins", () => {
        // END. is ENDPROC, MOD. is MODE and so on, since those come first in the table.
        for (const text of ["END.", "ON ERR.", "A=GET.", "A=INKEY.5", "A=8MOD.3"]) {
            assert.deepStrictEqual(spans(text, "keyword").slice(-1), [text.match(/[A-Z]+\./)[0]], text);
        }
        assert.deepStrictEqual(spans("END.X", "invalid"), ["END.X"]);
        assert.deepStrictEqual(spans("A=8MOD 3", "keyword"), ["MOD"]);
    });
    it("should not include $ mid token/identifier", () => {
        checkTokens(
            ["IFVALA$PRINTA$.1"],
            [
                {offset: 0, type: "keyword"},
                {offset: 5, type: "variable"},
                {offset: 7, type: "keyword"},
                {offset: 12, type: "variable"},
                {offset: 14, type: "number.float"},
            ],
        );
    });
    it("should parse floating point number after $", () => {
        checkTokens(
            ["P.$.114338E6"],
            [
                {offset: 0, type: "keyword"},
                {offset: 2, type: "operator"},
                {offset: 3, type: "number.float"},
            ],
        );
    });
    it("should allow FN and PROC names starting with a digit", () => {
        checkTokens(
            ["DEFFN3D PROC1to1:PRO.2too:=FN42"],
            [
                {offset: 0, type: "keyword"},
                {offset: 5, type: "variable"},
                {offset: 7, type: "white"},
                {offset: 8, type: "keyword"},
                {offset: 12, type: "variable"},
                {offset: 16, type: "symbol"},
                {offset: 17, type: "keyword"},
                {offset: 21, type: "variable"},
                {offset: 25, type: "symbol"},
                {offset: 26, type: "operator"},
                {offset: 27, type: "keyword"},
                {offset: 29, type: "variable"},
            ],
        );
    });
    it("should handle OSCLI at start of line", () => {
        checkTokens(["*INFO"], [{offset: 0, type: "keyword.oscli.string"}]);
    });
    it("should handle OSCLI after line number", () => {
        checkTokens(
            ["10 *INFO"],
            [
                {offset: 0, type: "constant.linenum"},
                {offset: 2, type: "white"},
                {offset: 3, type: "keyword.oscli.string"},
            ],
        );
    });
    it("should handle OSCLI at end of line", () => {
        checkTokens(
            ["P.2*3:*.0:blah"],
            [
                {offset: 0, type: "keyword"},
                {offset: 2, type: "number"},
                {offset: 3, type: "operator"},
                {offset: 4, type: "number"},
                {offset: 5, type: "symbol"},
                {offset: 6, type: "keyword.oscli.string"},
            ],
        );
    });
    it("should handle OSCLI after THEN and ELSE", () => {
        checkTokens(
            [
                "IF1THEN*H.",
                "IF1THE.*H.",
                "IF1TH.*H.",
                "\xe71\u018c*H.",
                "IF0ELSE*H.",
                "IF0ELS.*H.",
                "IF0EL.*H.",
                "\xe70\u018b*H.",
                "ONERROR*H.",
                "ONERRO.*H.",
                "ONERR.*H.",
                "\xee\u0185*H.",
            ],
            [
                {offset: 0, type: "keyword"},
                {offset: 2, type: "number"},
                {offset: 3, type: "keyword"},
                {offset: 7, type: "keyword.oscli.string"},
            ],
            [
                {offset: 0, type: "keyword"},
                {offset: 2, type: "number"},
                {offset: 3, type: "keyword"},
                {offset: 7, type: "keyword.oscli.string"},
            ],
            [
                {offset: 0, type: "keyword"},
                {offset: 2, type: "number"},
                {offset: 3, type: "keyword"},
                {offset: 6, type: "keyword.oscli.string"},
            ],
            [
                {offset: 0, type: "keyword"},
                {offset: 1, type: "number"},
                {offset: 2, type: "keyword"},
                {offset: 3, type: "keyword.oscli.string"},
            ],
            [
                {offset: 0, type: "keyword"},
                {offset: 2, type: "number"},
                {offset: 3, type: "keyword"},
                {offset: 7, type: "keyword.oscli.string"},
            ],
            [
                {offset: 0, type: "keyword"},
                {offset: 2, type: "number"},
                {offset: 3, type: "keyword"},
                {offset: 7, type: "keyword.oscli.string"},
            ],
            [
                {offset: 0, type: "keyword"},
                {offset: 2, type: "number"},
                {offset: 3, type: "keyword"},
                {offset: 6, type: "keyword.oscli.string"},
            ],
            [
                {offset: 0, type: "keyword"},
                {offset: 1, type: "number"},
                {offset: 2, type: "keyword"},
                {offset: 3, type: "keyword.oscli.string"},
            ],
            [
                {offset: 0, type: "keyword"},
                {offset: 7, type: "keyword.oscli.string"},
            ],
            [
                {offset: 0, type: "keyword"},
                {offset: 7, type: "keyword.oscli.string"},
            ],
            [
                {offset: 0, type: "keyword"},
                {offset: 6, type: "keyword.oscli.string"},
            ],
            [
                {offset: 0, type: "keyword"},
                {offset: 2, type: "keyword.oscli.string"},
            ],
        );
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
            // PTR, PAGE and TIME as functions (tokens &8F, &90, &91) cannot start a statement, their statement forms can.
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
        for (const [text, invalid] of cases) {
            assert.deepStrictEqual(spans(text, "invalid"), invalid, text);
        }
    });
    it("should read a number after THEN or ELSE as a line number, but not after ERROR", () => {
        assert.deepStrictEqual(spans("IF A THEN 30 ELSE 40", "constant.linenum"), ["30", "40"]);
        assert.deepStrictEqual(spans("IF A TH.30 EL.40", "constant.linenum"), ["30", "40"]);
        for (const text of ["ON ERROR 30", 'ERROR 5,"x"', "ON ERR. 30", "\xee\u0185 30"]) {
            assert.deepStrictEqual(spans(text, "constant.linenum"), [], text);
            assert.deepStrictEqual(spans(text, "number"), [text.match(/\d+/)[0]], text);
        }
    });
    it("should highlight invalid operators from other languages", () => {
        checkTokens(
            ["INVALID=1==2OR8!=2**3", "IFA><1ORB=<2ORB=>6GOTO10", "A+=2", "A=B<<C OR D>>E"],
            [
                {offset: 0, type: "variable"},
                {offset: 7, type: "operator"},
                {offset: 8, type: "number"},
                {offset: 9, type: "invalid"},
                {offset: 11, type: "number"},
                {offset: 12, type: "keyword"},
                {offset: 14, type: "number"},
                {offset: 15, type: "invalid"},
                {offset: 17, type: "number"},
                {offset: 18, type: "invalid"},
                {offset: 20, type: "number"},
            ],
            [
                {offset: 0, type: "keyword"},
                {offset: 2, type: "variable"},
                {offset: 3, type: "invalid"},
                {offset: 5, type: "number"},
                {offset: 6, type: "keyword"},
                {offset: 8, type: "variable"},
                {offset: 9, type: "invalid"},
                {offset: 11, type: "number"},
                {offset: 12, type: "keyword"},
                {offset: 14, type: "variable"},
                {offset: 15, type: "invalid"},
                {offset: 17, type: "number"},
                {offset: 18, type: "keyword"},
                {offset: 22, type: "number"},
            ],
            [
                {offset: 0, type: "variable"},
                {offset: 1, type: "invalid"},
                {offset: 3, type: "number"},
            ],
            [
                {offset: 0, type: "variable"},
                {offset: 1, type: "operator"},
                {offset: 2, type: "variable"},
                {offset: 3, type: "invalid"},
                {offset: 5, type: "variable"},
                {offset: 6, type: "white"},
                {offset: 7, type: "keyword"},
                {offset: 9, type: "white"},
                {offset: 10, type: "variable"},
                {offset: 11, type: "invalid"},
                {offset: 13, type: "variable"},
            ],
        );
    });
});

function checkWarnings(text, ...expected) {
    const warnings = getWarnings(1, text, editor.tokenize(text, "BBCBASIC")[0]);
    assert.deepStrictEqual(
        warnings,
        expected.map(x =>
            Object.assign({}, x, {
                startLineNumber: 1,
                endLineNumber: 1,
                severity: MarkerSeverity.Warning,
            }),
        ),
    );
}

describe("Bracket matching", () => {
    registerBbcBasicLanguage();
    // Returns [startColumn, endColumn, isInvalid] for each bracket Monaco finds on a single line.
    function brackets(text) {
        const model = editor.createModel(text, "BBCBASIC");
        try {
            model.tokenization.forceTokenization(1);
            return model.bracketPairs
                .getBracketsInRange(new Range(1, 1, 1, text.length + 1))
                .toArray()
                .map(b => [b.range.startColumn, b.range.endColumn, b.isInvalid]);
        } finally {
            model.dispose();
        }
    }
    it("should pair plain brackets", () => {
        assert.deepStrictEqual(brackets("P.(1+2)"), [
            [3, 4, false],
            [7, 8, false],
        ]);
    });
    it("should pair each ) with its (, including the hidden ( of keywords, abbreviations and tokens", () => {
        const hidden = ["RIGHT$(", "RIGHT$.", "RI.", "LE.", "MI.", "MID$(", "TAB(", "POINT(", "STRING$("];
        const tokens = [0x18a, 0xa7, 0xc0, 0xc1, 0xb0, 0xc2, 0xc4].map(token => String.fromCodePoint(token));
        const cases = [
            ...[...hidden, ...tokens].map(keyword => [`P.${keyword}A$,1)`, []]),
            ['A$="OWLET":P.RI.A$,1)LE.A$,2)MI.A$,4,1)MI.A$,3,1)', []], // #114
            ["P.(1+2))", [8]],
            ["P.RI.A$,1))", [11]],
            ["P.RIGHT$(A$,1))", [15]],
            ["PRI.A$,1)", [9]], // PRI. is PRINT, not RIGHT$(
        ];
        for (const [text, unbalanced] of cases) {
            assert.deepStrictEqual(brackets(text).filter(b => b[2]).map(b => b[0]), unbalanced, text);
        }
    });
    it("should ignore brackets in strings, comments and * commands", () => {
        for (const text of ['P."RI.A$,1)"', "REM RI.A$,1)", "*FX 1)", "10 *RUN RI.("]) {
            assert.deepStrictEqual(brackets(text), [], text);
        }
    });
});

describe("Line warnings", () => {
    it("should not generate warnings on lines that are fine", () => {
        checkWarnings("COLOUR 123");
        checkWarnings('P."I am a mongoose"');
        checkWarnings("colour%=123");
        checkWarnings("colour$=a$");
        // A variable that merely starts with a keyword is fine: only a whole lower-case keyword is suspicious.
        for (const name of ["radius%", "order%", "cosang", "sinang", "colour3", "printer$", "print_x"]) {
            checkWarnings(`${name}=1`);
        }
        checkWarnings("H. TO");
        checkWarnings("P.TO");
        checkWarnings("A=H.");
    });
    it("should warn on suspicious variable names", () => {
        checkWarnings("colour", {
            message: "BASIC keywords should be upper case, did you mean COLOUR?",
            startColumn: 1,
            endColumn: 7,
        });
        checkWarnings("chr$", {
            message: "BASIC keywords should be upper case, did you mean CHR$?",
            startColumn: 1,
            endColumn: 5,
        });
        checkWarnings('print"hi"', {
            message: "BASIC keywords should be upper case, did you mean PRINT?",
            startColumn: 1,
            endColumn: 6,
        });
        // A name ends at a `$`, and a keyword ends at its bracket, so whatever follows them is not part of the name.
        checkWarnings("A=left$(B$,1)", {
            message: "BASIC keywords should be upper case, did you mean LEFT$(?",
            startColumn: 3,
            endColumn: 9,
        });
        checkWarnings("P.chr$65", {
            message: "BASIC keywords should be upper case, did you mean CHR$?",
            startColumn: 3,
            endColumn: 7,
        });
        checkWarnings("A$=inkey$0", {
            message: "BASIC keywords should be upper case, did you mean INKEY$?",
            startColumn: 4,
            endColumn: 10,
        });
        checkWarnings("A=len(B$)", {
            message: "BASIC keywords should be upper case, did you mean LEN?",
            startColumn: 3,
            endColumn: 6,
        });
        // The whole name is a keyword when something that cannot be part of a name follows it.
        for (const follower of [",", ":", ";", " ", "."]) {
            checkWarnings(`print${follower}`, {
                message: "BASIC keywords should be upper case, did you mean PRINT?",
                startColumn: 1,
                endColumn: 6,
            });
        }
        // Both GET and GET$ are tokens - check that doesn't trip us up.
        checkWarnings("A$=get$", {
            message: "BASIC keywords should be upper case, did you mean GET$?",
            startColumn: 4,
            endColumn: 8,
        });
    });
    it("should not generate case warnings for variables matching immediate commands", () => {
        checkWarnings("old=new");
        checkWarnings("auto=delete+load/list+renumber*save");
    });
    it("should warn on invalid operators from other languages", () => {
        checkWarnings("==", {
            message: "== is not a BBC BASIC operator, did you mean =?",
            startColumn: 1,
            endColumn: 3,
        });
        checkWarnings("!=", {
            message: "!= is not a BBC BASIC operator, did you mean <>?",
            startColumn: 1,
            endColumn: 3,
        });
        checkWarnings("A=2**3", {
            message: "** is not a BBC BASIC operator, did you mean ^?",
            startColumn: 4,
            endColumn: 6,
        });
        checkWarnings("><", {
            message: ">< is not a BBC BASIC operator, did you mean <>?",
            startColumn: 1,
            endColumn: 3,
        });
        checkWarnings("=<", {
            message: "=< is not a BBC BASIC operator, did you mean <=?",
            startColumn: 1,
            endColumn: 3,
        });
        checkWarnings("=>", {
            message: "=> is not a BBC BASIC operator, did you mean >=?",
            startColumn: 1,
            endColumn: 3,
        });
    });
    it("should suggest a space after an abbreviation that is followed by letters", () => {
        checkWarnings("H.TO", {
            message:
                'H. is not read as an abbreviation when followed directly by letters or digits, did you mean "H. TO"?',
            code: "space-after-abbreviation",
            startColumn: 1,
            endColumn: 5,
        });
        checkWarnings("F.A=1 TO H.TO8", {
            message:
                'H. is not read as an abbreviation when followed directly by letters or digits, did you mean "H. TO8"?',
            code: "space-after-abbreviation",
            startColumn: 10,
            endColumn: 15,
        });
    });
});

describe("Quick fixes", () => {
    afterEach(() => vi.restoreAllMocks());

    // Registers the language again to capture the code action provider, then applies the first quick fix for the
    // line's first warning and returns the line as the edit leaves it.
    function applyQuickFix(text) {
        const register = vi.spyOn(languages, "registerCodeActionProvider");
        registerBbcBasicLanguage();
        const provider = register.mock.calls[0][1];
        const model = editor.createModel(text, "BBCBASIC");
        try {
            const markers = getWarnings(1, text, editor.tokenize(text, "BBCBASIC")[0]);
            const {actions} = provider.provideCodeActions(model, markers[0], {markers});
            const {title, edit} = actions[0];
            const {range, text: inserted} = edit.edits[0].textEdit;
            const start = range.startColumn - 1;
            const end = range.endColumn - 1;
            return {title, result: text.slice(0, start) + inserted + text.slice(end)};
        } finally {
            model.dispose();
        }
    }

    it("should insert a space after the abbreviation", () => {
        assert.deepStrictEqual(applyQuickFix("H.TO"), {title: "Insert a space after H.", result: "H. TO"});
        assert.deepStrictEqual(applyQuickFix("F.A=1 TO H.TO8"), {
            title: "Insert a space after H.",
            result: "F.A=1 TO H. TO8",
        });
    });
    it("should still offer the upper-case fix for keywords typed in lower case", () => {
        assert.deepStrictEqual(applyQuickFix("colour"), {title: "Replace with COLOUR", result: "COLOUR"});
    });
});

describe("Numbers with an empty exponent", () => {
    registerBbcBasicLanguage();
    const invalidTokens = text =>
        editor
            .tokenize(text, "BBCBASIC")
            .flat()
            .filter(t => t.type.startsWith("invalid")).length;
    it("are numbers followed by a new list item, not an abbreviation", () => {
        // The ROM reads "1E" as a number and ".5" or ".X" as the next item.
        for (const text of ["PRINT 1E.5", "VDU 1E.5", "P.1E.X", "PRINT 1.5E.5 +1", "PRINT 5.E.5:", "PRINT 1E.5ERL"])
            assert.strictEqual(invalidTokens(text), 0, text);
    });
    it("leave the neighbouring cases as they were", () => {
        for (const text of ["PRINT 1E+.5", "PRINT 1E .5", "PRINT 1E5", "P.X.", "PRINT X."])
            assert.strictEqual(invalidTokens(text), 0, text);
        for (const text of ["X=Y.5", "X=Y."]) assert.strictEqual(invalidTokens(text), 1, text);
    });
});

describe("Abbreviated $ tokens", () => {
    registerBbcBasicLanguage();
    it("need a literal dot", () => {
        for (const text of ["A$=LEFT$A$", "A$=MID$X"]) {
            const types = editor.tokenize(text, "BBCBASIC")[0].map(t => t.type.replace(".BBCBASIC", ""));
            assert.ok(!types.includes("keyword"), `${text}: ${types}`);
        }
    });
});

describe("Assembler comments and expressions", () => {
    registerBbcBasicLanguage();
    const invalidTokens = text =>
        editor
            .tokenize(text, "BBCBASIC")
            .flat()
            .filter(t => t.type.startsWith("invalid")).length;
    it("treat a ; comment as text up to the next colon, whatever it says", () => {
        for (const comment of ["LOAD THE ACCUMULATOR", "END OF LOOP", "the FOR loop", "IF EQUAL THEN BRANCH", '"x', "]"])
            assert.strictEqual(invalidTokens(`[OPT3:LDA #1 ; ${comment}:]`), 0, comment);
    });
    it("find the comment after an index, a label or on a later line", () => {
        for (const text of ["[LDA &70,X ; LOAD THE", "[.l LDA #1 ; if x", "[NOP\nRTS ; END OF LOOP", "[EQUB 1 ; FOR"])
            assert.strictEqual(invalidTokens(text), 0, text);
    });
    it("start each line as a new statement, where ; is not a comment", () => {
        checkTokens(
            ["[NOP ; a", ";notacomment"],
            [
                {offset: 0, type: "delimiter.square"},
                {offset: 1, type: "keyword"},
                {offset: 4, type: "white"},
                {offset: 5, type: "comment"},
            ],
            [
                {offset: 0, type: "operator"},
                {offset: 1, type: "variable"},
            ],
        );
    });
    it("end a comment at the colon", () => {
        assert.strictEqual(invalidTokens("[OPT3:LDA #1 ; fine:FOR:]"), 1);
    });
    it("allow STR$~ in an expression", () => {
        for (const text of ["[OPT3:EQUS STR$~(255):]", "[OPT3:EQUB ASC(STR$~A%):]"])
            assert.strictEqual(invalidTokens(text), 0, text);
        assert.strictEqual(invalidTokens("[OPT3:EQUS STR$~~(255):]"), 1);
    });
});

describe("A * command after REPEAT", () => {
    registerBbcBasicLanguage();
    const types = text => editor.tokenize(text, "BBCBASIC")[0].map(t => t.type.replace(".BBCBASIC", ""));
    it("is a command, whatever it says", () => {
        for (const text of [
            "REPEAT *|",
            "REPEAT **",
            "REPEAT *FX 0",
            "REP. *|",
            "REPEA.*|",
            "\xf5 *|",
        ])
            assert.ok(types(text).includes("keyword.oscli.string"), text);
        for (const text of ["REPEAT *|", "REP. *|", "REPEA.*|", "\xf5 *|"])
            assert.ok(!types(text).some(type => type.startsWith("invalid")), text);
    });
    it("leaves the neighbouring cases alone", () => {
        assert.ok(!types("REPEAT X=X+1").some(type => type.startsWith("invalid")));
    });
});

describe("Bracket matching of raw token characters", () => {
    registerBbcBasicLanguage();
    const invalidBrackets = text => {
        const model = editor.createModel(text, "BBCBASIC");
        try {
            model.tokenization.forceTokenization(model.getLineCount());
            return model.bracketPairs
                .getBracketsInRange(model.getFullModelRange())
                .toArray()
                .filter(bracket => bracket.isInvalid).length;
        } finally {
            model.dispose();
        }
    };
    // The editor shows tokens below &A0 as U+0100 and up, and the rest as themselves.
    const tokenChar = kw => String.fromCodePoint(kw.token < 0xa0 ? kw.token + 0x100 : kw.token);
    const openers = keywords.filter(kw => kw.keyword.endsWith("(")).map(tokenChar);
    const tokenChars = keywords.map(tokenChar);
    it("pairs a raw LEFT$( with its close", () => {
        for (const opener of openers) assert.strictEqual(invalidBrackets(`A$=${opener}A$,1)`), 0, opener);
    });
    it("never treats a raw token that is not an opener as a bracket", () => {
        for (const char of tokenChars.filter(char => !openers.includes(char))) {
            for (const text of [char, `PRINT ${char}`, `IFX ${char}`, `A=1:${char}:B=2`, `[\n${char}\n]`])
                assert.strictEqual(invalidBrackets(text), 0, `U+${char.codePointAt(0).toString(16)} in ${text}`);
        }
    });
    it("has a known limitation: an abbreviated opener straight after a keyword leaves its close unmatched", () => {
        // Monaco merges neighbouring same-coloured tokens, so its \b-guarded opener match fails in "PRINTLE.".
        assert.strictEqual(invalidBrackets("PRINTLE.A$,1)"), 1);
        assert.strictEqual(invalidBrackets("PRINT LE.A$,1)"), 0);
        assert.strictEqual(invalidBrackets("PRINTLEFT$(A$,1)"), 0);
        // A dot before the opener is a word boundary, so fully abbreviated code is fine, unless a keyword with no
        // abbreviation (LEN) comes first.
        assert.strictEqual(invalidBrackets("P.LE.A$,1)"), 0);
        assert.strictEqual(invalidBrackets("P.LENMI.A$,2)"), 1);
    });
    it("keeps the raw END token invalid in the assembler", () => {
        const types = editor.tokenize("[\nLDA #\u00e0\n]", "BBCBASIC")[1].map(t => t.type.replace(".BBCBASIC", ""));
        assert.strictEqual(types.at(-1), "invalid.string");
    });
});
