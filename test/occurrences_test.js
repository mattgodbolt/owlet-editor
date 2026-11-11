import {registerBbcBasicLanguage} from "../src/bbcbasic";
import {addChangeAllOccurrences, occurrencesAt, renameProvider} from "../src/occurrences";
import {describe, it, vi, afterEach} from "vitest";
import assert from "assert";
import {editor} from "monaco-editor/esm/vs/editor/editor.api";

registerBbcBasicLanguage();

const Cursor = "‸";

// Places the cursor where the text has a "‸", and returns the cursor's position and the text without it.
function withCursor(textWithCursor) {
    const lines = textWithCursor.split("\n");
    const lineIndex = lines.findIndex(line => line.includes(Cursor));
    return {
        text: textWithCursor.replace(Cursor, ""),
        position: {lineNumber: lineIndex + 1, column: lines[lineIndex].indexOf(Cursor) + 1},
    };
}

function withModel(text, fn) {
    const model = editor.createModel(text, "BBCBASIC");
    try {
        return fn(model);
    } finally {
        model.dispose();
    }
}

function at(textWithCursor, fn) {
    const {text, position} = withCursor(textWithCursor);
    return withModel(text, model => fn(model, position));
}

// Replaces what find finds at the cursor with newText; what find returns if it is not a list of ranges.
function replaceAll(textWithCursor, newText, find) {
    return at(textWithCursor, (model, position) => {
        const found = find(model, position);
        if (!Array.isArray(found)) return found;
        model.applyEdits(found.map(range => ({range, text: newText})));
        return model.getValue();
    });
}

function rename(textWithCursor, newName) {
    return replaceAll(textWithCursor, newName, (model, position) => {
        const {edits, rejectReason} = renameProvider.provideRenameEdits(model, position, newName);
        return rejectReason ? {rejectReason} : edits.map(edit => edit.textEdit.range);
    });
}

describe("Occurrences", () => {
    it("should find the occurrences of the name at the cursor", () => {
        const cases = [
            // Olly's example from #61.
            ["F.F=F TOF S.F:READF$:F%=F*LENF$:P.F$,F%:N.\nD.‸F", null],
            [
                "F.‸F=F TOF S.F:READF$:F%=F*LENF$:P.F$,F%:N.\nD.F",
                "F.X=X TOX S.X:READF$:F%=X*LENF$:P.F$,F%:N.\nD.F",
            ],
            ['A=1:A%=2:A$="A":A(1)=3:PRINT ‸A', 'X=1:A%=2:A$="A":A(1)=3:PRINT X'],
            ["‸A%=1:A=2:B%=A%", "X=1:A=2:B%=X"],
            ['A$="":PRINT ‸A$;A', 'X="":PRINT X;A'],
            ["DIM ‸A(3):A(1)=A:A%(1)=0", "DIM X(3):X(1)=A:A%(1)=0"],
            ["DEFPROC‸F:F=FNF:PROCF:\xf2F:PRO.F", "DEFPROCX:F=FNF:PROCX:\xf2X:PRO.X"],
            ["DEFFN‸F=F:P.FNF+\xa4F:PROCF", "DEFFNX=F:P.FNX+\xa4X:PROCF"],
            ["‸F=\xa4F:\xf2F:PRO.F", "X=\xa4F:\xf2F:PRO.F"],
            ["‸A%=1:P.A%B", "X=1:P.XB"],
            ["a=1:‸A=2:P.a", "a=1:X=2:P.a"],
            ["@%=10:P.‸@%", "X=10:P.X"],
            ['READ ‸F:P."F";F:REM F\nDATA F,"F"\n*F', 'READ X:P."F";X:REM F\nDATA F,"F"\n*F'],
            ["[.‸loop LDA loop:ASL A:BNE loop\n]\nA=loop", "[.X LDA X:ASL A:BNE X\n]\nA=X"],
            ["‸A=1:[LDA A:ROL A:STA A]", "X=1:[LDA X:ROL A:STA X]"],
            ["10F=1\n20P.F‸", "10X=1\n20P.X"],
            ["10‸FRED=1\n20P.FRED", "10X=1\n20P.X"],
            ["‸PRINT F", null],
            ["F=‸1", null],
            ['P."‸F":F=1', null],
            ["REM ‸F", null],
            ["F‸.I=1 TO 2", null],
        ];
        for (const [text, expected] of cases)
            assert.strictEqual(replaceAll(text, "X", occurrencesAt), expected, text);
    });

    // Monaco's word highlighter only asks for the occurrences where it finds a word.
    it("should make the whole name the word at the cursor", () => {
        for (const text of ["‸@%=1", "@‸%=1", "@%‸=1", "‸A%=1", "A‸%=1", "A%‸=1", "A$‸=1"]) {
            const word = at(text, (model, position) => model.getWordAtPosition(position)?.word);
            assert.strictEqual(word, text.replace(Cursor, "").split("=")[0], text);
        }
    });
});

describe("Rename", () => {
    it("should rename every occurrence", () => {
        assert.strictEqual(rename("DEFPROC‸a:PROCa", "2nd"), "DEFPROC2nd:PROC2nd");
        assert.strictEqual(rename("DIM ‸A(1):B=2", "B"), "DIM B(1):B=2");
    });

    it("should refuse a name that would change the program's meaning", () => {
        const cases = [
            ["‸F=1", "PRINT", "PRINT is not a valid name for F"],
            ["‸F=1", "TOTAL", "TOTAL is not a valid name for F"],
            ["‸F=1", "A B", "A B is not a valid name for F"],
            ["‸F=1", "", " is not a valid name for F"],
            ["‸F=1", "F$", "Renaming F to F$ would change its type"],
            ["‸F%=1", "@%", "Renaming F% to @% would change how numbers are printed"],
            ["‸@%=1", "F%", "Renaming @% to F% would change how numbers are printed"],
            ["‸A=1:B=2", "B", "B is already used in this program"],
            ["DIM ‸A(1):B=2:DIM C(1)", "C", "C( is already used in this program"],
            ["PROC‸a:PROCb:b=FNa", "b", "PROCb is already used in this program"],
        ];
        for (const [text, newName, rejectReason] of cases) {
            assert.deepStrictEqual(rename(text, newName), {rejectReason}, text);
        }
    });

    it("should only offer to rename names", () => {
        assert.deepStrictEqual(at("P‸RINT F", renameProvider.resolveRenameLocation), {
            range: null,
            text: "",
            rejectReason: "Only variables, arrays, FNs and PROCs can be renamed",
        });
        assert.deepStrictEqual(at("PRINT ‸F", renameProvider.resolveRenameLocation), {
            range: {startLineNumber: 1, startColumn: 7, endLineNumber: 1, endColumn: 8},
            text: "F",
        });
    });
});

describe("Change All Occurrences", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("should select the occurrences of the name at the cursor", () => {
        // jsdom has no canvas, which the editor measures its font with.
        vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
            measureText: () => ({width: 8}),
        });
        const element = document.body.appendChild(document.createElement("div"));
        const codeEditor = editor.create(element, {
            value: "F.F=F TOF:P.F$\nD.F",
            language: "BBCBASIC",
            // The word highlighter's pending update would be cancelled, and reported, by the disposal.
            occurrencesHighlight: "off",
        });
        try {
            addChangeAllOccurrences(codeEditor);
            codeEditor.setPosition({lineNumber: 1, column: 9});
            codeEditor.trigger("test", "change-all-occurrences");
            const selections = codeEditor
                .getSelections()
                .map(s => `${s.startColumn}-${s.endColumn}`);
            assert.deepStrictEqual(selections, ["9-10", "3-4", "5-6"]);
        } finally {
            codeEditor.dispose();
            element.remove();
        }
    });
});
