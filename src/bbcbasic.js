import {editor, languages, MarkerSeverity} from "monaco-editor/editor/editor.api";
import {Flags, keywords, tokenChar} from "./tokens";
import {StandaloneServices} from "monaco-editor/editor/standalone/browser/standaloneServices";
import {IStandaloneThemeService} from "monaco-editor/editor/standalone/common/standaloneTheme";
import {ILanguageService} from "monaco-editor/editor/common/languages/language";
import {programProblems, readLines, tokensProvider} from "./parser/highlight";
import {lexLine} from "./parser/lexer";
import {problemMessage} from "./problem-messages";
import {ForeignOperators} from "./parser/recogniser";
import {
    CapitaliseRegisterCode,
    JunkAfterInstructionCode,
    SpaceAfterMnemonicCode,
} from "./parser/assembler";

export const LanguageId = "BBCBASIC";

// The spellings of the dialect's keywords, longest first so that the longer of PRINT and PRINT# wins, with a Conditional
// one (which BASIC reads as a name when a name character follows) ending where no name character follows.
function keywordWordPattern(dialect) {
    const conditional = new Set(
        dialect.keywords.filter(kw => kw.flags & Flags.Conditional).map(kw => kw.keyword),
    );
    return [...new Set(dialect.keywords.map(kw => kw.keyword))]
        .sort((x, y) => y.length - x.length)
        .map(word => word.replace(/[$(]/g, "\\$&") + (conditional.has(word) ? "(?![\\w`])" : ""))
        .join("|");
}

// Separates 10PRINT into "10" "PRINT" and PRINTLN12 into "PRINT" "LN" "12", where Monaco's default would not. What
// follows a "&" or the FN or PROC before it is read as hex digits or a name, so that no keyword starts inside it
// (&FFTO, PROCPRINT), as the lexer reads it; a "$" ends a name (A$TAN). It is tried against the lexer's keywords in
// test/word_pattern_test.js.
export const wordPatternFor = dialect =>
    new RegExp(
        [
            "(?<=&)[0-9A-F]+",
            "(?<=FN|PROC)[\\w`]+[$%]?",
            `(?<keyword>${keywordWordPattern(dialect)})`,
            "@%",
            "-?\\d*\\.\\d+",
            "-?\\d+",
            "[^~!@#$%^&*()\\-=+[{\\]}\\\\|;:'\",.<>/?\\s]+[$%]?",
        ].join("|"),
        "g",
    );

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

// BASIC IV adds no keyword that ends in "(", so BASIC II's table gives the same list for both dialects.
const openParenKeywords = keywords.filter(kw => kw.keyword.endsWith("("));
let registrations = [];

/** Has the editor read its BBC BASIC by the dialect, in place of the one it was reading by. */
export function registerBbcBasicLanguage(dialect) {
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
        wordPattern: wordPatternFor(dialect),
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
        // Only the markers with a code in QuickFixCodes come with a fix; the text under any other is not to be
        // rewritten. The editor's markers carry no code (Monaco would show it in the hover), so it is found from the
        // text again.
        let known = null;
        const codeOf = marker => {
            if (marker.code) return marker.code;
            const text = model.getValue();
            known = known || [...getWarnings(text, dialect), ...getSyntaxMarkers(text, dialect)];
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
            if (marker.code === CapitaliseRegisterCode) {
                const register = text[0];
                const at = {
                    ...marker,
                    endLineNumber: marker.startLineNumber,
                    endColumn: marker.startColumn + 1,
                };
                return quickFix(
                    model,
                    marker,
                    `Replace ${register} with ${register.toUpperCase()}`,
                    at,
                    register.toUpperCase(),
                );
            }
            const replacement = ForeignOperators.get(text) || text.toUpperCase();
            return quickFix(model, marker, `Replace with ${replacement}`, marker, replacement);
        });
        return {actions, dispose: () => {}};
    },
});

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
    CapitaliseRegisterCode,
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
export function getWarnings(text, dialect) {
    return readLines(text, dialect).flatMap(({lexer, tokens}, i) =>
        lineWarnings(lexer.text, tokens, dialect).map(({start, end, ...details}) =>
            marker(MarkerSeverity.Warning, i + 1, start, end, details),
        ),
    );
}

// The markers for the lines BASIC would stop at, and for those that end too soon or have something missing. A line is unfinished while the cursor is on it (`cursorLine`) and so is not marked then,
// and a warning that covers the same text says enough.
export function getSyntaxMarkers(text, dialect, cursorLine = 0) {
    const recognisers = readLines(text, dialect);
    const warnings = recognisers.map(({lexer, tokens}) =>
        lineWarnings(lexer.text, tokens, dialect),
    );
    return programProblems(recognisers).flatMap(problem => {
        const {line, start, end, unfinished, code} = problem;
        const covered = warnings[line - 1].some(
            warning => warning.start < end && start < warning.end,
        );
        if (covered || (unfinished && line === cursorLine)) return [];
        const {lexer, tokens} = recognisers[line - 1];
        const stopped = tokens.find(token => token.start === start);
        const before = tokens.filter(token => token.kind !== "white" && token.end <= start);
        const previous = before.at(-1);
        const statementStart = before.slice(0, -1).every(token => token.kind === "linenum");
        const message = problemMessage(
            problem,
            {
                at: stopped?.text ?? lexer.text.slice(start, end).trim(),
                previous: previous?.text,
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
    // BASIC reads 1ER.a$ as 1E, R and .a$, which can be valid (so it is not marked), but is rarely what was meant.
    const followsNumber = (token, i) =>
        lineTokens[i - 1]?.kind === "number" && lineTokens[i - 1].end === token.start;
    for (const [i, token] of lineTokens.entries()) {
        if (!token.invalid && !followsNumber(token, i)) continue;
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
