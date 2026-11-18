import {registerBbcBasicLanguage} from "../src/bbcbasic";
import {BasicIVDialect, ModelBDialect} from "../src/parser/dialect";
import {Kind, occurrencesAt, registerOccurrences, renameProviderFor} from "../src/occurrences";
import {isFnProc, keywords} from "../src/tokens";
import {describe, expect, it, vi, afterEach} from "vitest";
import assert from "assert";
import {editor} from "monaco-editor/editor/editor.api";

registerBbcBasicLanguage(ModelBDialect);
registerOccurrences(ModelBDialect);

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
        const {edits, rejectReason} = renameProviderFor(ModelBDialect).provideRenameEdits(
            model,
            position,
            newName,
        );
        return rejectReason ? {rejectReason} : edits.map(edit => edit.textEdit.range);
    });
}

describe("Occurrences", () => {
    it("should name the kinds of FN and PROC by the keywords the table says take a name", () => {
        expect(keywords.filter(isFnProc).map(kw => kw.keyword)).toEqual([Kind.Fn, Kind.Proc]);
    });
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
            assert.strictEqual(
                replaceAll(text, "X", (model, position) =>
                    occurrencesAt(model, position, ModelBDialect),
                ),
                expected,
                text,
            );
    });

    it("should read a model by the dialect it is asked for, whatever it was last read by", () => {
        withModel("COLORS=7", model => {
            const position = {lineNumber: 1, column: 6};
            const start = dialect => occurrencesAt(model, position, dialect)?.[0].startColumn;
            expect(start(ModelBDialect)).toBe(1);
            expect(start(BasicIVDialect)).toBe(6);
            expect(start(ModelBDialect)).toBe(1);
        });
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

    it("should allow a rename between real and integer, and no other change of type", () => {
        const cases = [
            // Olly's example from #294.
            [
                "DIMS(360):F.‸I=0TO360:S(I)=SINRADI:N.",
                "I%",
                "DIMS(360):F.I%=0TO360:S(I%)=SINRADI%:N.",
            ],
            ["‸I%=1:P.I%", "I", "I=1:P.I"],
            ["DIM ‸S(3):S(1)=S(2)", "S%", "DIM S%(3):S%(1)=S%(2)"],
            ["DIM ‸S%(3):S%(1)=S%(2)", "S", "DIM S(3):S(1)=S(2)"],
            ['‸A=1:A%=2:A$=""', "B%", 'B%=1:A%=2:A$=""'],
            ["‸I=1", "A%", "A%=1"],
            ["‸A%=1", "i", "i=1"],
            ["DIM ‸A(1):A=1", "A%", "DIM A%(1):A=1"],
            ["‸I%=1:J%=2", "J", "J=1:J%=2"],
        ];
        for (const [text, newName, expected] of cases)
            assert.strictEqual(rename(text, newName), expected, `${text} to ${newName}`);
        const refused = [
            ["‸F=1", "F$", "Renaming F to F$ would change its type"],
            ["‸F%=1", "F$", "Renaming F% to F$ would change its type"],
            ['‸F$=""', "F", "Renaming F$ to F would change its type"],
            ['‸F$=""', "F%", "Renaming F$ to F% would change its type"],
            ["DIM ‸A(1)", "A$", "Renaming A to A$ would change its type"],
            ["DIM ‸A$(1)", "A%", "Renaming A$ to A% would change its type"],
            ["‸F=1", "@%", "Renaming F to @% would change how numbers are printed"],
            ["‸@%=1", "F", "Renaming @% to F would change how numbers are printed"],
            ["‸I=1:I%=2", "I%", "I% is already used in this program"],
            ["‸I%=1:I=2", "I", "I is already used in this program"],
            ["DIM ‸S(1):DIM S%(1)", "S%", "S%( is already used in this program"],
            ["‸I=1", "2%", "2% is not a valid name for I"],
            ["‸I=1", "I%%", "I%% is not a valid name for I"],
            ["‸I=1", "PRINT%", "PRINT% is not a valid name for I"],
            ["DIM ‸S(1)", "TIME%", "TIME% is not a valid name for S("],
        ];
        for (const [text, newName, rejectReason] of refused)
            assert.deepStrictEqual(rename(text, newName), {rejectReason}, `${text} to ${newName}`);
        // FN and PROC names have no suffix, so a name with one is not a name.
        for (const [text, kind] of [
            ["PROC‸a:b=FNa", "PROCa"],
            ["b=FN‸a:PROCa", "FNa"],
        ])
            for (const suffix of ["%", "$"])
                assert.deepStrictEqual(
                    rename(text, `a${suffix}`),
                    {rejectReason: `a${suffix} is not a valid name for ${kind}`},
                    `${text} to a${suffix}`,
                );
    });

    it("should only offer to rename names", () => {
        assert.deepStrictEqual(
            at("P‸RINT F", renameProviderFor(ModelBDialect).resolveRenameLocation),
            {
                range: null,
                text: "",
                rejectReason: "Only variables, arrays, FNs and PROCs can be renamed",
            },
        );
        assert.deepStrictEqual(
            at("PRINT ‸F", renameProviderFor(ModelBDialect).resolveRenameLocation),
            {
                range: {startLineNumber: 1, startColumn: 7, endLineNumber: 1, endColumn: 8},
                text: "F",
            },
        );
    });
});

describe("Rename notice", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    const WholeNumbers =
        "it now holds whole numbers only (0.5 is stored as 0, and a value outside -2147483648 to 2147483647 is a Too big error).";
    const Real = "it is now a real variable (slower, and not limited to whole numbers).";
    const Resident = name => `${name} is a resident integer, so RUN, CLEAR, etc leave it alone`;
    const NotResident = (name, newName) =>
        `${name} was a resident integer, and ${newName} is not: RUN, CLEAR, etc forget it`;

    // Runs fn with an editor on the text and a spy on what it is asked to show in a message. The editor draws on
    // animation frames while fn waits, and jsdom's canvas does nothing at all.
    async function withEditor(text, fn) {
        const context = new Proxy(
            {measureText: () => ({width: 8})},
            {get: (target, name) => target[name] ?? (() => {})},
        );
        vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context);
        const element = document.body.appendChild(document.createElement("div"));
        const codeEditor = editor.create(element, {
            value: text,
            language: "BBCBASIC",
            occurrencesHighlight: "off",
        });
        try {
            const shown = vi.spyOn(
                codeEditor.getContribution("editor.contrib.messageController"),
                "showMessage",
            );
            await fn(codeEditor);
            await new Promise(resolve => setTimeout(resolve, 0));
            return shown.mock.calls.map(([message]) => message);
        } finally {
            codeEditor.dispose();
            element.remove();
        }
    }

    // Does what Monaco's rename does with the provider's answer, unless apply is false.
    function messagesAfterRename(textWithCursor, newName, {apply = true} = {}) {
        const {text, position} = withCursor(textWithCursor);
        return withEditor(text, codeEditor => {
            codeEditor.setPosition(position);
            const {edits} = renameProviderFor(ModelBDialect).provideRenameEdits(
                codeEditor.getModel(),
                position,
                newName,
            );
            if (apply)
                codeEditor.executeEdits(
                    "rename",
                    edits.map(edit => edit.textEdit),
                );
        });
    }

    it("should say what a rename changes about the variable, once it is applied", async () => {
        const cases = [
            // Between real and integer. Olly's example from #294, in which I% is itself a resident integer.
            [
                "F.‸I=0TO360:S(I)=SINRADI:N.",
                "I%",
                `Renamed I to I%: ${WholeNumbers} ${Resident("I%")}.`,
            ],
            ["F.‸IX=0TO360:S(IX)=SINRADIX:N.", "IX%", `Renamed IX to IX%: ${WholeNumbers}`],
            ["‸IX%=1", "IX", `Renamed IX% to IX: ${Real}`],
            ["‸I%=1", "I", `Renamed I% to I: ${Real} ${NotResident("I%", "I")}.`],
            ["‸Z%=1", "Z", `Renamed Z% to Z: ${Real} ${NotResident("Z%", "Z")}.`],
            ["DIM ‸S(3)", "S%", `Renamed S( to S%(: ${WholeNumbers}`],
            [
                "DIM ‸S%(3)",
                "S",
                "Renamed S%( to S(: it is now a real array (slower, and not limited to whole numbers).",
            ],
            [
                "‸I=1",
                "A%",
                `Renamed I to A%: ${WholeNumbers} ${Resident("A%")}, and CALL and USR set the accumulator from it.`,
            ],
            [
                "‸C%=1",
                "c",
                `Renamed C% to c: ${Real} ${NotResident("C%", "c")}, and CALL and USR no longer set the carry flag from it.`,
            ],
            // Only A% to Z% are resident, and not their arrays.
            ["DIM ‸A(3)", "A%", `Renamed A( to A%(: ${WholeNumbers}`],
            ["‸I=1", "a%", `Renamed I to a%: ${WholeNumbers}`],
            // Between integers, Olly's examples from #303.
            [
                "‸a%=1",
                "A%",
                `Renamed a% to A%: ${Resident("A%")}, and CALL and USR set the accumulator from it.`,
            ],
            ["‸a%=1", "I%", `Renamed a% to I%: ${Resident("I%")}.`],
            ["‸I%=1", "i%", `Renamed I% to i%: ${NotResident("I%", "i%")}.`],
            [
                "‸C%=1",
                "colour%",
                `Renamed C% to colour%: ${NotResident("C%", "colour%")}, and CALL and USR no longer set the carry flag from it.`,
            ],
            [
                "‸X%=1",
                "Y%",
                "Renamed X% to Y%: CALL and USR now set the Y register from it, not the X register.",
            ],
            [
                "‸A%=1",
                "I%",
                "Renamed A% to I%: CALL and USR no longer set the accumulator from it.",
            ],
            ["‸I%=1", "C%", "Renamed I% to C%: CALL and USR now set the carry flag from it."],
            ["‸a%=1", "aa%", null],
            ["‸B%=1", "D%", null],
            ["DIM ‸a%(3)", "A%", null],
            ["‸I%=1", "J%", null],
            ["‸I=1", "J", null],
            ["PROC‸a", "b", null],
            // Real names that are also properties of every JavaScript object are names like any other.
            ["‸toString=1", "ts", null],
            ["‸ts=1", "toString", null],
            ["‸constructor=1", "valueOf", null],
            ["‸__proto__=1", "hasOwnProperty", null],
            [
                "‸toString=1",
                "A%",
                `Renamed toString to A%: ${WholeNumbers} ${Resident("A%")}, and CALL and USR set the accumulator from it.`,
            ],
            [
                "‸C%=1",
                "constructor",
                `Renamed C% to constructor: ${Real} ${NotResident("C%", "constructor")}, and CALL and USR no longer set the carry flag from it.`,
            ],
            // A refused rename says why, as it did.
            ["‸I=1", "I$", "Renaming I to I$ would change its type"],
            ["‸I=1:I%=2", "I%", "I% is already used in this program"],
            ["‸a%=1:A%=2", "A%", "A% is already used in this program"],
            ["‸I=1", "@%", "Renaming I to @% would change how numbers are printed"],
            ["‸A%=1", "@%", "Renaming A% to @% would change how numbers are printed"],
        ];
        for (const [text, newName, expected] of cases)
            expect(await messagesAfterRename(text, newName), `${text} to ${newName}`).toEqual(
                expected ? [expected] : [],
            );
    });

    it("should say nothing if the edits are not applied", async () => {
        expect(await messagesAfterRename("‸I=1", "I%", {apply: false})).toEqual([]);
        expect(await messagesAfterRename("‸a%=1", "A%", {apply: false})).toEqual([]);
    });

    it("should say nothing if the next change is not the rename", async () => {
        for (const [text, newName] of [
            ["I=1:PRINT I", "I%"],
            ["a%=1:P.a%", "A%"],
        ]) {
            const messages = await withEditor(text, codeEditor => {
                const model = codeEditor.getModel();
                renameProviderFor(ModelBDialect).provideRenameEdits(
                    model,
                    {lineNumber: 1, column: 1},
                    newName,
                );
                codeEditor.executeEdits("typing", [
                    {
                        range: {startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1},
                        text: "1",
                    },
                ]);
            });
            expect(messages, `${text} to ${newName}`).toEqual([]);
        }
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
