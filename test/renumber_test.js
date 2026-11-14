import {registerBbcBasicLanguage} from "../src/bbcbasic";
import {followImplicitLineNumbers, lineNumberReferences, renumberReferences} from "../src/renumber";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {editor} from "monaco-editor/esm/vs/editor/editor.api";

registerBbcBasicLanguage();

describe("renumberReferences", () => {
    const oldToNew = new Map([
        [10, 100],
        [20, 200],
        [30, 300],
    ]);
    it("should rewrite every line number the program refers to, and nothing else", () => {
        const cases = [
            ["GOTO 30:GOSUB 20:G.10:GOS.20:\xe530", "GOTO 300:GOSUB 200:G.100:GOS.200:\xe5300"],
            ["IF X THEN 10 ELSE 20:IFX TH.10 EL.20", "IF X THEN 100 ELSE 200:IFX TH.100 EL.200"],
            ["ON X GOTO 10, 20 ,30 ELSE 10", "ON X GOTO 100, 200 ,300 ELSE 100"],
            ["ON X GOSUB 10,X,20", "ON X GOSUB 100,X,20"],
            ["ON ERROR GOTO 20:RESTORE 30:TRACE 10", "ON ERROR GOTO 200:RESTORE 300:TRACE 100"],
            ["GOTO 10*2:GOTO A%*10:GOTO (10)", "GOTO 100*2:GOTO A%*10:GOTO (10)"],
            ["GOTO 40:GOTO 15:GOTO 010", "GOTO 40:GOTO 15:GOTO 100"],
            ['PRINT "GOTO 10";10:REM GOTO 10', 'PRINT "GOTO 10";10:REM GOTO 10'],
            ["DATA GOTO 10\n*FX 10\nREPEAT 10", "DATA GOTO 10\n*FX 10\nREPEAT 10"],
            ["[JMP 10\n]\nGOTO 10", "[JMP 10\n]\nGOTO 100"],
            ["10 GOTO 20\n20 GOTO 10", "10 GOTO 200\n20 GOTO 100"],
        ];
        for (const [text, expected] of cases) {
            expect(renumberReferences(text, oldToNew), text).toBe(expected);
        }
    });

    it("should say where each reference is", () => {
        expect(lineNumberReferences("PRINT\nON X GOTO 10,200")).toEqual([
            {lineNumber: 2, startColumn: 11, endColumn: 13, target: 10},
            {lineNumber: 2, startColumn: 14, endColumn: 17, target: 200},
        ]);
    });
});

describe("followImplicitLineNumbers", () => {
    let element;
    let codeEditor;

    beforeEach(() => {
        // jsdom has no canvas, which the editor measures its font with.
        vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
            measureText: () => ({width: 8}),
        });
        element = document.body.appendChild(document.createElement("div"));
        codeEditor = editor.create(element, {language: "BBCBASIC", occurrencesHighlight: "off"});
        followImplicitLineNumbers(codeEditor);
    });

    afterEach(() => {
        codeEditor.dispose();
        element.remove();
        vi.restoreAllMocks();
    });

    const Example = 'GOTO 30\nPRINT "Doesn\'t get here"\nGOTO 30';

    // Loads the text, makes a selection of each [line, column, endLine, endColumn] (a cursor without the end) and runs
    // the editor command.
    function edit(text, selections, command, args) {
        codeEditor.setValue(text);
        codeEditor.setSelections(
            selections.map(([line, column, endLine = line, endColumn = column]) => ({
                selectionStartLineNumber: line,
                selectionStartColumn: column,
                positionLineNumber: endLine,
                positionColumn: endColumn,
            })),
        );
        codeEditor.trigger("test", command, args);
        return codeEditor.getValue();
    }

    it("should keep references pointing at their lines as lines are added and removed", () => {
        const enter = ["type", {text: "\n"}];
        const cases = [
            // The example from #13: Enter at the top.
            [Example, [[1, 1]], enter, '\nGOTO 40\nPRINT "Doesn\'t get here"\nGOTO 40'],
            [Example, [[1, 8]], enter, 'GOTO 40\n\nPRINT "Doesn\'t get here"\nGOTO 40'],
            [Example, [[3, 8]], enter, Example + "\n"],
            ["GOTO 30:GOTO 20\nPRINT\nEND", [[1, 9]], enter, "GOTO 40:\nGOTO 30\nPRINT\nEND"],
            ["GOTO 30\n  PRINT\nEND", [[2, 3]], enter, "GOTO 40\n  \nPRINT\nEND"],
            ["\nGOTO 40\nPRINT\nGOTO 40", [[2, 1]], ["deleteLeft"], "GOTO 30\nPRINT\nGOTO 30"],
            // A reference to a deleted line keeps its number, and so goes to the line that took its place.
            ["GOTO 20:GOTO 30\nX\nPRINT", [[2, 1, 3, 1]], ["deleteLeft"], "GOTO 20:GOTO 20\nPRINT"],
            [
                "GOTO 40\nGOTO 30\nPRINT\nGOTO 40",
                [[2, 1]],
                ["deleteLeft"],
                "GOTO 30GOTO 20\nPRINT\nGOTO 30",
            ],
            [
                "GOTO 30\nPRINT\nEND",
                [[2, 1]],
                ["paste", {text: "A\nB\n"}],
                "GOTO 50\nA\nB\nPRINT\nEND",
            ],
            [
                "GOTO 30\nPRINT\nEND",
                [[2, 1]],
                ["paste", {text: "GOTO 30\n"}],
                "GOTO 40\nGOTO 30\nPRINT\nEND",
            ],
            [
                "GOTO 30\nPRINT\nEND",
                [
                    [1, 1],
                    [2, 1],
                ],
                enter,
                "\nGOTO 50\n\nPRINT\nEND",
            ],
            ["GOTO 30\nPRINT\nEND", [[1, 5]], ["deleteLeft"], "GOT 30\nPRINT\nEND"],
            ["GOTO 30\nPRINT\nEND", [[1, 3]], ["type", {text: "X"}], "GOXTO 30\nPRINT\nEND"],
            ["GOTO 30\nPRINT\nEND", [[2, 2, 2, 4]], ["deleteLeft"], "GOTO 30\nPNT\nEND"],
            [
                "GOTO 30\nPRINT\nGOTO 40",
                [[3, 6, 3, 8]],
                ["paste", {text: "2\n"}],
                "GOTO 30\nPRINT\nGOTO 2\n",
            ],
            // Any line number at all, before or after the change, and the program is left alone.
            ["GOTO 30\n20PRINT\nEND", [[1, 1]], enter, "\nGOTO 30\n20PRINT\nEND"],
            [Example, [[1, 5]], enter, 'GOTO\n 30\nPRINT "Doesn\'t get here"\nGOTO 30'],
            [
                "GOTO 30\nPRINT\nEND",
                [[2, 1]],
                ["paste", {text: "15 A\n"}],
                "GOTO 30\n15 A\nPRINT\nEND",
            ],
            ["GOTO 30\n20PRINT\nEND", [[2, 1, 3, 1]], ["deleteLeft"], "GOTO 30\nEND"],
        ];
        for (const [text, selections, [command, args], expected] of cases) {
            expect(
                edit(text, selections, command, args),
                `${command} at ${selections} in ${text}`,
            ).toBe(expected);
        }
    });

    it("should undo and redo the rewrite with the edit that made it", () => {
        edit(Example, [[1, 1]], "type", {text: "\n"});
        codeEditor.trigger("test", "undo");
        expect(codeEditor.getValue()).toBe(Example);
        codeEditor.setPosition({lineNumber: 3, column: 3});
        codeEditor.trigger("test", "redo");
        expect(codeEditor.getValue()).toBe('\nGOTO 40\nPRINT "Doesn\'t get here"\nGOTO 40');
        expect(codeEditor.getPosition()).toEqual({lineNumber: 2, column: 1});
        codeEditor.trigger("test", "undo");
        expect(codeEditor.getValue()).toBe(Example);
    });

    it("should leave the program alone when it is replaced", () => {
        codeEditor.setValue(Example);
        codeEditor.setValue(`\n${Example}`);
        expect(codeEditor.getValue()).toBe(`\n${Example}`);
        const fullRange = codeEditor.getModel().getFullModelRange();
        codeEditor.executeEdits("load example", [{range: fullRange, text: `PRINT\n${Example}`}]);
        expect(codeEditor.getValue()).toBe(`PRINT\n${Example}`);
    });
});
