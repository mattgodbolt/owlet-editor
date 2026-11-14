import {editor, languages} from "monaco-editor/esm/vs/editor/editor.api";
import "monaco-editor/esm/vs/editor/contrib/suggest/browser/suggestController";
import {FirstStatementToken, Flags, immediateCommands, keywords, tokenChar} from "./tokens";
import {abbreviatedKeyword, allTokensRegex, LanguageId, statementKeywords} from "./bbcbasic";
import {Kind, programSymbols} from "./occurrences";

const KeywordType = `keyword.${LanguageId}`;
const SquareType = `delimiter.square.${LanguageId}`;
// What Monaco itself treats as a string or a comment: strings, REM, DATA and * commands.
const TextTypeRegex = /\b(string|comment)\b/;

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

const keywordByChar = new Map(keywords.map(kw => [tokenChar(kw), kw]));
const KeywordRegex = new RegExp(
    `${allTokensRegex}|[A-Z]+\\$?\\.|[${[...keywordByChar.keys()].join("")}]`,
    "g",
);

function keywordOf(text) {
    if (text.endsWith(".")) return abbreviatedKeyword(text);
    return keywordByChar.get(text) || keywords.find(kw => kw.keyword === text);
}

// A line's tokens with their text, without white space. Monaco joins adjacent tokens of the same type, so a keyword
// token is split into its keywords.
export function lineItems(line, lineTokens) {
    return lineTokens.flatMap((token, index) => {
        const end = index + 1 < lineTokens.length ? lineTokens[index + 1].offset : line.length;
        const text = line.slice(token.offset, end);
        if (token.type === `white.${LanguageId}` || text === "") return [];
        const matches = token.type === KeywordType ? [...text.matchAll(KeywordRegex)] : [];
        if (matches.length === 0) return [{type: token.type, offset: token.offset, end, text}];
        return matches.map(match => {
            const offset = token.offset + match.index;
            return {
                type: token.type,
                offset,
                end: offset + match[0].length,
                text: match[0],
                kw: keywordOf(match[0]),
            };
        });
    });
}

const nameKind = item => item && item.kw && NameKinds.get(item.kw.keyword);

// A label starts an assembler statement as a colon does. The tokeniser joins a colon to the symbols before it (";:").
// Only the line's own number starts one; the others are the targets of GOTO, THEN and the like.
const startsStatement = (item, index) =>
    (item.type === `constant.linenum.${LanguageId}` && index === 0) ||
    item.type === `type.identifier.${LanguageId}` ||
    (/^(symbol|operator)\./.test(item.type) && item.text.endsWith(":")) ||
    (item.kw && (item.kw.flags & Flags.Start || item.kw.keyword === "REPEAT"));

function statementState(items, inAssembler) {
    const state = {inAssembler, atStart: true, statement: null, inText: false};
    for (const [index, item] of items.entries()) {
        if (item.type === SquareType) {
            state.inAssembler = item.text === "[";
            state.atStart = true;
        } else if (item.kw && item.kw.flags & Flags.REM && !state.inAssembler) {
            state.inText = true;
        } else if (startsStatement(item, index)) {
            state.atStart = true;
            // ON ERROR is followed by a statement or OFF.
            if (item.kw && item.kw.keyword === "ERROR") continue;
            state.statement = null;
        } else {
            if (state.atStart) state.statement = item.kw ? item.kw.keyword : "";
            state.atStart = false;
        }
    }
    return state;
}

// What can be typed at the end of the text: {startColumn, labels} for keywords, {startColumn, nameKind} after FN or
// PROC, or null for nothing (in a string, REM, DATA, * command or number, or after DEF PROC or DEF FN).
export function completionContext(text) {
    const lines = text.split(/\r?\n/);
    const lineTokens = editor.tokenize(text, LanguageId);
    let inAssembler = false;
    for (let i = 0; i < lines.length - 1; i++) {
        if (lineTokens[i].some(token => token.type === SquareType)) {
            inAssembler = statementState(
                lineItems(lines[i], lineTokens[i]),
                inAssembler,
            ).inAssembler;
        }
    }
    const line = lines[lines.length - 1];
    const items = lineItems(line, lineTokens[lines.length - 1]);
    let last = items[items.length - 1];
    const lastAtEnd = last && last.end === line.length;
    if (lastAtEnd && TextTypeRegex.test(last.type)) return null;
    let startColumn = line.length + 1;
    if (/[\w$%]$/.test(line) && !nameKind(last)) {
        // The tokeniser joins abutting names ("A%B"): the word is the last of them.
        const word = lastAtEnd && last.text.match(/\w+[$%]?$/);
        if (!word) return null;
        items.pop();
        if (word.index > 0) {
            items.push({
                ...last,
                end: last.offset + word.index,
                text: last.text.slice(0, word.index),
            });
        }
        startColumn = last.offset + word.index + 1;
        last = items[items.length - 1];
    }
    const state = statementState(items, inAssembler);
    if (state.inText || (last && last.text.endsWith("&"))) return null;
    if (nameKind(last) && last.end === startColumn - 1) {
        const beforeName = items[items.length - 2];
        const afterDef = beforeName && beforeName.kw && beforeName.kw.keyword === "DEF";
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
