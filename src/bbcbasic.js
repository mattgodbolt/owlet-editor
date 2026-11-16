import {languages, MarkerSeverity} from "monaco-editor/esm/vs/editor/editor.api";
import {FirstStatementToken, Flags, keywords, immediateCommands, tokenChar} from "./tokens";
import {StandaloneServices} from "monaco-editor/esm/vs/editor/standalone/browser/standaloneServices";
import {IStandaloneThemeService} from "monaco-editor/esm/vs/editor/standalone/common/standaloneTheme";
import {ILanguageService} from "monaco-editor/esm/vs/editor/common/languages/language";
import {programProblems, readLines, tokensProvider} from "./parser/highlight";
import {JunkAfterInstructionCode, SpaceAfterMnemonicCode} from "./parser/assembler";

export const LanguageId = "BBCBASIC";

function escape(token) {
    return token.replace("$", "\\$").replace("(", "\\(").replace(".", "\\.");
}

const conditionalTokens = new Set(
    keywords.filter(kw => kw.flags & Flags.Conditional).map(kw => kw.keyword),
);

function tokensRegex(kws) {
    return kws
        .map(kw => kw.keyword)
        .sort((x, y) => y.length - x.length)
        .map(kw => {
            // A keyword that begins an earlier one in the table is not read before a dot: "END." is ENDPROC.
            const beforeDot = abbreviatedKeyword(`${kw}.`).keyword === kw ? "" : "(?!\\.)";
            return escape(kw) + beforeDot + (conditionalTokens.has(kw) ? "\\b" : "");
        })
        .join("|");
}

const allTokensRegex = tokensRegex(keywords);

// BASIC expands an abbreviation to the first keyword in the table with its prefix.
function abbreviatedKeyword(abbreviation) {
    return keywords.find(kw => kw.keyword.startsWith(abbreviation.slice(0, -1)));
}

const abbreviations = [
    ...new Set(
        keywords.flatMap(({keyword}) =>
            Array.from({length: keyword.length - 1}, (_, i) => `${keyword.slice(0, i + 1)}.`),
        ),
    ),
];

// The "Conditional" bit applies even to abbreviations, so "F.A=H.TO8^5" is
// parsed as a variable named "H" followed by ".", and BASIC reports error
// "No such variable" if "H" isn't a variable or "No TO" if it is.
const invalidAbbreviatedTokensRegex = abbreviations
    .filter(abbreviation => abbreviatedKeyword(abbreviation).flags & Flags.Conditional)
    .map(abbreviation => escape(abbreviation) + "\\w+")
    .join("|");

const invalidAbbreviatedTokenAtStart = new RegExp(`^(?:${invalidAbbreviatedTokensRegex})`);

export const statementKeywords = new Set([
    "ELSE",
    ...keywords.filter(kw => kw.token >= FirstStatementToken).map(kw => kw.keyword),
]);

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
            allTokensRegex +
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
            const replacement = InvalidOperatorMap.get(text) || text.toUpperCase();
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

// A whole lower-case keyword. A name ends at its `$`, and these keywords end at their bracket, so what follows them
// is not part of the name; any other keyword must not be followed by a name character (`radius%` is not RAD).
const nameEndKeywords = keywords.filter(kw => /[($]$/.test(kw.keyword));
const LowerCaseTokenRegex = new RegExp(
    `^(?:(${tokensRegex(nameEndKeywords).toLowerCase()})|(${tokensRegex(keywords.filter(kw => !nameEndKeywords.includes(kw))).toLowerCase()})(?![\\w%$]))`,
);

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

const InvalidOperatorMap = new Map([
    ["==", "="],
    ["!=", "<>"],
    ["**", "^"],
    ["><", "<>"],
    ["=<", "<="],
    ["=>", ">="],
]);

// The warnings for each line of the program.
export function getWarnings(text) {
    return readLines(text).flatMap((recogniser, i) =>
        lineWarnings(i + 1, recogniser.lexer.text, recogniser.tokens),
    );
}

// The markers for the lines BASIC would stop at, and for those that end too soon or have something missing. A line is unfinished while the cursor is on it (`cursorLine`) and so is not marked then,
// and a warning that covers the same text says enough.
export function getSyntaxMarkers(text, cursorLine = 0) {
    const warnings = getWarnings(text);
    return programProblems(text).flatMap(
        ({line, start, end, message, unfinished, hole, unclosed, stricter, code}) => {
            const covered = warnings.some(
                warning =>
                    warning.startLineNumber === line &&
                    warning.startColumn <= end &&
                    start + 1 < warning.endColumn,
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
            return [
                {
                    severity: unfinished ? MarkerSeverity.Warning : MarkerSeverity.Error,
                    message: text,
                    startLineNumber: line,
                    startColumn: start + 1,
                    endLineNumber: line,
                    endColumn: end + 1,
                    ...(code && {code}),
                },
            ];
        },
    );
}

function lineWarnings(lineNum, line, lineTokens) {
    const warnings = [];
    const warn = (offset, length, details) =>
        warnings.push({
            severity: MarkerSeverity.Warning,
            ...details,
            startLineNumber: lineNum,
            startColumn: offset + 1,
            endLineNumber: lineNum,
            endColumn: offset + length + 1,
        });

    const isName = token => token.invalid || token.kind === "name" || token.kind === "fnname";
    for (const token of lineTokens.filter(isName)) {
        const match = line.substr(token.start).match(LowerCaseTokenRegex);
        if (match) {
            const upper = match[0].toUpperCase();
            // Don't warn about lower case versions of immediate commands, e.g. `new`.
            if (immediateCommands.includes(upper)) continue;
            warn(token.start, match[0].length, {
                message: `BASIC keywords should be upper case, did you mean ${upper}?`,
                code: LowerCaseKeywordCode,
            });
        }
    }
    for (const token of lineTokens.filter(token => token.invalid)) {
        const abbreviated = line.substr(token.start).match(invalidAbbreviatedTokenAtStart);
        if (abbreviated) {
            const abbreviation = abbreviated[0].slice(0, abbreviated[0].indexOf(".") + 1);
            warn(token.start, abbreviated[0].length, {
                message: `${abbreviation} is not read as an abbreviation when followed directly by letters or digits, did you mean "${abbreviation} ${abbreviated[0].slice(abbreviation.length)}"?`,
                code: SpaceAfterAbbreviationCode,
            });
            continue;
        }
        // Every operator in the map is two characters long.
        const badOperator = line.substr(token.start, 2);
        if (InvalidOperatorMap.has(badOperator)) {
            warn(token.start, 2, {
                message: `${badOperator} is not a BBC BASIC operator, did you mean ${InvalidOperatorMap.get(badOperator)}?`,
                code: ForeignOperatorCode,
            });
        }
    }
    return warnings;
}
