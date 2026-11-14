import {editor, languages, MarkerSeverity} from "monaco-editor/esm/vs/editor/editor.api";
import {Flags, keywords, immediateCommands} from "./tokens";
import {StandaloneServices} from "monaco-editor/esm/vs/editor/standalone/browser/standaloneServices";
import {IStandaloneThemeService} from "monaco-editor/esm/vs/editor/standalone/common/standaloneTheme";
import {ILanguageService} from "monaco-editor/esm/vs/editor/common/languages/language";
import {programProblems, tokensProvider} from "./parser/highlight";
import {BracketCollisions} from "./parser/lexer";

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

export const allTokensRegex = tokensRegex(keywords);

export function tokenChar(kw) {
    return String.fromCodePoint(kw.token < 160 ? kw.token + 0x100 : kw.token);
}

function byteTokensRegex(kws) {
    return `[${kws.map(tokenChar).join("")}]`;
}

// BASIC expands an abbreviation to the first keyword in the table with its prefix.
export function abbreviatedKeyword(abbreviation) {
    return keywords.find(kw => kw.keyword.startsWith(abbreviation.slice(0, -1)));
}

const abbreviations = [
    ...new Set(
        keywords.flatMap(({keyword}) =>
            Array.from({length: keyword.length - 1}, (_, i) => `${keyword.slice(0, i + 1)}.`),
        ),
    ),
];

// Every way of typing these keywords: in full, abbreviated or as a token character.
function forms(...names) {
    const kws = keywords.filter(kw => names.includes(kw.keyword));
    return [
        tokensRegex(kws),
        ...abbreviations.filter(a => names.includes(abbreviatedKeyword(a).keyword)).map(escape),
        byteTokensRegex(kws),
    ].join("|");
}

const openParenKeywords = keywords.filter(kw => kw.keyword.endsWith("("));
const expressionKeywords = keywords.filter(kw => kw.flags & Flags.Expr);
const logicalOperatorsRegex = "AND|OR|EOR|MOD|DIV|NOT|[\\u0180-\\u0184\\xac]";
const allByteTokensRegex = byteTokensRegex(keywords);
const TopRegex = "TOP|\\xb8P";

// The "Conditional" bit applies even to abbreviations, so "F.A=H.TO8^5" is
// parsed as a variable named "H" followed by ".", and BASIC reports error
// "No such variable" if "H" isn't a variable or "No TO" if it is.
const invalidAbbreviatedTokensRegex = abbreviations
    .filter(abbreviation => abbreviatedKeyword(abbreviation).flags & Flags.Conditional)
    .map(abbreviation => escape(abbreviation) + "\\w+")
    .join("|");

const invalidAbbreviatedTokenAtStart = new RegExp(`^(?:${invalidAbbreviatedTokensRegex})`);

// BASIC reads a mnemonic, OPT and the EQU of a directive in either case, but the accumulator, an index register and
// the size of an EQU only in upper case, except that LDX and STX take y and LDY and STY take x.
const anyCase = text => text.replace(/[A-Z]/g, letter => `[${letter}${letter.toLowerCase()}]`);
const mnemonics = names => names.split(" ").map(anyCase).join("|");
const AsmShift = mnemonics("ASL LSR ROL ROR");
const AsmIndexed = new RegExp(
    `${AsmShift}|${mnemonics("ADC AND CMP DEC EOR INC LDA ORA SBC STA")}`,
);
const AsmIndexedByY = new RegExp(mnemonics("LDX STX"));
const AsmIndexedByX = new RegExp(mnemonics("LDY STY"));
const AsmMnemonic = new RegExp(
    mnemonics(
        "BCC BCS BEQ BIT BMI BNE BPL BRK BVC BVS CLC CLD CLI CLV CPX CPY DEX DEY INX INY JMP JSR NOP " +
            "PHA PHP PLA PLP RTI RTS SEC SED SEI TAX TAY TSX TXA TXS TYA",
    ),
);
const AsmDirective = new RegExp(`${anyCase("OPT")}|${anyCase("EQU")}[BDSW]`);
const AsmBadDirective = new RegExp(`${anyCase("EQU")}[bdsw]`);

const anyTokenRegex = `${allTokensRegex}|${allByteTokensRegex}`;

// BASIC II starts a statement only with a token from &C6 up (they include the statement forms of PTR, PAGE, TIME,
// LOMEM and HIMEM) or ELSE, which skips the rest of the line. BASIC IV would add ERROR.
export const FirstStatementToken = 0xc6;
export const statementKeywords = new Set([
    "ELSE",
    ...keywords.filter(kw => kw.token >= FirstStatementToken).map(kw => kw.keyword),
]);
const notStatementKeywords = keywords.filter(kw => !statementKeywords.has(kw.keyword));
// By token number, not name: PTR, PAGE, TIME, LOMEM and HIMEM have a statement token and a different expression one.
const notStatementTokens = keywords.filter(
    kw => kw.token < FirstStatementToken && kw.keyword !== "ELSE",
);
const notStatementRegex = (() => {
    // MOD begins MODE.
    const begunStatements = keywords.filter(
        statement =>
            statementKeywords.has(statement.keyword) &&
            notStatementKeywords.some(
                kw => statement.keyword !== kw.keyword && statement.keyword.startsWith(kw.keyword),
            ),
    );
    // A conditional keyword's abbreviation followed by a letter, digit or _ is a name.
    const notStatementAbbreviations = abbreviations
        .filter(abbreviation => notStatementKeywords.includes(abbreviatedKeyword(abbreviation)))
        .map(
            abbreviation =>
                escape(abbreviation) +
                (abbreviatedKeyword(abbreviation).flags & Flags.Conditional ? "(?!\\w)" : ""),
        );
    return new RegExp(
        `(?!${tokensRegex(begunStatements)})` +
            `(?:${[...notStatementAbbreviations, tokensRegex(notStatementKeywords), byteTokensRegex(notStatementTokens)].join("|")})`,
    );
})();

// Every way of typing a token that ends in "(" (e.g. RIGHT$(, RI., RIGHT$., or the raw token character). Monaco's
// bracket matching scans the text, so it needs these as openers to pair them with their ")".
const hiddenOpenParens = [
    ...openParenKeywords.flatMap(kw => [kw.keyword, tokenChar(kw)]),
    ...abbreviations.filter(abbreviation => abbreviatedKeyword(abbreviation).keyword.endsWith("(")),
];

const bracketCollisionRegex = new RegExp(`[${[...BracketCollisions].join("")}]`);

// The tokeniser reads the numbers after these as line numbers. THEN and ELSE also end their statement.
const lineNumberKeywords = keywords
    .filter(kw => kw.flags & Flags.LineNumber && !["THEN", "ELSE"].includes(kw.keyword))
    .map(kw => kw.keyword);

const AsmOpener = [...hiddenOpenParens.map(escape), "[a-zA-Z_]\\w*[$%]?\\("].join("|");

const UnterminatedString = /"([^"\n]|"")*(?=\n|$)/;
// STR$ takes one ~, though a PRINT item can start with any number.
const StrTilde = [
    new RegExp(`(${forms("STR$")})([ \\t]*)(~)((?:[ \\t]*~)*)`),
    ["keyword", "white", "operator", "invalid"],
];
// An operator, separator or "(" after which an operand is expected.
const BeforeOperand = {cases: {"\\(": "@brackets", "@operators": "operator", "@default": "symbol"}};

// Monaco's MetadataConsts.BALANCED_BRACKETS_MASK: it looks for brackets only in the text of tokens that have it, and
// keeps neighbours that differ in it apart, so an opener such as LE. is found though the keyword before it touches it.
const BalancedBrackets = 1024;

function tokenMetadata(scopes, bracket) {
    const theme = StandaloneServices.get(IStandaloneThemeService).getColorTheme().tokenTheme;
    const language =
        StandaloneServices.get(ILanguageService).languageIdCodec.encodeLanguageId(LanguageId);
    return (theme.match(language, scopes) | (bracket ? BalancedBrackets : 0)) >>> 0;
}

// ?parser=new in the URL picks the tokenizer in src/parser over the Monarch grammar below, for the same language.
let newParser = false;
let registrations = [];

export function registerBbcBasicLanguage(
    parser = new URLSearchParams(window.location.search).get("parser"),
) {
    if (registrations.length === 0) languages.register({id: LanguageId});
    for (const registration of registrations) registration.dispose();
    newParser = parser === "new";

    const grammar = {
        defaultToken: "invalid",
        includeLF: true,
        brackets: [["(", ")", "delimiter.parenthesis"]],
        operators: "+ - * / ^ = <> < > <= >= $ ? ; , ! '".split(" "),
        tokenPrefix: abbreviations,
        symbols: /[-+=><!*/:?$;,^']+/,
        tokenizer: {
            root: [
                [/^([ \t]*)(\d+)/, ["white", "constant.linenum"]], // the line's own number
                {include: "@whitespace"},
                [notStatementRegex, "invalid", "@statement"],
                [/(?=[^*])/, "", "@statement"],
                [/\*.*/, "keyword.oscli.string"], // "string" keeps bracket matching out; the theme colours it as keyword.oscli
            ],
            statement: [
                ["\n", "", "@pop"],
                [":", "symbol", "@pop"],
                [new RegExp(`(${forms("REM")})(.*)`), ["keyword", "comment"]],
                // FN and PROC names can start with a digit.
                [new RegExp(`(${forms("FN", "PROC")})(\\w*)`), ["keyword", "variable"]],
                [new RegExp(forms("DATA")), {token: "keyword", switchTo: "@dataStatement"}],
                [
                    new RegExp(`(${forms("PRINT", "INPUT")})([ \\t]*)(#)`),
                    ["keyword", "white", "symbol"],
                ],
                // A state ending ".list" is one in which a value can directly follow another, as in PRINT X"a".
                [new RegExp(forms("PRINT")), {token: "keyword", switchTo: "@printStatement.list"}],
                [new RegExp(forms("VDU")), {token: "keyword", switchTo: "@statement.list"}],
                [invalidAbbreviatedTokensRegex, "invalid"],
                [
                    new RegExp(
                        `(${forms("BGET", "BPUT", "CLOSE", "EOF", "EXT", "PTR")})([ \\t]*)(#?)`,
                    ),
                    ["keyword", "white", "symbol"],
                ],
                [new RegExp(forms("THEN", "ELSE")), {token: "keyword", switchTo: "@lineNumbers"}],
                [new RegExp(forms("REPEAT")), "keyword", "@pop"],
                [
                    new RegExp(forms(...lineNumberKeywords)),
                    {
                        cases: {
                            [bracketCollisionRegex.source]: {
                                token: "keyword.string",
                                next: "@lineNumbers",
                            },
                            "@default": {token: "keyword", next: "@lineNumbers"},
                        },
                    },
                ],
                // A number after ERROR is not a line number, but a * command may follow ON ERROR.
                [new RegExp(`(?:${forms("ERROR")})(?=[ \\t]*\\*)`), "keyword", "@pop"],
                StrTilde,
                [new RegExp(forms("FOR")), {token: "keyword", switchTo: "@forStatement"}],
                [bracketCollisionRegex, "keyword.string"],
                [new RegExp(`${TopRegex}|${anyTokenRegex}`), "keyword"],
                // Not an abbreviation, so a name then a dot: the number "." in a list (P.X. prints X then 0), and
                // otherwise a syntax error.
                [
                    /[a-zA-Z_]\w*[$%]?\./,
                    {
                        cases: {
                            "@tokenPrefix": "keyword",
                            "$S2==list": {token: "variable", goBack: 1},
                            "@default": {token: "variable", goBack: 1, next: "@strayDot"},
                        },
                    },
                ],
                {include: "@common"},
                ["\\[", {token: "delimiter.square", next: "@asm"}],
            ],
            // `~` (hex) is only valid at the start of a PRINT item, never after an operator or `(`.
            printStatement: [
                // A separator is split from any operator that follows it, so `;-~B` is caught below.
                [/[;,']/, "operator"],
                [/([-+=<>*/^!?$]+|\()([ \t]*)(~)/, [BeforeOperand, "white", "invalid"]],
                [
                    new RegExp(
                        `(${logicalOperatorsRegex}|${tokensRegex(openParenKeywords)})([ \\t]*)(~)`,
                    ),
                    ["keyword", "white", "invalid"],
                ],
                [/~/, "operator"],
                {include: "@statement"},
            ],
            // In a FOR statement TO ends the loop's start expression, except where an operand is expected:
            // there the tokeniser's TO followed by P is TOP.
            forStatement: [
                [
                    new RegExp(`([-+=<>*/^,!?$]+|\\()([ \\t]*)(${TopRegex})`),
                    [BeforeOperand, "white", "keyword"],
                ],
                [new RegExp(forms("TO")), {token: "keyword", switchTo: "@statement"}],
                [invalidAbbreviatedTokensRegex, "invalid"],
                // A function or other keyword that takes an operand, as in `ABS TOP` or `AB. TOP`.
                [
                    new RegExp(`(?:${anyTokenRegex}|[A-Z]+\\.)(?=[ \\t]*(${TopRegex}))`),
                    {
                        cases: {
                            "@tokenPrefix": {token: "keyword", next: "@forOperand"},
                            "[A-Z]+\\.": {token: "variable", goBack: 1, next: "@strayDot"},
                            "@default": {token: "keyword", next: "@forOperand"},
                        },
                    },
                ],
                {include: "@statement"},
            ],
            forOperand: [{include: "@whitespace"}, [new RegExp(TopRegex), "keyword", "@pop"]],
            common: [
                {include: "@whitespace"},
                [/~/, "invalid"],
                // Operators from other languages: C, Fortran, Python, Apple ][ BASIC and others.
                [/[=!]=|\*\*|><|=[<>]|[-+/*^]=|<<|>>/, "invalid"],
                ["@symbols", {cases: {"@operators": "operator", "@default": "symbol"}}],
                [/(\d+\.?\d*|\.\d+)E(?=\.)/, "number.float"], // an empty exponent: the next item is ".5" or ".X"
                [/\d*\.\d*(E[-+\d]\d*)?|\d+E[-+\d]\d*/, "number.float"],
                [/\d+/, "number"],
                [/&[0-9A-F]+/, "number.hex"],
                [/[()]/, "@brackets"],
                [/[a-zA-Z_]\w*[$%]?/, "variable"],
                [UnterminatedString, "invalid.string"],
                ['"', {token: "string.quote", next: "@string"}],
                // We treat @% as a regular variable (see #28).
                ["@%", "variable"],
            ],
            // As in the tokeniser, a space or comma does not end the list but anything else does: GOTO 10*2 is to line 10.
            lineNumbers: [
                {include: "@whitespace"},
                [/\d+/, "constant.linenum"],
                [/&[0-9A-F]+/, "number.hex"],
                [",", "operator"],
                ["", "", "@pop"],
            ],
            strayDot: [[/\.\d*/, "invalid", "@pop"]],
            // Not the newline, which would carry a state such as this statement's on to the next line.
            whitespace: [[/[ \t\r]+/, "white"]],
            string: [
                [/[^"]+/, "string"],
                ['"', {token: "string.quote", next: "@pop"}],
            ],
            dataStatement: [
                ["\n", "", "@pop"],
                [",", "symbol"],
                {include: "@whitespace"},
                [UnterminatedString, "string"],
                ['"', {token: "string.quote", next: "@string"}],
                [/[^,\n]*[^,\n ]/, "string.unquoted"],
            ],
            // After a mnemonic or directive the rest of the statement is ignored by the ROM, so a ; comment can say anything.
            asm: [
                [
                    new RegExp(`(${AsmShift})( *)(A)(?![\\w$%])`),
                    ["keyword", "white", {token: "keyword", switchTo: "@asmBody"}],
                ],
                // A state's suffix is the index register, if any, that BASIC takes in lower case after the mnemonic.
                // BASIC reads ORA as the OR token then A, which it takes only in upper case.
                [/ORa/, "invalid"],
                [AsmIndexed, {token: "keyword", switchTo: "@asmIndexed.none"}],
                [AsmIndexedByY, {token: "keyword", switchTo: "@asmIndexed.y"}],
                [AsmIndexedByX, {token: "keyword", switchTo: "@asmIndexed.x"}],
                [AsmMnemonic, {token: "keyword", switchTo: "@asmBody"}],
                [AsmDirective, {token: "keyword.directive", switchTo: "@asmBody"}],
                [AsmBadDirective, "invalid"],
                {include: "@asmCommon"},
            ],
            // An operand that can be indexed. BASIC reads no index after an immediate operand, and a comma inside a
            // function's or array's brackets is not one, so the check stops at either.
            asmIndexed: [
                ["#", {token: "symbol", switchTo: "@asmBody"}],
                [new RegExp(`(?=${AsmOpener})`), {token: "", switchTo: "@asmBody"}],
                [/,(?= *[xy])/, {token: "symbol", switchTo: "@asmIndex.$S2"}],
                {include: "@asmBody"},
            ],
            asmBody: [
                [/^/, {token: "", switchTo: "@asm"}],
                [/;[^:]*/, "comment"],
                [":", {token: "symbol", switchTo: "@asm"}],
                {include: "@asmCommon"},
            ],
            asmCommon: [
                [/\\[^:]*/, "comment"],
                StrTilde,
                [/,(?= *[XY]\b)/, {token: "symbol", switchTo: "@asmIndex"}],
                ["#", "symbol"], // Immediate addressing
                [/\.([a-zA-Z_]\w*%?|@%)/, "type.identifier"], // a label
                [bracketCollisionRegex, "invalid.string"],
                [
                    new RegExp(
                        `${TopRegex}|${tokensRegex(expressionKeywords)}|${byteTokensRegex(expressionKeywords)}`,
                    ),
                    "keyword",
                ],
                [new RegExp(`${anyTokenRegex}|${invalidAbbreviatedTokensRegex}`), "invalid"],
                [/^\d+/, "constant.linenum"],
                {include: "@common"},
                ["]", {token: "delimiter.square", next: "@pop"}],
            ],
            asmIndex: [
                {include: "@whitespace"},
                [/[XY]/, {token: "keyword", switchTo: "@asmBody"}],
                [
                    /[xy]/,
                    {
                        cases: {
                            "$#==$S2": {token: "keyword", switchTo: "@asmBody"},
                            "@default": {token: "invalid", switchTo: "@asmBody"},
                        },
                    },
                ],
            ],
        },
    };

    const configuration = languages.setLanguageConfiguration(LanguageId, {
        comments: {
            lineComment: "REM",
        },
        brackets: [
            ["[", "]"],
            ["(", ")"],
            // A spelling that ends in "(" is opened by that "(", which leaves the keyword before it uncoloured as a bracket.
            // The new tokenizer sets the bracket bit on the "." of an abbreviation, and on a raw token.
            ...(newParser ? [".", ...openParenKeywords.map(tokenChar)] : hiddenOpenParens)
                .filter(open => !open.endsWith("("))
                .map(open => [open.toLowerCase(), ")"]),
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
        newParser
            ? languages.setTokensProvider(LanguageId, tokensProvider(LanguageId, tokenMetadata))
            : languages.setMonarchTokensProvider(LanguageId, grammar),
        configuration,
        languages.registerCodeActionProvider(LanguageId, codeActionProvider),
    ];
}

// With thanks to https://stackoverflow.com/questions/57994101/show-quick-fix-for-an-error-in-monaco-editor
export const codeActionProvider = {
    provideCodeActions(model, range, context) {
        const actions = context.markers.map(marker => {
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
    const lines = text.split(/\r?\n/);
    return editor
        .tokenize(text, LanguageId)
        .flatMap((lineTokens, i) => lineWarnings(i + 1, lines[i], lineTokens));
}

// The markers for the lines BASIC would stop at, and for those that end too soon; only the new tokenizer knows either.
export function getSyntaxMarkers(text) {
    if (!newParser) return [];
    return programProblems(text).map(({line, start, end, message, unfinished}) => ({
        severity: unfinished ? MarkerSeverity.Info : MarkerSeverity.Error,
        message: unfinished
            ? `Unfinished line${message ? `: BASIC would stop with "${message}" if it ended here` : ""}`
            : `${message || "Error"}: BASIC would stop at this statement`,
        startLineNumber: line,
        startColumn: start + 1,
        endLineNumber: line,
        endColumn: end + 1,
    }));
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

    // The new tokenizer marks a statement that is only a name, such as "colour", invalid.
    const nameTypes = [`variable.${LanguageId}`, `invalid.${LanguageId}`];
    for (const token of lineTokens.filter(token => nameTypes.includes(token.type))) {
        const match = line.substr(token.offset).match(LowerCaseTokenRegex);
        if (match) {
            const upper = match[0].toUpperCase();
            // Don't warn about lower case versions of immediate commands, e.g. `new`.
            if (immediateCommands.includes(upper)) continue;
            warn(token.offset, match[0].length, {
                message: `BASIC keywords should be upper case, did you mean ${upper}?`,
            });
        }
    }
    for (const token of lineTokens.filter(token => token.type === `invalid.${LanguageId}`)) {
        const abbreviated = line.substr(token.offset).match(invalidAbbreviatedTokenAtStart);
        if (abbreviated) {
            const abbreviation = abbreviated[0].slice(0, abbreviated[0].indexOf(".") + 1);
            warn(token.offset, abbreviated[0].length, {
                message: `${abbreviation} is not read as an abbreviation when followed directly by letters or digits, did you mean "${abbreviation} ${abbreviated[0].slice(abbreviation.length)}"?`,
                code: SpaceAfterAbbreviationCode,
            });
            continue;
        }
        // Every operator in the map is two characters long.
        const badOperator = line.substr(token.offset, 2);
        if (InvalidOperatorMap.has(badOperator)) {
            warn(token.offset, 2, {
                message: `${badOperator} is not a BBC BASIC operator, did you mean ${InvalidOperatorMap.get(badOperator)}?`,
            });
        }
    }
    return warnings;
}
