import {editor, KeyCode, KeyMod, languages} from "monaco-editor/editor/editor.api";
import "monaco-editor/editor/contrib/rename/browser/rename";
import "monaco-editor/editor/contrib/wordHighlighter/browser/wordHighlighter";
import {LanguageId} from "./bbcbasic";
import {readLines} from "./parser/highlight";

const MessageControllerId = "editor.contrib.messageController";
const NotANameReason = "Only variables, arrays, FNs and PROCs can be renamed";

export const Kind = {Variable: "", Array: "(", Fn: "FN", Proc: "PROC"};

function symbol(kind, name, lineNumber, offset) {
    return {kind, name, lineNumber, startColumn: offset + 1, endColumn: offset + name.length + 1};
}

// Every name in the program that BASIC looks up as a variable, array, FN or PROC. A variable, an array, a FN and a
// PROC with the same name are different things, as are A, A% and A$; an assembler label is a variable.
export function programSymbols(text, dialect) {
    return readLines(text, dialect).flatMap((recogniser, lineIndex) => {
        const lineNumber = lineIndex + 1;
        const {text: line} = recogniser.lexer;
        return recogniser.tokens.flatMap((token, i) => {
            if (token.kind === "label")
                return [symbol(Kind.Variable, token.text.slice(1), lineNumber, token.start + 1)];
            // The tokeniser gives an FN or PROC name as the token after its keyword, and marks what the assembler
            // reads as an opcode or register, such as the A of ASL A, with a type.
            if (token.kind === "fnname")
                return [
                    symbol(
                        recogniser.tokens[i - 1].kw.keyword,
                        token.text,
                        lineNumber,
                        token.start,
                    ),
                ];
            if (token.kind !== "name" || token.type) return [];
            const kind = line[token.end] === "(" ? Kind.Array : Kind.Variable;
            return [symbol(kind, token.text, lineNumber, token.start)];
        });
    });
}

const symbolsCache = new WeakMap();

function modelSymbols(model, dialect) {
    const version = model.getVersionId();
    const cached = symbolsCache.get(model);
    if (cached && cached.version === version && cached.dialect === dialect) return cached.symbols;
    const symbols = programSymbols(model.getValue(), dialect);
    symbolsCache.set(model, {version, dialect, symbols});
    return symbols;
}

function symbolAt(symbols, position) {
    return symbols.find(
        s =>
            s.lineNumber === position.lineNumber &&
            s.startColumn <= position.column &&
            position.column <= s.endColumn,
    );
}

function sameSymbol(a, b) {
    return a.kind === b.kind && a.name === b.name;
}

function range(s) {
    return {
        startLineNumber: s.lineNumber,
        startColumn: s.startColumn,
        endLineNumber: s.lineNumber,
        endColumn: s.endColumn,
    };
}

// The occurrences of the variable, array, FN or PROC at the position, the one at the position first; null if there
// is none there.
export function occurrencesAt(model, position, dialect) {
    const symbols = modelSymbols(model, dialect);
    const target = symbolAt(symbols, position);
    if (!target) return null;
    return [target, ...symbols.filter(s => s !== target && sameSymbol(s, target))].map(range);
}

function displayName(s) {
    return s.kind === Kind.Array ? `${s.name}(` : s.kind + s.name;
}

function typeSuffix(name) {
    return /[$%]$/.test(name) ? name.slice(-1) : "";
}

const RealSuffix = "";
const IntegerSuffix = "%";
const ResidentInteger = /^[A-Z]%$/;

const isNumeric = name => [RealSuffix, IntegerSuffix].includes(typeSuffix(name));

// What the user is told after a rename that changes a variable or array between real and integer, or null if it does
// not. FN and PROC names carry no suffix, so they never change type.
function typeChangeNotice(target, newName) {
    if (typeSuffix(target.name) === typeSuffix(newName)) return null;
    const renamed = {...target, name: newName};
    const toInteger = typeSuffix(newName) === IntegerSuffix;
    const noun = target.kind === Kind.Array ? "array" : "variable";
    const sentences = [
        `Renamed ${displayName(target)} to ${displayName(renamed)}: ` +
            (toInteger
                ? "it now holds whole numbers only (0.5 is stored as 0, and a value outside -2147483648 to 2147483647 is a Too big error)."
                : `it is now a real ${noun} (slower, and not limited to whole numbers).`),
    ];
    // Arrays are never resident.
    if (target.kind === Kind.Variable && ResidentInteger.test(newName))
        sentences.push(
            `${newName} is a resident integer: CALL and USR pass it to machine code, and RUN and CLEAR leave it alone.`,
        );
    if (target.kind === Kind.Variable && ResidentInteger.test(target.name))
        sentences.push(
            `${target.name} was a resident integer, which CALL and USR pass to machine code.`,
        );
    return sentences.join(" ");
}

// A line in which BASIC reads the name as the given kind of symbol.
const ProbeLine = {
    [Kind.Variable]: name => `P.${name}`,
    [Kind.Array]: name => `P.${name}(`,
    [Kind.Fn]: name => `P.FN${name}`,
    [Kind.Proc]: name => `PROC${name}`,
};

function renameError(model, target, newName, dialect) {
    const renamed = {...target, name: newName};
    const probe = programSymbols(ProbeLine[target.kind](newName), dialect);
    if (probe.length !== 1 || !sameSymbol(probe[0], renamed)) {
        return `${newName} is not a valid name for ${displayName(target)}`;
    }
    if ([target.name, newName].includes("@%")) {
        return `Renaming ${target.name} to ${newName} would change how numbers are printed`;
    }
    if (
        typeSuffix(newName) !== typeSuffix(target.name) &&
        !(isNumeric(newName) && isNumeric(target.name))
    ) {
        return `Renaming ${target.name} to ${newName} would change its type`;
    }
    if (modelSymbols(model, dialect).some(s => sameSymbol(s, renamed))) {
        return `${displayName(renamed)} is already used in this program`;
    }
    return null;
}

const highlightProviderFor = dialect => ({
    provideDocumentHighlights(model, position) {
        return (occurrencesAt(model, position, dialect) || []).map(r => ({
            range: r,
            kind: languages.DocumentHighlightKind.Text,
        }));
    },
});

// The standalone editor only logs a rename's rejectReason to the console. Without a position the message is shown
// at the cursor.
function showMessage(model, position, message) {
    const codeEditor = editor.getEditors().find(e => e.getModel() === model);
    const messages = codeEditor && codeEditor.getContribution(MessageControllerId);
    if (messages) messages.showMessage(message, position ?? codeEditor.getPosition());
}

const pendingNotices = new WeakMap();

// Shows the notice a tick after the edits of the rename the editor is about to apply have been, and not at all if the
// next change to the model is anything else.
function showNoticeWhenApplied(model, dialect, target, renamed, notice) {
    pendingNotices.get(model)?.dispose();
    const versionId = model.getVersionId();
    const listener = model.onDidChangeContent(() => {
        listener.dispose();
        pendingNotices.delete(model);
        if (model.getVersionId() !== versionId + 1) return;
        const symbols = modelSymbols(model, dialect);
        if (symbols.some(s => sameSymbol(s, target)) || !symbols.some(s => sameSymbol(s, renamed)))
            return;
        setTimeout(() => showMessage(model, null, notice), 0);
    });
    pendingNotices.set(model, listener);
}

export const renameProviderFor = dialect => ({
    resolveRenameLocation(model, position) {
        const target = symbolAt(modelSymbols(model, dialect), position);
        if (!target) return {range: null, text: "", rejectReason: NotANameReason};
        return {range: range(target), text: target.name};
    },
    provideRenameEdits(model, position, newName) {
        const target = symbolAt(modelSymbols(model, dialect), position);
        const error = renameError(model, target, newName, dialect);
        if (error) {
            showMessage(model, position, error);
            return {edits: [], rejectReason: error};
        }
        const notice = typeChangeNotice(target, newName);
        if (notice)
            showNoticeWhenApplied(model, dialect, target, {...target, name: newName}, notice);
        const versionId = model.getVersionId();
        return {
            edits: occurrencesAt(model, position, dialect).map(r => ({
                resource: model.uri,
                versionId,
                textEdit: {range: r, text: newName},
            })),
        };
    },
});

const selectOccurrences = dialect => codeEditor => {
    const ranges = occurrencesAt(codeEditor.getModel(), codeEditor.getPosition(), dialect);
    if (!ranges) return;
    codeEditor.setSelections(
        ranges.map(r => ({
            selectionStartLineNumber: r.startLineNumber,
            selectionStartColumn: r.startColumn,
            positionLineNumber: r.endLineNumber,
            positionColumn: r.endColumn,
        })),
    );
};

let registrations = [];

/** Has the editor find a name's occurrences by the dialect, in place of the one it was finding them by. */
export function registerOccurrences(dialect) {
    for (const registration of registrations) registration.dispose();
    registrations = [
        languages.registerDocumentHighlightProvider(LanguageId, highlightProviderFor(dialect)),
        languages.registerRenameProvider(LanguageId, renameProviderFor(dialect)),
        // Monaco's own "Change All Occurrences" finds the word's text wherever it appears, so Owlet has this one instead.
        editor.addEditorAction({
            id: "change-all-occurrences",
            label: "Change All Occurrences",
            keybindings: [KeyMod.CtrlCmd | KeyCode.F2],
            run: selectOccurrences(dialect),
        }),
    ];
}
