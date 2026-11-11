import {registerBbcBasicLanguage} from "../src/bbcbasic";
import {addChangeAllOccurrences, occurrencesAt, registerOccurrences} from "../src/occurrences";
import {describe, it, vi, afterEach} from "vitest";
import assert from "assert";
import {editor, languages} from "monaco-editor/esm/vs/editor/editor.api";

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

function replaceRanges(model, ranges, newText) {
    const edits = ranges.map(range => ({range, text: newText}));
    model.applyEdits(edits);
    return model.getValue();
}

// The text after every occurrence of the name at the cursor is replaced by newName; null if the cursor is not on one.
function changeAll(textWithCursor, newName) {
    const {text, position} = withCursor(textWithCursor);
    return withModel(text, model => {
        const ranges = occurrencesAt(model, position);
        return ranges && replaceRanges(model, ranges, newName);
    });
}

describe("Occurrences", () => {
    it("should change only the variable in Olly's example from #61", () => {
        assert.strictEqual(
            changeAll("F.F=F TOF S.F:READF$:F%=F*LENF$:P.F$,F%:N.\nD.‸F", "X"),
            null,
        );
        assert.strictEqual(
            changeAll("F.‸F=F TOF S.F:READF$:F%=F*LENF$:P.F$,F%:N.\nD.F", "X"),
            "F.X=X TOX S.X:READF$:F%=X*LENF$:P.F$,F%:N.\nD.F",
        );
    });

    it("should tell the kinds of name apart", () => {
        const cases = [
            ['A=1:A%=2:A$="A":A(1)=3:PRINT ‸A', 'X=1:A%=2:A$="A":A(1)=3:PRINT X'],
            ["‸A%=1:A=2:B%=A%", "X=1:A=2:B%=X"],
            ['A$="":PRINT ‸A$;A', 'X="":PRINT X;A'],
            ["DIM ‸A(3):A(1)=A:A%(1)=0", "DIM X(3):X(1)=A:A%(1)=0"],
            ["DEFPROC‸F:F=FNF:PROCF:ENDPROC", "DEFPROCX:F=FNF:PROCX:ENDPROC"],
            ["DEFFN‸F=F:P.FNF:PROCF", "DEFFNX=F:P.FNX:PROCF"],
            ["a=1:‸A=2:P.a", "a=1:X=2:P.a"],
            ["@%=10:P.‸@%", "X=10:P.X"],
        ];
        for (const [text, expected] of cases)
            assert.strictEqual(changeAll(text, "X"), expected, text);
    });

    it("should leave strings, REM, DATA and * commands alone", () => {
        assert.strictEqual(
            changeAll('READ ‸F:P."F";F:REM F\nDATA F,"F"\n*F', "X"),
            'READ X:P."F";X:REM F\nDATA F,"F"\n*F',
        );
    });

    it("should treat assembler labels as variables but not the accumulator", () => {
        assert.strictEqual(
            changeAll("[.‸loop LDA loop:ASL A:BNE loop\n]\nA=loop", "X"),
            "[.X LDA X:ASL A:BNE X\n]\nA=X",
        );
        assert.strictEqual(changeAll("‸A=1:[LDA A:ROL A:STA A]", "X"), "X=1:[LDA X:ROL A:STA X]");
    });

    it("should find the name with the cursor at either end", () => {
        assert.strictEqual(changeAll("10F=1\n20P.F‸", "X"), "10X=1\n20P.X");
        assert.strictEqual(changeAll("10‸FRED=1\n20P.FRED", "X"), "10X=1\n20P.X");
    });

    it("should find nothing off a name", () => {
        for (const text of ["‸PRINT F", "F=‸1", 'P."‸F":F=1', "REM ‸F", "F‸.I=1 TO 2"]) {
            assert.strictEqual(changeAll(text, "X"), null, text);
        }
    });

    // Monaco's word highlighter only asks for the occurrences where it finds a word.
    it("should make the whole name the word at the cursor", () => {
        for (const text of ["‸@%=1", "@‸%=1", "@%‸=1", "‸A%=1", "A‸%=1", "A%‸=1", "A$‸=1"]) {
            const {text: line, position} = withCursor(text);
            const word = withModel(line, model => model.getWordAtPosition(position)?.word);
            assert.strictEqual(word, line.split("=")[0], text);
        }
    });
});

describe("Rename", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    function renameProvider() {
        const register = vi.spyOn(languages, "registerRenameProvider");
        registerOccurrences();
        return register.mock.calls[0][1];
    }

    function rename(textWithCursor, newName) {
        const provider = renameProvider();
        const {text, position} = withCursor(textWithCursor);
        return withModel(text, model => {
            const {edits, rejectReason} = provider.provideRenameEdits(model, position, newName);
            if (rejectReason) return {rejectReason};
            return replaceRanges(
                model,
                edits.map(edit => edit.textEdit.range),
                newName,
            );
        });
    }

    it("should rename every occurrence", () => {
        assert.strictEqual(
            rename("F.‸F=F TOF S.F:READF$:F%=F*LENF$:P.F$,F%:N.\nD.F", "Fred"),
            "F.Fred=Fred TOFred S.Fred:READF$:F%=Fred*LENF$:P.F$,F%:N.\nD.F",
        );
        assert.strictEqual(rename("DEFPROC‸a:PROCa", "2nd"), "DEFPROC2nd:PROC2nd");
    });

    it("should refuse a name that would change the program's meaning", () => {
        const cases = [
            ["‸F=1", "PRINT", "PRINT is not a valid name for F"],
            ["‸F=1", "TOTAL", "TOTAL is not a valid name for F"],
            ["‸F=1", "A B", "A B is not a valid name for F"],
            ["‸F=1", "", " is not a valid name for F"],
            ["‸F=1", "F$", "Renaming F to F$ would change its type"],
            ["‸A=1:B=2", "B", "B is already used in this program"],
            ["DIM ‸A(1):B=2:DIM C(1)", "C", "C( is already used in this program"],
            ["PROC‸a:PROCb:b=FNa", "b", "PROCb is already used in this program"],
        ];
        for (const [text, newName, rejectReason] of cases) {
            assert.deepStrictEqual(rename(text, newName), {rejectReason}, text);
        }
        assert.strictEqual(rename("DIM ‸A(1):B=2", "B"), "DIM B(1):B=2");
    });

    it("should only offer to rename names", () => {
        const provider = renameProvider();
        withModel("PRINT F", model => {
            assert.strictEqual(
                provider.resolveRenameLocation(model, {lineNumber: 1, column: 2}).rejectReason,
                "Only variables, arrays, FNs and PROCs can be renamed",
            );
            assert.deepStrictEqual(
                provider.resolveRenameLocation(model, {lineNumber: 1, column: 7}),
                {
                    range: {startLineNumber: 1, startColumn: 7, endLineNumber: 1, endColumn: 8},
                    text: "F",
                },
            );
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
            assert.deepStrictEqual(
                codeEditor
                    .getSelections()
                    .map(s => [s.startLineNumber, s.startColumn, s.endColumn]),
                [
                    [1, 9, 10],
                    [1, 3, 4],
                    [1, 5, 6],
                ],
            );
        } finally {
            codeEditor.dispose();
            element.remove();
        }
    });
});
