import {languages} from "monaco-editor/esm/vs/editor/editor.api";
import "monaco-editor/esm/vs/editor/contrib/suggest/browser/suggestController";
import {FirstStatementToken, Flags, immediateCommands, keywords} from "./tokens";
import {LanguageId, statementKeywords} from "./bbcbasic";
import {Kind, programSymbols} from "./occurrences";
import {readLines} from "./parser/highlight";

const TextKinds = new Set(["string", "comment", "data", "oscli"]);

const programKeywords = keywords.filter(kw => !immediateCommands.includes(kw.keyword));
const labels = kws => [...new Set(kws.map(kw => kw.keyword))];
const StatementLabels = labels(programKeywords.filter(kw => statementKeywords.has(kw.keyword)));
const ExpressionLabels = labels(programKeywords.filter(kw => kw.token < FirstStatementToken));
const AllLabels = labels(programKeywords);
const AssemblerLabels = labels(keywords.filter(kw => kw.flags & Flags.Expr));
// Statements in which a statement keyword can follow an expression: IF X PRINT, ON X GOTO, TRACE ON, DEF PROC.
const MixedStatements = new Set(["IF", "ON", "TRACE", "DEF"]);
const NameKinds = new Map([
    ["FN", Kind.Fn],
    ["PROC", Kind.Proc],
]);

const nameKind = token => token && token.kind === "keyword" && NameKinds.get(token.kw.keyword);

// A label starts an assembler statement as a colon does. Only the line's own number starts one; the others are the
// targets of GOTO, THEN and the like.
const startsStatement = token =>
    (token.kind === "linenum" && token.own) ||
    token.kind === "label" ||
    (token.kind === "punct" && token.text === ":") ||
    (token.kind === "keyword" && (token.kw.flags & Flags.Start || token.kw.keyword === "REPEAT"));

function statementState(tokens, inAssembler) {
    const state = {inAssembler, atStart: true, statement: null};
    for (const token of tokens) {
        if (token.kind === "punct" && (token.text === "[" || token.text === "]")) {
            state.inAssembler = token.text === "[";
            state.atStart = true;
        } else if (startsStatement(token)) {
            state.atStart = true;
            // ON ERROR is followed by a statement or OFF.
            if (token.kind === "keyword" && token.kw.keyword === "ERROR") continue;
            state.statement = null;
        } else {
            if (state.atStart) state.statement = token.kind === "keyword" ? token.kw.keyword : "";
            state.atStart = false;
        }
    }
    return state;
}

// An E with no exponent digits after it ends a number token (7E), but what is being typed is a word that starts with
// it (7ELSE is 7 then ELSE), so the word is split off.
function splitBareExponent(tokens, length) {
    const bareExponent = token => token && token.kind === "number" && /e$/i.test(token.text);
    const withoutE = number => ({...number, text: number.text.slice(0, -1), end: number.end - 1});
    const last = tokens.at(-1);
    const before = tokens.at(-2);
    if (bareExponent(last) && last.end === length) {
        const e = {kind: "name", text: last.text.slice(-1), start: last.end - 1, end: last.end};
        return [...tokens.slice(0, -1), withoutE(last), e];
    }
    if (
        bareExponent(before) &&
        before.end === last.start &&
        last.end === length &&
        last.kind === "name"
    ) {
        const word = {...last, text: before.text.slice(-1) + last.text, start: before.end - 1};
        return [...tokens.slice(0, -2), withoutE(before), word];
    }
    return tokens;
}

// What can be typed at the end of the text: {startColumn, labels} for keywords, {startColumn, nameKind} after FN or
// PROC, or null for nothing (in a string, REM, DATA, * command or number, or after DEF PROC or DEF FN).
export function completionContext(text) {
    const recogniser = readLines(text).at(-1);
    const line = recogniser.lexer.text;
    const tokens = splitBareExponent(
        recogniser.tokens.filter(token => token.kind !== "white"),
        line.length,
    );
    let last = tokens.at(-1);
    const lastAtEnd = last && last.end === line.length;
    if (lastAtEnd && (TextKinds.has(last.kind) || last.kind === "hex")) return null;
    let startColumn = line.length + 1;
    if (/[\w$%]$/.test(line) && !nameKind(last)) {
        if (!lastAtEnd) return null;
        tokens.pop();
        startColumn = last.start + 1;
        last = tokens.at(-1);
    }
    if (last && last.kind === "hex" && last.text === "&") return null;
    const state = statementState(tokens, recogniser.startsInAssembler);
    if (nameKind(last) && last.end === startColumn - 1) {
        const afterDef = tokens.at(-2)?.kw?.keyword === "DEF";
        return afterDef ? null : {startColumn, nameKind: nameKind(last)};
    }
    if (state.inAssembler) return state.atStart ? null : {startColumn, labels: AssemblerLabels};
    if (MixedStatements.has(state.statement)) return {startColumn, labels: AllLabels};
    return {startColumn, labels: state.atStart ? StatementLabels : ExpressionLabels};
}

function programNames(model, kind, position, startColumn) {
    const names = programSymbols(model.getValue())
        .filter(
            s =>
                s.kind === kind &&
                !(s.lineNumber === position.lineNumber && s.startColumn === startColumn),
        )
        .map(s => s.name);
    return [...new Set(names)];
}

export function completionItems(model, position) {
    const context = completionContext(
        model.getValueInRange({
            startLineNumber: 1,
            startColumn: 1,
            endLineNumber: position.lineNumber,
            endColumn: position.column,
        }),
    );
    if (!context) return [];
    const range = {
        startLineNumber: position.lineNumber,
        startColumn: context.startColumn,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
    };
    const [labels, kind] = context.nameKind
        ? [
              programNames(model, context.nameKind, position, context.startColumn),
              languages.CompletionItemKind.Function,
          ]
        : [context.labels, languages.CompletionItemKind.Keyword];
    return labels.map(label => ({label, kind, insertText: label, range}));
}

export function registerCompletions() {
    languages.registerCompletionItemProvider(LanguageId, {
        // Incomplete, so that Monaco asks again when a word ends and another starts without a space, as in PROCd.
        provideCompletionItems: (model, position) => ({
            suggestions: completionItems(model, position),
            incomplete: true,
        }),
    });
}
