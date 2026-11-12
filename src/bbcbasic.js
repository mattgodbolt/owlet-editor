import {languages, MarkerSeverity} from "monaco-editor/esm/vs/editor/editor.api";
import {Flags, keywords, immediateCommands} from "./tokens";

export const LanguageId = "BBCBASIC";

function escape(token) {
    return token.replace("$", "\\$").replace("(", "\\(").replace(".", "\\.");
}

const byLength = names => [...names].sort((x, y) => y.length - x.length);

function keywordsRegex(names) {
    return byLength(names).map(escape).join("|");
}

const conditionalTokens = new Set(
    keywords.filter(kw => kw.flags & Flags.Conditional).map(kw => kw.keyword),
);

function tokensRegex(kws) {
    return byLength(kws.map(kw => kw.keyword))
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
const allTokensForAsmRegex = keywordsRegex(expressionKeywords.map(kw => kw.keyword));
const logicalOperatorsRegex = "AND|OR|EOR|MOD|DIV|NOT|[\\u0180-\\u0184\\xac]";
const allByteTokensRegex = byteTokensRegex(keywords);
const TopRegex = "TOP|\\xb8P";

// The "Conditional" bit applies even to abbreviations, so "F.A=H.TO8^5" is
// parsed as a variable named "H" followed by ".", and BASIC reports error
// "No such variable" if "H" isn't a variable or "No TO" if it is.
const invalidAbbreviatedTokensRegex = abbreviations
    .filter(abbreviation => abbreviatedKeyword(abbreviation).flags & Flags.Conditional)
    .map(abbreviation => escape(abbreviation) + "[a-zA-Z0-9]+")
    .join("|");

const invalidAbbreviatedTokenAtStart = new RegExp(`^(?:${invalidAbbreviatedTokensRegex})`);

// The abbreviations of LEFT$(, MID$(, RIGHT$( and STRING$( that keep their "$".
const abbreviatedDollarTokensRegex = `(${openParenKeywords
    .filter(kw => kw.keyword.endsWith("$("))
    .map(kw => kw.keyword.slice(0, -2))
    .join("|")})\\$\\.`;

const AsmMnemonic =
    /ADC|AND|ASL|B(CC|CS|EQ|MI|NE|PL|VC|VS)|BIT|BRK|CL[CDIV]|CMP|CP[XY]|DE[CXY]|EOR|IN[CXY]|JMP|JSR|LD[AXY]|LSR|NOP|ORA|PH[AP]|PL[AP]|RO[LR]|RTI|RTS|SBC|SE[CDI]|ST[AXY]|TA[XY]|TSX|TX[AS]|TYA/;
const AsmDirective = /OPT|EQU[BDSW]/;

const anyTokenRegex = `${allTokensRegex}|${allByteTokensRegex}|${abbreviatedDollarTokensRegex}`;

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
    const begunStatements = [...statementKeywords].filter(statement =>
        notStatementKeywords.some(
            kw => statement !== kw.keyword && statement.startsWith(kw.keyword),
        ),
    );
    // A conditional keyword's abbreviation followed by a letter or digit is a name.
    const notStatementAbbreviations = abbreviations
        .filter(abbreviation => notStatementKeywords.includes(abbreviatedKeyword(abbreviation)))
        .map(
            abbreviation =>
                escape(abbreviation) +
                (abbreviatedKeyword(abbreviation).flags & Flags.Conditional
                    ? "(?![a-zA-Z0-9])"
                    : ""),
        );
    return new RegExp(
        `(?!${keywordsRegex(begunStatements)})` +
            `(?:${[...notStatementAbbreviations, tokensRegex(notStatementKeywords), byteTokensRegex(notStatementTokens)].join("|")})`,
    );
})();

// Every way of typing a token that ends in "(" (e.g. RIGHT$(, RI., RIGHT$., or the raw token character). Monaco's
// bracket matching scans the text, so it needs these as openers to pair them with their ")".
const hiddenOpenParens = [
    ...openParenKeywords.flatMap(kw => [kw.keyword, tokenChar(kw)]),
    ...abbreviations.filter(abbreviation => abbreviatedKeyword(abbreviation).keyword.endsWith("(")),
];

// Monaco compares bracket text lower-cased, so a raw opener such as LEFT$( (U+00C0) also matches the raw token that is
// its lower-case form (END, U+00E0). Those are tagged "string", which keeps them out of bracket matching.
const bracketCollisionRegex = (() => {
    const tokenChars = new Set(keywords.map(tokenChar));
    const collisions = openParenKeywords
        .map(kw => tokenChar(kw).toLowerCase())
        .filter(
            lower =>
                tokenChars.has(lower) && !openParenKeywords.some(kw => tokenChar(kw) === lower),
        );
    return new RegExp(`[${collisions.join("")}]`);
})();

const UnterminatedString = /"([^"\n]|"")*(?=\n|$)/;
// STR$ takes one ~, though a PRINT item can start with any number.
const StrTilde = [
    new RegExp(`(${forms("STR$")})([ \\t]*)(~)((?:[ \\t]*~)*)`),
    ["keyword", "white", "operator", "invalid"],
];
// An operator, separator or "(" after which an operand is expected.
const BeforeOperand = {cases: {"\\(": "@brackets", "@operators": "operator", "@default": "symbol"}};

export function registerBbcBasicLanguage() {
    languages.register({id: LanguageId});

    languages.setMonarchTokensProvider(LanguageId, {
        defaultToken: "invalid",
        includeLF: true,
        brackets: [["(", ")", "delimiter.parenthesis"]],
        operators: [
            "+",
            "-",
            "*",
            "/",
            "^",
            "=",
            "<>",
            "<",
            ">",
            "<=",
            ">=",
            "$",
            "?",
            ";",
            ",",
            "!",
            "'",
        ],
        tokenPrefix: abbreviations,
        symbols: /[-+=><!*/:?$;,^']+/,
        tokenizer: {
            root: [
                {include: "@whitespace"},
                [/\d+/, "constant.linenum"],
                [notStatementRegex, "invalid", "@statement"],
                [/(?=[^*])/, "", "@statement"],
                [/\*.*/, "keyword.oscli.string"], // "string" keeps bracket matching out; the theme colours it as keyword.oscli
            ],
            statement: [
                ["\n", "", "@pop"],
                [":", "symbol", "@pop"],
                [new RegExp(`(${forms("REM")})(.*)`), ["keyword", "comment"]],
                [new RegExp(forms("FN", "PROC")), {token: "keyword", next: "@fnProcName"}],
                [new RegExp(forms("DATA")), {token: "keyword", switchTo: "@dataStatement"}],
                [
                    new RegExp(`(?:${forms("PRINT", "INPUT")})(?=[ \\t]*#)`),
                    "keyword",
                    "@optionalHash",
                ],
                // A state ending ".list" is one in which a value can directly follow another, as in PRINT X"a".
                [new RegExp(forms("PRINT")), {token: "keyword", switchTo: "@printStatement.list"}],
                [new RegExp(forms("VDU")), {token: "keyword", switchTo: "@statement.list"}],
                [invalidAbbreviatedTokensRegex, "invalid"],
                [
                    new RegExp(forms("BGET", "BPUT", "CLOSE", "EOF", "EXT", "PTR")),
                    {token: "keyword", next: "@optionalHash"},
                ],
                [new RegExp(forms("THEN", "ELSE", "REPEAT")), "keyword", "@pop"],
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
                        `(${logicalOperatorsRegex}|${keywordsRegex(openParenKeywords.map(kw => kw.keyword))})([ \\t]*)(~)`,
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
                    new RegExp(
                        `(?:${allTokensRegex}|${allByteTokensRegex}|[A-Z]+\\.)(?=[ \\t]*(${TopRegex}))`,
                    ),
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
            // FN and PROC names can start with a digit.
            fnProcName: [
                [/[a-zA-Z0-9_]+/, "variable", "@pop"],
                ["", "", "@pop"],
            ],
            strayDot: [[/\.\d*/, "invalid", "@pop"]],
            optionalHash: [{include: "@whitespace"}, ["#", "symbol", "@pop"], ["", "", "@pop"]],
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
                [AsmMnemonic, {token: "keyword", switchTo: "@asmBody"}],
                [AsmDirective, {token: "keyword.directive", switchTo: "@asmBody"}],
                {include: "@asmCommon"},
            ],
            asmBody: [
                [/^/, {token: "", switchTo: "@asm"}],
                [/;[^:]*/, "comment"],
                [":", {token: "symbol", switchTo: "@asm"}],
                [AsmMnemonic, "keyword"],
                [AsmDirective, "keyword.directive"],
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
                        `${TopRegex}|${allTokensForAsmRegex}|${byteTokensRegex(expressionKeywords)}`,
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
            ],
        },
    });

    languages.setLanguageConfiguration(LanguageId, {
        comments: {
            lineComment: "REM",
        },
        brackets: [
            ["[", "]"],
            ["(", ")"],
            ...hiddenOpenParens.map(open => [open.toLowerCase(), ")"]),
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

    languages.registerCodeActionProvider(LanguageId, codeActionProvider);
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

export function getWarnings(lineNum, line, lineTokens) {
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

    for (const token of lineTokens.filter(token => token.type === `variable.${LanguageId}`)) {
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
