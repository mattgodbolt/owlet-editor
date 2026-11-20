import {languages} from "monaco-editor/editor/editor.api";
import "monaco-editor/editor/contrib/suggest/browser/suggestController";
import {Flags, isFnProc} from "./tokens";
import {canStartStatement} from "./parser/dialect";
import {LanguageId} from "./bbcbasic";
import {programSymbols} from "./occurrences";
import {readLines} from "./parser/highlight";
import {ExpectingRecogniser, Recogniser} from "./parser/recogniser";

const TextKinds = new Set(["string", "comment", "data", "oscli"]);

const labels = kws => [...new Set(kws.map(kw => kw.keyword))];
// The ROM has no token for TOP: it reads TO, then a P where a value is expected, so the table cannot offer it.
const Top = "TOP";
// All that BASIC reads after DEF.
const DefinitionWords = ["FN", "PROC"];
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
        });
    }
    return labelSets.get(dialect);
}
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
    const state = {inAssembler, atStart: true};
    for (const token of tokens) {
        if (token.kind === "punct" && (token.text === "[" || token.text === "]")) {
            state.inAssembler = token.text === "[";
            state.atStart = true;
        } else {
            state.atStart = startsStatement(token);
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
    const typed = line.slice(0, startColumn - 1);
    const reading = new ExpectingRecogniser(typed, recogniser.startsInAssembler, dialect);
    reading.line();
    let candidates;
    if (state.inAssembler) {
        if (state.atStart) return null;
        candidates = sets.assembler;
    } else if (tokens.at(-1)?.kw?.keyword === "DEF") {
        candidates = DefinitionWords;
    } else {
        candidates = [
            ...new Set([
                ...(state.atStart ? sets.statement : sets.expression),
                ...reading.words,
                ...(reading.statementNext ? sets.statement : []),
            ]),
        ];
    }
    return {
        startColumn,
        labels: keepingLineReadable(candidates, reading, line.slice(startColumn - 1), dialect),
    };
}

// Where the statement the text ends in starts: after the last colon or ELSE.
function statementStartIn(tokens) {
    const split = tokens.findLastIndex(
        token => (token.kind === "punct" && token.text === ":") || token.kw?.keyword === "ELSE",
    );
    return tokens[split + 1]?.start ?? Infinity;
}

const isSubsequence = (word, candidate) => {
    let at = 0;
    for (const letter of word) {
        at = candidate.indexOf(letter, at) + 1;
        if (!at) return false;
    }
    return true;
};

// What was read of the statement last typed in: each word tried after it, so that typing the rest of a word reads
// the statement once, not once per key.
let tried = {key: null, results: new Map()};

// The candidates that BASIC reads after what was typed before the word, one statement at a time: those that leave
// the statement with no error other than that it ends too soon. Only words that the one being typed could become
// are tried, as the editor drops the rest. If the statement is already wrong before the word it tells us nothing, so
// nothing is dropped.
function keepingLineReadable(candidates, reading, word, dialect) {
    const typed = reading.lexer.text;
    const tokens = reading.tokens.filter(token => token.kind !== "white");
    const from = Math.min(statementStartIn(tokens), typed.length);
    const inAssembler = statementState(
        tokens.filter(token => token.start < from),
        reading.startsInAssembler,
    ).inAssembler;
    const statement = typed.slice(from);
    const key = `${dialect.basicIV} ${dialect.usColor} ${inAssembler} ${statement}`;
    if (tried.key !== key) tried = {key, results: new Map()};
    const readable = candidate => {
        if (!tried.results.has(candidate)) {
            const text = statement + candidate;
            const probe = new Recogniser(text, inAssembler, dialect, true);
            tried.results.set(candidate, probe.valid(text, {start: 0}, statement.length));
        }
        return tried.results.get(candidate);
    };
    if (!readable("")) return candidates;
    const wanted = word.toUpperCase();
    return candidates.filter(
        candidate =>
            (!wanted || (candidate[0] === wanted[0] && isSubsequence(wanted, candidate))) &&
            (candidate !== "ELSE" || reading.waitingForElse) &&
            readable(candidate),
    );
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
