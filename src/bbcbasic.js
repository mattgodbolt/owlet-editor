import {editor, languages, MarkerSeverity} from "monaco-editor/editor/editor.api";
import {Flags, keywords, tokenChar} from "./tokens";
import {StandaloneServices} from "monaco-editor/editor/standalone/browser/standaloneServices";
import {IStandaloneThemeService} from "monaco-editor/editor/standalone/common/standaloneTheme";
import {ILanguageService} from "monaco-editor/editor/common/languages/language";
import {programProblems, readLines, tokensProvider} from "./parser/highlight";
import {lexLine} from "./parser/lexer";
import {problemMessage} from "./problem-messages";
import {ForeignOperators} from "./parser/recogniser";
import {ModelBDialect} from "./parser/dialect";
import {JunkAfterInstructionCode, SpaceAfterMnemonicCode} from "./parser/assembler";

export const LanguageId = "BBCBASIC";

const ConditionalWords = new Set(
    keywords.filter(kw => kw.flags & Flags.Conditional).map(kw => kw.keyword),
);
const KeywordWord = [...new Set(keywords.map(kw => kw.keyword))]
    .sort((x, y) => y.length - x.length)
    .map(word => word.replace(/[$(]/g, "\\$&") + (ConditionalWords.has(word) ? "\\b" : ""))
    .join("|");

// Monaco's MetadataConsts.BALANCED_BRACKETS_MASK: it looks for brackets only in the text of tokens that have it, and
// keeps neighbours that differ in it apart, so an opener such as LE. is found though the keyword before it touches it.
const BalancedBrackets = 1024;

function tokenMetadata(scopes, bracket) {
    const theme = StandaloneServices.get(IStandaloneThemeService).getColorTheme().tokenTheme;
    const language =
        StandaloneServices.get(ILanguageService).languageIdCodec.encodeLanguageId(LanguageId);
    return (theme.match(language, scopes) | (bracket ? BalancedBrackets : 0)) >>> 0;
}

/**
 * Has Monaco pair the brackets of a model again, from our tokens. A tree built while the model has no tokens (as after
 * setValue, or the tokens provider being replaced) counts every "." as an opener, and Monaco does not rebuild it once
 * tokens arrive if it has already seen tokenizing complete; changing a model option does rebuild it.
 */
export function rebuildBracketPairs(model) {
    model.tokenization.forceTokenization(model.getLineCount());
    const {bracketPairColorizationOptions: options} = model.getOptions();
    model.updateOptions({bracketColorizationOptions: {...options, enabled: !options.enabled}});
    model.updateOptions({bracketColorizationOptions: options});
}

const openParenKeywords = keywords.filter(kw => kw.keyword.endsWith("("));
let registrations = [];

/** Has the editor read its BBC BASIC by the dialect, in place of the one it was reading by. */
export function registerBbcBasicLanguage(dialect = ModelBDialect) {
    if (registrations.length === 0) languages.register({id: LanguageId});
    for (const registration of registrations) registration.dispose();

    const configuration = languages.setLanguageConfiguration(LanguageId, {
        comments: {
            lineComment: "REM",
        },
        brackets: [
            ["[", "]"],
            ["(", ")"],
            // A spelling that ends in "(" is opened by that "(", which leaves the keyword before it uncoloured as a bracket.
            // The tokenizer sets the bracket bit on the "." of an abbreviation, and on a raw token.
            ...[".", ...openParenKeywords.map(tokenChar)].map(open => [open.toLowerCase(), ")"]),
        ],
        autoClosingPairs: [
            {open: "(", close: ")"},
            {open: '"', close: '"', notIn: ["string"]},
        ],
        surroundingPairs: [
            {open: "(", close: ")"},
            {open: '"', close: '"'},
        ],
        // In order to separate 10PRINT into "10" "PRINT" and
        // PRINTLN12 into "PRINT" "LN" "12", we override the default word pattern.
        wordPattern: new RegExp(
            KeywordWord +
                "|" +
                /(@%)|(-?\d*\.\d+)|(-?\d+)|([^`~!@#%^&*()\-=+[{\]}\\|;:'",.<>/?\s]+%?)/g.source,
        ),
    });

    registrations = [
        languages.setTokensProvider(LanguageId, tokensProvider(LanguageId, tokenMetadata, dialect)),
        configuration,
        languages.registerCodeActionProvider(LanguageId, codeActionProviderFor(dialect)),
    ];
    for (const model of editor.getModels())
        if (model.getLanguageId() === LanguageId) rebuildBracketPairs(model);
}

// With thanks to https://stackoverflow.com/questions/57994101/show-quick-fix-for-an-error-in-monaco-editor
export const codeActionProviderFor = dialect => ({
    provideCodeActions(model, range, context) {
        // Only the warnings above come with a fix; the text under any other marker is not to be rewritten. The editor's
        // markers carry no code (Monaco would show it in the hover), so it is found from the text again.
        let known = null;
        const codeOf = marker => {
            if (marker.code) return marker.code;
            const text = model.getValue();
            known = known || [...getWarnings(text, dialect), ...getSyntaxMarkers(text, 0, dialect)];
            return known.find(
                found =>
                    found.message === marker.message &&
                    found.startLineNumber === marker.startLineNumber &&
                    found.startColumn === marker.startColumn,
            )?.code;
        };
        const fixable = context.markers
            .map(marker => ({...marker, code: codeOf(marker)}))
            .filter(marker => QuickFixCodes.has(marker.code));
        const actions = fixable.map(marker => {
            const text = model.getValueInRange(marker);
            if (marker.code === SpaceAfterAbbreviationCode) {
                const abbreviation = text.slice(0, text.indexOf(".") + 1);
                const column = marker.startColumn + abbreviation.length;
                const at = {
                    startLineNumber: marker.startLineNumber,
                    startColumn: column,
                    endLineNumber: marker.startLineNumber,
                    endColumn: column,
                };
                return quickFix(model, marker, `Insert a space after ${abbreviation}`, at, " ");
            }
            if (marker.code === SpaceAfterMnemonicCode) {
                const before = model
                    .getLineContent(marker.startLineNumber)
                    .slice(0, marker.startColumn - 1);
                const [mnemonic] = before.match(/EQU[BDSW]$|.{3}$/i);
                const at = {
                    ...marker,
                    endLineNumber: marker.startLineNumber,
                    endColumn: marker.startColumn,
                };
                return quickFix(model, marker, `Insert a space after ${mnemonic}`, at, " ");
            }
            if (marker.code === JunkAfterInstructionCode) {
                const at = {
                    ...marker,
                    endLineNumber: marker.startLineNumber,
                    endColumn: marker.startColumn,
                };
                return text[0] === "]"
                    ? quickFix(model, marker, "Insert : before ]", at, ":")
                    : quickFix(model, marker, "Insert ; before the junk", at, ";");
            }
            const replacement = ForeignOperators.get(text) || text.toUpperCase();
            return quickFix(model, marker, `Replace with ${replacement}`, marker, replacement);
        });
        return {actions, dispose: () => {}};
    },
});
export const codeActionProvider = codeActionProviderFor(ModelBDialect);

function quickFix(model, marker, title, range, text) {
    return {
        title,
        diagnostics: [marker],
        kind: "quickfix",
        edit: {edits: [{resource: model.uri, textEdit: {range, text}}]},
        isPreferred: true,
    };
}

const SpaceAfterAbbreviationCode = "space-after-abbreviation";
const LowerCaseKeywordCode = "lowercase-keyword";
const ForeignOperatorCode = "foreign-operator";
const QuickFixCodes = new Set([
    SpaceAfterAbbreviationCode,
    LowerCaseKeywordCode,
    ForeignOperatorCode,
    JunkAfterInstructionCode,
    SpaceAfterMnemonicCode,
]);

// Markers as the editor shows them: the code is only for the quick fixes, and Monaco would add it to the hover text.
export const withoutCodes = markers => markers.map(marker => ({...marker, code: undefined}));

const marker = (severity, line, start, end, details) => ({
    severity,
    ...details,
    startLineNumber: line,
    startColumn: start + 1,
    endLineNumber: line,
    endColumn: end + 1,
});

// The warnings for each line of the program.
export function getWarnings(text, dialect = ModelBDialect) {
    return readLines(text, dialect).flatMap(({lexer, tokens}, i) =>
        lineWarnings(lexer.text, tokens, dialect).map(({start, end, ...details}) =>
            marker(MarkerSeverity.Warning, i + 1, start, end, details),
        ),
    );
}

// The markers for the lines BASIC would stop at, and for those that end too soon or have something missing. A line is unfinished while the cursor is on it (`cursorLine`) and so is not marked then,
// and a warning that covers the same text says enough.
export function getSyntaxMarkers(text, cursorLine = 0, dialect = ModelBDialect) {
    const recognisers = readLines(text, dialect);
    const warnings = recognisers.map(({lexer, tokens}) =>
        lineWarnings(lexer.text, tokens, dialect),
    );
    return programProblems(text, recognisers).flatMap(problem => {
        const {line, start, end, unfinished, code} = problem;
        const covered = warnings[line - 1].some(
            warning => warning.start < end && start < warning.end,
        );
        if (covered || (unfinished && line === cursorLine)) return [];
        const {lexer, tokens} = recognisers[line - 1];
        const stopped = tokens.find(token => token.start === start);
        const before = tokens.filter(token => token.kind !== "white" && token.end <= start);
        const previous = before.at(-1);
        const next = tokens.find(
            token => token.kind !== "white" && token.start >= (stopped?.end ?? end),
        );
        const atEnd = !next || next.text === ":" || next.kw?.keyword === "ELSE";
        const statementStart = before.slice(0, -1).every(token => token.kind === "linenum");
        const message = problemMessage(
            problem,
            {
                at: stopped?.text ?? lexer.text.slice(start, end).trim(),
                previous: previous?.text,
                atEnd,
                statementName: previous?.kind === "name" && statementStart,
            },
            dialect,
        );
        const severity = unfinished ? MarkerSeverity.Warning : MarkerSeverity.Error;
        return [marker(severity, line, start, end, {message, ...(code && {code})})];
    });
}

// The keyword that a name, typed in capitals, would be read as in full (with the ( that ends LEFT$( and the like), or
// null: a name BASIC reads as a variable with the lower case letters it has.
function upperCaseKeyword(line, token, dialect) {
    const name = line.slice(token.start, token.end);
    if (name !== name.toLowerCase()) return null;
    const [first] = lexLine(name.toUpperCase() + line.slice(token.end, token.end + 1), dialect);
    return first.kind === "keyword" && first.text === first.kw.keyword && first.end >= name.length
        ? first
        : null;
}

function lineWarnings(line, lineTokens, dialect) {
    const warnings = [];
    const warn = (start, length, details) =>
        warnings.push({start, end: start + length, ...details});

    const isName = token => token.kind !== "fnname" && (token.invalid || token.kind === "name");
    for (const token of lineTokens.filter(isName)) {
        const keyword = upperCaseKeyword(line, token, dialect);
        // Don't warn about lower case versions of immediate commands, e.g. `new`.
        if (!keyword || dialect.immediateCommands.includes(keyword.text)) continue;
        warn(token.start, keyword.end, {
            message: `BASIC keywords should be upper case, did you mean ${keyword.text}?`,
            code: LowerCaseKeywordCode,
        });
    }
    for (const token of lineTokens.filter(token => token.invalid)) {
        const rest = token.abbreviation && /^\w+/.exec(line.slice(token.end + 1));
        if (rest) {
            const abbreviation = `${token.text}.`;
            warn(token.start, abbreviation.length + rest[0].length, {
                message: `${abbreviation} is not read as an abbreviation when followed directly by letters or digits, did you mean "${abbreviation} ${rest[0]}"?`,
                code: SpaceAfterAbbreviationCode,
            });
            continue;
        }
        // Every operator in the table is two characters long.
        const operator = line.substr(token.start, 2);
        if (ForeignOperators.get(operator)) {
            warn(token.start, 2, {
                message: `${operator} is not a BBC BASIC operator, did you mean ${ForeignOperators.get(operator)}?`,
                code: ForeignOperatorCode,
            });
        }
    }
    return warnings;
}
