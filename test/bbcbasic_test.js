import {registerBbcBasicLanguage} from "../src/bbcbasic";
import {assert} from "chai";
import {editor} from "monaco-editor/esm/vs/editor/editor.api";

function checkTokens(text, ...expected) {
    const tokenized = editor.tokenize(text.join("\n"), "BBCBASIC").map(line =>
        line.map(t => ({
            offset: t.offset,
            type: t.type.replace(".BBCBASIC", ""),
        }))
    );
    assert.deepStrictEqual(tokenized, [...expected]);
}

describe("should tokenise", () => {
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
            ]
        );
    });
    it("should work with assignments", () => {
        checkTokens(
            ["N=1"],
            [
                {offset: 0, type: "variable"},
                {offset: 1, type: "operator"},
                {offset: 2, type: "number"},
            ]
        );
        checkTokens(
            ["N%=1"],
            [
                {offset: 0, type: "variable"},
                {offset: 2, type: "operator"},
                {offset: 3, type: "number"},
            ]
        );
        checkTokens(
            ["N$=1"],
            [
                {offset: 0, type: "variable"},
                {offset: 2, type: "operator"},
                {offset: 3, type: "number"},
            ]
        );
        checkTokens(
            ["N$ = 1"],
            [
                {offset: 0, type: "variable"},
                {offset: 2, type: "white"},
                {offset: 3, type: "operator"},
                {offset: 4, type: "white"},
                {offset: 5, type: "number"},
            ]
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
                ]
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
            ]
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
    it("should not recognize bad abbreviations", () => {
        checkTokens(["Z."], [{offset: 0, type: "invalid"}]);
        checkTokens(["PRIT."], [{offset: 0, type: "invalid"}]);
    });
    it("should not recognize 6502 outside of []", () => {
        checkTokens(["LDA"], [{offset: 0, type: "variable"}]);
    });
    it("should recognize 6502 inside []", () => {
        checkTokens(
            ["[", "LDA"],
            [{offset: 0, type: "delimiter.square"}],
            [{offset: 0, type: "keyword"}]
        );
        checkTokens(
            ["[LDA"],
            [
                {offset: 0, type: "delimiter.square"},
                {offset: 1, type: "keyword"},
            ]
        );
        checkTokens(
            ["[", "OPTN%"],
            [{offset: 0, type: "delimiter.square"}],
            [
                {offset: 0, type: "keyword.directive"},
                {offset: 3, type: "variable"},
            ]
        );
        checkTokens(
            ["[", "EQUB LENA$"],
            [{offset: 0, type: "delimiter.square"}],
            [
                {offset: 0, type: "keyword.directive"},
                {offset: 4, type: "white"},
                {offset: 5, type: "keyword"},
                {offset: 8, type: "variable"},
            ]
        );
    });
    it("should notice REM statements", () => {
        checkTokens(
            ["REM this is a comment"],
            [
                {offset: 0, type: "keyword"},
                {offset: 3, type: "comment"},
            ]
        );
        checkTokens(
            ["REM this is a comment and has PRINT in it"],
            [
                {offset: 0, type: "keyword"},
                {offset: 3, type: "comment"},
            ]
        );
        checkTokens(
            ["REM this is a comment doesn't ends at a colon:PRINT"],
            [
                {offset: 0, type: "keyword"},
                {offset: 3, type: "comment"},
            ]
        );
        checkTokens(
            ["REMthis is also a comment"],
            [
                {offset: 0, type: "keyword"},
                {offset: 3, type: "comment"},
            ]
        );
        checkTokens(
            ["REM", "PRINT"],
            [{offset: 0, type: "keyword"}],
            [{offset: 0, type: "keyword"}]
        );
    });
    it("should handle symbols and operators", () => {
        checkTokens(["~"], [{offset: 0, type: "operator"}]);
        checkTokens(["#"], [{offset: 0, type: "symbol"}]);
        checkTokens(["!"], [{offset: 0, type: "operator"}]);
        checkTokens([":"], [{offset: 0, type: "symbol"}]);
        checkTokens(["="], [{offset: 0, type: "operator"}]);
        checkTokens(["^"], [{offset: 0, type: "operator"}]);
        checkTokens(["'"], [{offset: 0, type: "operator"}]);
    });
});
