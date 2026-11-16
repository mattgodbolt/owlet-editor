import {languages, MarkerSeverity} from "monaco-editor/esm/vs/editor/editor.api";
import {Flags, keywords, immediateCommands, tokenChar} from "./tokens";
import {StandaloneServices} from "monaco-editor/esm/vs/editor/standalone/browser/standaloneServices";
import {IStandaloneThemeService} from "monaco-editor/esm/vs/editor/standalone/common/standaloneTheme";
import {ILanguageService} from "monaco-editor/esm/vs/editor/common/languages/language";
import {programProblems, readLines, tokensProvider} from "./parser/highlight";
import {lexLine} from "./parser/lexer";
import {ForeignOperators} from "./parser/recogniser";
import {isBasicIV, setBasicIV} from "./parser/dialect";
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

const openParenKeywords = keywords.filter(kw => kw.keyword.endsWith("("));
let registrations = [];

/** Follows the Master's BASIC IV rather than BASIC II, and has the editor read its text again. */
export function useBasicIV(enabled) {
    if (Boolean(enabled) === isBasicIV()) return;
    setBasicIV(enabled);
    if (registrations.length) registerBbcBasicLanguage();
}

export function registerBbcBasicLanguage() {
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
        languages.setTokensProvider(LanguageId, tokensProvider(LanguageId, tokenMetadata)),
        configuration,
        languages.registerCodeActionProvider(LanguageId, codeActionProvider),
    ];
}

// With thanks to https://stackoverflow.com/questions/57994101/show-quick-fix-for-an-error-in-monaco-editor
export const codeActionProvider = {
    provideCodeActions(model, range, context) {
        // Only the warnings above come with a fix; the text under any other marker is not to be rewritten.
        const fixable = context.markers.filter(marker => QuickFixCodes.has(marker.code));
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
};

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

const marker = (severity, line, start, end, details) => ({
    severity,
    ...details,
    startLineNumber: line,
    startColumn: start + 1,
    endLineNumber: line,
    endColumn: end + 1,
});

// The warnings for each line of the program.
export function getWarnings(text) {
    return readLines(text).flatMap(({lexer, tokens}, i) =>
        lineWarnings(lexer.text, tokens).map(({start, end, ...details}) =>
            marker(MarkerSeverity.Warning, i + 1, start, end, details),
        ),
    );
}

// The markers for the lines BASIC would stop at, and for those that end too soon or have something missing. A line is unfinished while the cursor is on it (`cursorLine`) and so is not marked then,
// and a warning that covers the same text says enough.
export function getSyntaxMarkers(text, cursorLine = 0) {
    const recognisers = readLines(text);
    const warnings = recognisers.map(({lexer, tokens}) => lineWarnings(lexer.text, tokens));
    return programProblems(text, recognisers).flatMap(
        ({line, start, end, message, unfinished, hole, unclosed, stricter, code}) => {
            const covered = warnings[line - 1].some(
                warning => warning.start < end && start < warning.end,
            );
            if (covered || (unfinished && line === cursorLine)) return [];
            const rom = message ? ` with "${message}"` : "";
            const text = unclosed
                ? "Assembler block not closed: there is no ] after this ["
                : stricter
                  ? message
                  : unfinished
                    ? hole
                        ? `Unfinished statement: BASIC would stop${rom} here`
                        : `Unfinished line${message ? `: BASIC would stop${rom} if it ended here` : ""}`
                    : `${message || "Error"}: BASIC would stop at this statement`;
            const severity = unfinished ? MarkerSeverity.Warning : MarkerSeverity.Error;
            return [marker(severity, line, start, end, {message: text, ...(code && {code})})];
        },
    );
}

// The keyword that a name, typed in capitals, would be read as in full (with the ( that ends LEFT$( and the like), or
// null: a name BASIC reads as a variable with the lower case letters it has.
function upperCaseKeyword(line, token) {
    const name = line.slice(token.start, token.end);
    if (name !== name.toLowerCase()) return null;
    const [first] = lexLine(name.toUpperCase() + line.slice(token.end, token.end + 1));
    return first.kind === "keyword" && first.text === first.kw.keyword && first.end >= name.length
        ? first
        : null;
}

function lineWarnings(line, lineTokens) {
    const warnings = [];
    const warn = (start, length, details) =>
        warnings.push({start, end: start + length, ...details});

    const isName = token => token.invalid || token.kind === "name" || token.kind === "fnname";
    for (const token of lineTokens.filter(isName)) {
        const keyword = upperCaseKeyword(line, token);
        // Don't warn about lower case versions of immediate commands, e.g. `new`.
        if (!keyword || immediateCommands.includes(keyword.text)) continue;
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
