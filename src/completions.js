import {languages} from "monaco-editor/editor/editor.api";
import "monaco-editor/editor/contrib/suggest/browser/suggestController";
import {Flags, isFnProc, isStatementKeyword} from "./tokens";
import {canStartStatement} from "./parser/dialect";
import {LanguageId} from "./bbcbasic";
import {programSymbols} from "./occurrences";
import {readLines} from "./parser/highlight";

const TextKinds = new Set(["string", "comment", "data", "oscli"]);

const labels = kws => [...new Set(kws.map(kw => kw.keyword))];
const SpcAndTab = ["SPC", "TAB("];
// The ROM has no token for TOP: it reads TO, then a P where a value is expected, so the table cannot offer it.
const Top = "TOP";
// The keywords BASIC II or BASIC IV offers, by the kind of place they can be typed in.
const labelSets = new Map();
function labelSetsFor(dialect) {
    if (!labelSets.has(dialect)) {
        const table = dialect.keywords;
        const programKeywords = table.filter(kw => !dialect.immediateCommands.includes(kw.keyword));
        const statementWords = new Set(
            table.filter(kw => canStartStatement(dialect, kw)).map(kw => kw.keyword),
        );
        const statement = labels(programKeywords.filter(kw => statementWords.has(kw.keyword)));
        labelSets.set(dialect, {
            statement,
            expression: [
                ...labels(
                    programKeywords.filter(kw => kw.flags & Flags.Expr || kw.keyword === "ELSE"),
                ),
                Top,
            ],
            assembler: [...labels(table.filter(kw => kw.flags & Flags.Expr)), Top],
            // The words besides values that BBC BASIC reads in each statement (tools/rom-oracle), by the statement's
            // first keyword; "ON ERROR" is what follows ON ERROR, which is read as a statement.
            inStatement: new Map([
                ["PRINT", SpcAndTab],
                ["INPUT", [...SpcAndTab, "LINE"]],
                ["FOR", ["TO", "STEP"]],
                ["IF", ["THEN", ...statement]],
                ["ON", ["ERROR", ...dialect.onBranches]],
                ["ON ERROR", ["OFF"]],
                ["TRACE", ["ON", "OFF"]],
                ["DEF", statement],
            ]),
        });
    }
    return labelSets.get(dialect);
}
// Statements that a statement can follow without a colon: IF X FOR, DEF PROCa FOR. The PROC after DEF is its name.
const HoldsStatement = new Set(["IF", "DEF"]);
const startsNestedStatement = token =>
    token.kind === "keyword" && isStatementKeyword(token.kw) && token.kw.keyword !== "PROC";

// The kind of name the keyword takes after it, which is its spelling.
const nameKind = token =>
    token && token.kind === "keyword" && isFnProc(token.kw) && token.kw.keyword;

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
            const onError =
                token.kind === "keyword" &&
                token.kw.keyword === "ERROR" &&
                state.statement === "ON";
            state.statement = onError ? "ON ERROR" : null;
        } else {
            if (state.atStart) state.statement = token.kind === "keyword" ? token.kw.keyword : "";
            else if (HoldsStatement.has(state.statement) && startsNestedStatement(token))
                state.statement = token.kw.keyword;
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
export function completionContext(text, dialect) {
    const recogniser = readLines(text, dialect).at(-1);
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
    const sets = labelSetsFor(dialect);
    if (state.inAssembler) return state.atStart ? null : {startColumn, labels: sets.assembler};
    const base = state.atStart ? sets.statement : sets.expression;
    return {
        startColumn,
        labels: [...new Set([...base, ...(sets.inStatement.get(state.statement) ?? [])])],
    };
}

function programNames(model, kind, position, startColumn, dialect) {
    const names = programSymbols(model.getValue(), dialect)
        .filter(
            s =>
                s.kind === kind &&
                !(s.lineNumber === position.lineNumber && s.startColumn === startColumn),
        )
        .map(s => s.name);
    return [...new Set(names)];
}

export function completionItems(model, position, dialect) {
    const context = completionContext(
        model.getValueInRange({
            startLineNumber: 1,
            startColumn: 1,
            endLineNumber: position.lineNumber,
            endColumn: position.column,
        }),
        dialect,
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
              programNames(model, context.nameKind, position, context.startColumn, dialect),
              languages.CompletionItemKind.Function,
          ]
        : [context.labels, languages.CompletionItemKind.Keyword];
    return labels.map(label => ({label, kind, insertText: label, range}));
}

let registration = null;

/** Has the editor complete by the dialect, in place of the one it was completing by. */
export function registerCompletions(dialect) {
    registration?.dispose();
    registration = languages.registerCompletionItemProvider(LanguageId, {
        // Incomplete, so that Monaco asks again when a word ends and another starts without a space, as in PROCd.
        provideCompletionItems: (model, position) => ({
            suggestions: completionItems(model, position, dialect),
            incomplete: true,
        }),
    });
}
