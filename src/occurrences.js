import {editor, KeyCode, KeyMod, languages} from "monaco-editor/esm/vs/editor/editor.api";
import "monaco-editor/esm/vs/editor/contrib/rename/browser/rename";
import "monaco-editor/esm/vs/editor/contrib/wordHighlighter/browser/wordHighlighter";

const LanguageId = "BBCBASIC";
const VariableType = `variable.${LanguageId}`;
const LabelType = `type.identifier.${LanguageId}`;
const KeywordType = `keyword.${LanguageId}`;
const WhiteType = `white.${LanguageId}`;

// The tokeniser joins abutting names into one token (e.g. "A%B"), so a token can hold more than one name.
const NameRegex = /@%|\w+[$%]?/g;
const FnRegex = /(?:FN|\xa4)$/;
const ProcRegex = /(?<!END)(?:PROC|PRO\.)$|\xf2$/;
const AccumulatorModeRegex = /^(?:ASL|LSR|ROL|ROR)$/;
const MessageControllerId = "editor.contrib.messageController";
const NotANameReason = "Only variables, arrays, FNs and PROCs can be renamed";

const Kind = {Variable: "", Array: "(", Fn: "FN", Proc: "PROC"};

function symbol(kind, name, lineNumber, offset) {
    return {kind, name, lineNumber, startColumn: offset + 1, endColumn: offset + name.length + 1};
}

// Every name in the program that BASIC looks up as a variable, array, FN or PROC. A variable, an array, a FN and a
// PROC with the same name are different things, as are A, A% and A$; an assembler label is a variable.
export function programSymbols(text) {
    const lines = text.split(/\r?\n/);
    const symbols = [];
    editor.tokenize(text, LanguageId).forEach((lineTokens, lineIndex) => {
        const line = lines[lineIndex];
        const lineNumber = lineIndex + 1;
        let previous = null;
        lineTokens.forEach((token, tokenIndex) => {
            const end =
                tokenIndex + 1 < lineTokens.length
                    ? lineTokens[tokenIndex + 1].offset
                    : line.length;
            const text = line.slice(token.offset, end);
            const afterKeyword = previous && previous.type === KeywordType ? previous.text : "";
            if (token.type === LabelType) {
                symbols.push(symbol(Kind.Variable, text.slice(1), lineNumber, token.offset + 1));
            } else if (
                token.type === VariableType &&
                FnRegex.test(afterKeyword) &&
                previous.end === token.offset
            ) {
                symbols.push(symbol(Kind.Fn, text, lineNumber, token.offset));
            } else if (
                token.type === VariableType &&
                ProcRegex.test(afterKeyword) &&
                previous.end === token.offset
            ) {
                symbols.push(symbol(Kind.Proc, text, lineNumber, token.offset));
            } else if (token.type === VariableType) {
                for (const match of text.matchAll(NameRegex)) {
                    const offset = token.offset + match.index;
                    const name = match[0];
                    if (name === "A" && AccumulatorModeRegex.test(afterKeyword)) continue;
                    const kind = line[offset + name.length] === "(" ? Kind.Array : Kind.Variable;
                    symbols.push(symbol(kind, name, lineNumber, offset));
                }
            }
            if (token.type !== WhiteType) previous = {type: token.type, text, end};
        });
    });
    return symbols;
}

const symbolsCache = new WeakMap();

function modelSymbols(model) {
    const version = model.getVersionId();
    const cached = symbolsCache.get(model);
    if (cached && cached.version === version) return cached.symbols;
    const symbols = programSymbols(model.getValue());
    symbolsCache.set(model, {version, symbols});
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
export function occurrencesAt(model, position) {
    const symbols = modelSymbols(model);
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

// A line in which BASIC reads the name as the given kind of symbol.
const ProbeLine = {
    [Kind.Variable]: name => `P.${name}`,
    [Kind.Array]: name => `P.${name}(`,
    [Kind.Fn]: name => `P.FN${name}`,
    [Kind.Proc]: name => `PROC${name}`,
};

function renameError(model, target, newName) {
    const renamed = {...target, name: newName};
    const probe = programSymbols(ProbeLine[target.kind](newName));
    if (probe.length !== 1 || !sameSymbol(probe[0], renamed)) {
        return `${newName} is not a valid name for ${displayName(target)}`;
    }
    if ([target.name, newName].includes("@%")) {
        return `Renaming ${target.name} to ${newName} would change how numbers are printed`;
    }
    if (typeSuffix(newName) !== typeSuffix(target.name)) {
        return `Renaming ${target.name} to ${newName} would change its type`;
    }
    if (modelSymbols(model).some(s => sameSymbol(s, renamed))) {
        return `${displayName(renamed)} is already used in this program`;
    }
    return null;
}

const highlightProvider = {
    provideDocumentHighlights(model, position) {
        return (occurrencesAt(model, position) || []).map(r => ({
            range: r,
            kind: languages.DocumentHighlightKind.Text,
        }));
    },
};

// The standalone editor only logs a rename's rejectReason to the console.
function showMessage(model, position, message) {
    const codeEditor = editor.getEditors().find(e => e.getModel() === model);
    const messages = codeEditor && codeEditor.getContribution(MessageControllerId);
    if (messages) messages.showMessage(message, position);
}

const renameProvider = {
    resolveRenameLocation(model, position) {
        const target = symbolAt(modelSymbols(model), position);
        if (!target) return {range: null, text: "", rejectReason: NotANameReason};
        return {range: range(target), text: target.name};
    },
    provideRenameEdits(model, position, newName) {
        const target = symbolAt(modelSymbols(model), position);
        const error = target ? renameError(model, target, newName) : NotANameReason;
        if (error) {
            showMessage(model, position, error);
            return {edits: [], rejectReason: error};
        }
        const versionId = model.getVersionId();
        return {
            edits: occurrencesAt(model, position).map(r => ({
                resource: model.uri,
                versionId,
                textEdit: {range: r, text: newName},
            })),
        };
    },
};

function selectOccurrences(codeEditor) {
    const ranges = occurrencesAt(codeEditor.getModel(), codeEditor.getPosition());
    if (!ranges) return;
    codeEditor.setSelections(
        ranges.map(r => ({
            selectionStartLineNumber: r.startLineNumber,
            selectionStartColumn: r.startColumn,
            positionLineNumber: r.endLineNumber,
            positionColumn: r.endColumn,
        })),
    );
}

// Monaco's own "Change All Occurrences" finds the word's text wherever it appears, so Owlet has this one instead.
export function addChangeAllOccurrences(codeEditor) {
    codeEditor.addAction({
        id: "change-all-occurrences",
        label: "Change All Occurrences",
        keybindings: [KeyMod.CtrlCmd | KeyCode.F2],
        run: selectOccurrences,
    });
}

export function registerOccurrences() {
    languages.registerDocumentHighlightProvider(LanguageId, highlightProvider);
    languages.registerRenameProvider(LanguageId, renameProvider);
}
