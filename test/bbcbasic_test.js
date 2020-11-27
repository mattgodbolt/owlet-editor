import {registerBbcBasicLanguage} from "../src/bbcbasic";
import {assert} from "chai";
import {editor} from 'monaco-editor/esm/vs/editor/editor.api';

function checkTokens(text, ...expected) {
    const tokenized = editor.tokenize(text.join("\n"), 'BBCBASIC')
        .map(line => line.map(t => ({offset: t.offset, type: t.type.replace(".BBCBASIC", "")})));
    assert.deepStrictEqual(tokenized, [...expected]);
}

describe('should tokenise', () => {
    registerBbcBasicLanguage();
    it('should recognise simple tokens', () => {
        checkTokens(["PRINT"], [{offset: 0, type: "keyword"}]);
        checkTokens(["CALL"], [{offset: 0, type: "keyword"}]);
        checkTokens(["RESTORE"], [{offset: 0, type: "keyword"}]);
    });
    it('should work with assignments', () => {
        checkTokens(["N=1"], [
            {offset: 0, type: "variable"},
            {offset: 1, type: "operator"},
            {offset: 2, type: "number"},
        ]);
        checkTokens(["N%=1"], [
            {offset: 0, type: "variable"},
            {offset: 2, type: "operator"},
            {offset: 3, type: "number"},
        ]);
        checkTokens(["N$=1"], [
            {offset: 0, type: "variable"},
            {offset: 2, type: "operator"},
            {offset: 3, type: "number"},
        ]);
        checkTokens(["N$ = 1"], [
            {offset: 0, type: "variable"},
            {offset: 2, type: "white"},
            {offset: 3, type: "operator"},
            {offset: 4, type: "white"},
            {offset: 5, type: "number"},
        ]);
    });
    it('should recognise abbreviations', () => {
        checkTokens(["P."], [{offset: 0, type: "keyword"}]);
        checkTokens(["C."], [{offset: 0, type: "keyword"}]);
        checkTokens(["R."], [{offset: 0, type: "keyword"}]);
    });
    // it('should not recognize bad abbreviations', () => {
    //     checkTokens(["ZZ."], [{offset: 0, type: "keyword"}]);
    // });
});