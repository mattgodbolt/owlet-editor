import {getWarnings, registerBbcBasicLanguage} from "../src/bbcbasic";
import {describe, it} from "vitest";
import assert from "assert";
import {editor, MarkerSeverity} from "monaco-editor/esm/vs/editor/editor.api";

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
    it("should treat a non-abbreviation followed by a dot as a name and a number", () => {
        // See #85: this prints 10 as X. is X followed by the number ".".
        checkTokens(
            ["P.X.", "X=Y.5", "PRIT."],
            [
                {offset: 0, type: "keyword"},
                {offset: 2, type: "variable"},
                {offset: 3, type: "number.float"},
            ],
            [
                {offset: 0, type: "variable"},
                {offset: 1, type: "operator"},
                {offset: 2, type: "variable"},
                {offset: 3, type: "number.float"},
            ],
            [
                {offset: 0, type: "variable"},
                {offset: 4, type: "number.float"},
            ],
        );
    });
    it("should not treat BG as an abbreviation without the dot", () => {
        // BGET abbreviates to B., BG. and BGE. but plain BG is just a variable.
        checkTokens(
            ["BG=1", "BG%=2", "BG$=\"\"", "BG.#1"],
            [
                {offset: 0, type: "variable"},
                {offset: 2, type: "operator"},
                {offset: 3, type: "number"},
            ],
            [
                {offset: 0, type: "variable"},
                {offset: 3, type: "operator"},
                {offset: 4, type: "number"},
            ],
            [
                {offset: 0, type: "variable"},
                {offset: 3, type: "operator"},
                {offset: 4, type: "string.quote"},
            ],
            [
                {offset: 0, type: "keyword"},
                {offset: 3, type: "symbol"},
                {offset: 4, type: "number"},
            ],
        );
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
    it("should end an unterminated quote in DATA at the end of the line", () => {
        checkTokens(
            ['DATA "abc', "PRINT 1", 'D.1,"x', "A=2"],
            [
                {offset: 0, type: "keyword"},
                {offset: 4, type: "white"},
                {offset: 5, type: "string"},
            ],
            [
                {offset: 0, type: "keyword"},
                {offset: 5, type: "white"},
                {offset: 6, type: "number"},
            ],
            [
                {offset: 0, type: "keyword"},
                {offset: 2, type: "string.unquoted"},
                {offset: 3, type: "symbol"},
                {offset: 4, type: "string"},
            ],
            [
                {offset: 0, type: "variable"},
                {offset: 1, type: "operator"},
                {offset: 2, type: "number"},
            ],
        );
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
        assert.deepStrictEqual(spans("FOR I=1 AND TOP TO 2", "keyword"), ["FOR", "AND", "TOP", "TO"]);
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
        ];
        for (const [text, count] of valid) {
            assert.deepStrictEqual(spans(text, "invalid"), [], text);
            assert.strictEqual(spans(text, "operator").join("").split("~").length - 1, count, text);
        }
        const invalid = [
            "A=~B",
            "A$=STR$(~12)",
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
    it("should not let an unterminated string affect the next line", () => {
        checkTokens(
            ['A$="ABC', "10X=1", "*FX15"],
            [
                {offset: 0, type: "variable"},
                {offset: 2, type: "operator"},
                {offset: 3, type: "invalid.string"},
            ],
            [
                {offset: 0, type: "constant.linenum"},
                {offset: 2, type: "variable"},
                {offset: 3, type: "operator"},
                {offset: 4, type: "number"},
            ],
            [{offset: 0, type: "keyword.oscli"}],
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
    it("should reset to start of line after a keyword at the end of a line", () => {
        // A bare PRINT or INPUT must not leave the next line mid-statement.
        checkTokens(
            ["10PRINT", "20PRINT ", "30INPUT", "*FX15", "A=1"],
            [
                {offset: 0, type: "constant.linenum"},
                {offset: 2, type: "keyword"},
            ],
            [
                {offset: 0, type: "constant.linenum"},
                {offset: 2, type: "keyword"},
                {offset: 7, type: "white"},
            ],
            [
                {offset: 0, type: "constant.linenum"},
                {offset: 2, type: "keyword"},
            ],
            [{offset: 0, type: "keyword.oscli"}],
            [
                {offset: 0, type: "variable"},
                {offset: 1, type: "operator"},
                {offset: 2, type: "number"},
            ],
        );
    });
    it("should not let a PROC or FN with no name affect the next line", () => {
        checkTokens(
            ["PROC", "10X=1", "A=FN", "*FX15"],
            [{offset: 0, type: "keyword"}],
            [
                {offset: 0, type: "constant.linenum"},
                {offset: 2, type: "variable"},
                {offset: 3, type: "operator"},
                {offset: 4, type: "number"},
            ],
            [
                {offset: 0, type: "variable"},
                {offset: 1, type: "operator"},
                {offset: 2, type: "keyword"},
            ],
            [{offset: 0, type: "keyword.oscli"}],
        );
    });
    it("should handle OSCLI at start of line", () => {
        checkTokens(["*INFO"], [{offset: 0, type: "keyword.oscli"}]);
    });
    it("should handle OSCLI after line number", () => {
        checkTokens(
            ["10 *INFO"],
            [
                {offset: 0, type: "constant.linenum"},
                {offset: 2, type: "white"},
                {offset: 3, type: "keyword.oscli"},
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
                {offset: 6, type: "keyword.oscli"},
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
                {offset: 7, type: "keyword.oscli"},
            ],
            [
                {offset: 0, type: "keyword"},
                {offset: 2, type: "number"},
                {offset: 3, type: "keyword"},
                {offset: 7, type: "keyword.oscli"},
            ],
            [
                {offset: 0, type: "keyword"},
                {offset: 2, type: "number"},
                {offset: 3, type: "keyword"},
                {offset: 6, type: "keyword.oscli"},
            ],
            [
                {offset: 0, type: "keyword"},
                {offset: 1, type: "number"},
                {offset: 2, type: "keyword"},
                {offset: 3, type: "keyword.oscli"},
            ],
            [
                {offset: 0, type: "keyword"},
                {offset: 2, type: "number"},
                {offset: 3, type: "keyword"},
                {offset: 7, type: "keyword.oscli"},
            ],
            [
                {offset: 0, type: "keyword"},
                {offset: 2, type: "number"},
                {offset: 3, type: "keyword"},
                {offset: 7, type: "keyword.oscli"},
            ],
            [
                {offset: 0, type: "keyword"},
                {offset: 2, type: "number"},
                {offset: 3, type: "keyword"},
                {offset: 6, type: "keyword.oscli"},
            ],
            [
                {offset: 0, type: "keyword"},
                {offset: 1, type: "number"},
                {offset: 2, type: "keyword"},
                {offset: 3, type: "keyword.oscli"},
            ],
            [
                {offset: 0, type: "keyword"},
                {offset: 7, type: "keyword.oscli"},
            ],
            [
                {offset: 0, type: "keyword"},
                {offset: 7, type: "keyword.oscli"},
            ],
            [
                {offset: 0, type: "keyword"},
                {offset: 6, type: "keyword.oscli"},
            ],
            [
                {offset: 0, type: "keyword"},
                {offset: 2, type: "keyword.oscli"},
            ],
        );
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

describe("Line warnings", () => {
    it("should not generate warnings on lines that are fine", () => {
        checkWarnings("COLOUR 123");
        checkWarnings('P."I am a mongoose"');
        checkWarnings("colour%=123");
        checkWarnings("colour$=a$");
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
});
