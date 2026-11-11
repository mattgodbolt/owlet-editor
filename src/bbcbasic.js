import {languages, MarkerSeverity} from "monaco-editor/esm/vs/editor/editor.api";
import {Flags, keywords, immediateCommands} from "./tokens";

function escape(token) {
    return token.replace("$", "\\$").replace("(", "\\(").replace(".", "\\.");
}

function isExpressionToken(keyword) {
    // Does this token look like it'd be useful in an expression. Used to find sensible things to tokenise
    // in assembly statements (like LEN).
    return (keyword.flags & Flags.Expr);
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

function keywordsRegex(kws) {
    return kws
        .map(kw => kw.keyword)
        .sort((x, y) => y.length - x.length)
        .map(escape)
        .join("|");
}

export function tokenChar(kw) {
    return String.fromCodePoint(kw.token < 160 ? kw.token + 0x100 : kw.token);
}

function byteTokensRegex(kws) {
    return `[${kws.map(tokenChar).join("")}]`;
}

const openParenKeywords = keywords.filter(kw => kw.keyword.endsWith("("));

const allTokensForAsmRegex = keywordsRegex(keywords.filter(isExpressionToken));

const parenTokensRegex = keywordsRegex(openParenKeywords);

const logicalOperatorsRegex = "AND|OR|EOR|MOD|DIV|NOT|[\\u0180-\\u0184\\xac]";

const allByteTokensRegex = byteTokensRegex(keywords);

const allByteTokensForAsmRegex = byteTokensRegex(keywords.filter(isExpressionToken));

function allAbbreviations(tokens) {
    const prefixes = new Set();
    for (const token of tokens) {
        for (let i = 1; i < token.length; ++i) prefixes.add(token.substr(0, i));
    }
    return [...prefixes].map(prefix => prefix + ".");
}

// BASIC expands an abbreviation to the first keyword in the table with its prefix.
export function abbreviatedKeyword(abbreviation) {
    return keywords.find(kw => kw.keyword.startsWith(abbreviation.slice(0, -1)));
}

// The "Conditional" bit applies even to abbreviations, so "F.A=H.TO8^5" is
// parsed as a variable named "H" followed by ".", and BASIC reports error
// "No such variable" if "H" isn't a variable or "No TO" if it is.
const invalidAbbreviatedTokensRegex = allAbbreviations(keywords.map(kw => kw.keyword))
    .filter(abbreviation => abbreviatedKeyword(abbreviation).flags & Flags.Conditional)
    .map(abbreviation => escape(abbreviation) + "[a-zA-Z0-9]+")
    .join("|");

const invalidAbbreviatedTokenAtStart = new RegExp(`^(?:${invalidAbbreviatedTokensRegex})`);

const abbreviatedDollarTokensRegex = (() => {
    // Find all abbreviated forms containing a "$".  It'll always be right before the "."
    // because tokens with a "$" always end with either the "$" (and have no abbreviated
    // form with it) or end with "$(".
    const orRegex = keywords
        .filter(kw => kw.keyword.endsWith("$("))
        .map(kw => kw.keyword.slice(0, -2))
        .join("|");
    return "(" + orRegex + ")\\$.";
})();

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
const notStatementTokens = keywords.filter(kw => kw.token < FirstStatementToken && kw.keyword !== "ELSE");
const notStatementRegex = (() => {
    // MOD begins MODE.
    const begunStatements = [...statementKeywords].filter(statement =>
        notStatementKeywords.some(kw => statement !== kw.keyword && statement.startsWith(kw.keyword)),
    );
    // A conditional keyword's abbreviation followed by a letter or digit is a name.
    const abbreviations = allAbbreviations(keywords.map(kw => kw.keyword))
        .filter(abbreviation => notStatementKeywords.includes(abbreviatedKeyword(abbreviation)))
        .map(abbreviation =>
            escape(abbreviation) + (abbreviatedKeyword(abbreviation).flags & Flags.Conditional ? "(?![a-zA-Z0-9])" : ""),
        );
    return new RegExp(
        `(?!${keywordsRegex(begunStatements.map(keyword => ({keyword})))})` +
            `(?:${[...abbreviations, tokensRegex(notStatementKeywords), byteTokensRegex(notStatementTokens)].join("|")})`,
    );
})();

// Every way of typing a token that ends in "(" (e.g. RIGHT$(, RI., RIGHT$., or the raw token character). Monaco's
// bracket matching scans the text, so it needs these as openers to pair them with their ")".
const hiddenOpenParens = [
    ...openParenKeywords.flatMap(kw => [kw.keyword, tokenChar(kw)]),
    ...allAbbreviations(openParenKeywords.map(kw => kw.keyword)).filter(abbreviation =>
        abbreviatedKeyword(abbreviation).keyword.endsWith("("),
    ),
];

export function registerBbcBasicLanguage() {
    languages.register({id: "BBCBASIC"});

    // Register a tokens provider for the language
    languages.setMonarchTokensProvider("BBCBASIC", {
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
        tokenPrefix: allAbbreviations(keywords.map(kw => kw.keyword)),
        symbols: /[-+=><!*/:?$;,^']+/,
        tokenizer: {
            root: [
                {include: "@whitespace"},
                [/\d+/, "constant.linenum"], // line numbers
                [notStatementRegex, "invalid", "@statement"],
                [/(?=[^*])/, "", "@statement"], // As soon as we know this statement doesn't start with * we can process it with statement
                [/\*.*/, "keyword.oscli.string"], // "string" keeps bracket matching out; the theme colours it as keyword.oscli
            ],
            statement: [
                ["\n", "", "@pop"],
                [":", "symbol", "@pop"],
                [/(\bREM|\xf4)/, {token: "keyword", next: "@remStatement"}], // A REM consumes to EOL
                [/(FN|PROC|PRO\.|\xa4|\xf2)/, {token: "keyword", next: "@fnProcName"}],
                [/(\bDATA|\bDAT\.|\bDA\.|\bD\.|\xdc)/, {token: "keyword", switchTo: "@dataStatement"}], // DATA consumes to EOL
                [/(PRINT|PRIN\.|PRI\.|PR\.|P\.|\xf1|INPUT|INPU\.|INP\.|IN\.|I\.|\xe8)(?=[ \t]*#)/, "keyword", "@optionalHash"],
                // A state ending ".list" is one in which a value can directly follow another, as in PRINT X"a".
                [/(PRINT|PRIN\.|PRI\.|PR\.|P\.|\xf1)/, {token: "keyword", switchTo: "@printStatement.list"}],
                [/(VDU|VD\.|V\.|\xef)/, {token: "keyword", switchTo: "@statement.list"}],
                [invalidAbbreviatedTokensRegex, "invalid"],
                [
                    /((BGET|BPUT|CLOSE|EOF|EXT|PTR)\b|B\.|BG\.|BGE\.|BP\.|BPU\.|CLO\.|CLOS\.|EO\.|PT\.|\u019a|\xd5|\xd9|\xc5|\xa2|\u018f|\xcf)/,
                    {token: "keyword", next: "@optionalHash"},
                ],
                [/THEN|THE\.|TH\.|ELSE|ELS\.|EL\.|\u018c|\u018b/, "keyword", "@pop"], // THEN and ELSE end a statement
                // A number after ERROR is not a line number, but a * command may follow ON ERROR.
                [/(ERROR|ERRO\.|ERR\.|\u0185)(?=[ \t]*\*)/, "keyword", "@pop"],
                // STR$ takes one ~, though a PRINT item can start with any number.
                [/(STR\$|STR\.|\xc3)([ \t]*)(~)((?:[ \t]*~)*)/, ["keyword", "white", "operator", "invalid"]],
                [/(FOR|FO\.|F\.|\xe3)/, {token: "keyword", switchTo: "@forStatement"}],
                // This is slower than using the "tokens" built in to monarch but
                // doesn't require whitespace delimited tokens.
                [new RegExp(`TOP|\\xb8P|${anyTokenRegex}`), "keyword"],
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
                [/([-+=<>*/^!?$]+)([ \t]*)(~)/, ["operator", "white", "invalid"]],
                [new RegExp(`(${logicalOperatorsRegex}|${parenTokensRegex})([ \\t]*)(~)`), ["keyword", "white", "invalid"]],
                [/(\()([ \t]*)(~)/, ["@brackets", "white", "invalid"]],
                [/~/, "operator"],
                {include: "@statement"},
            ],
            // In a FOR statement TO ends the loop's start expression, except where an operand is expected:
            // there the tokeniser's TO followed by P is TOP.
            forStatement: [
                [
                    /([-+=<>*/^,!?$]+)([ \t]*)(TOP|\xb8P)/,
                    [{cases: {"@operators": "operator", "@default": "symbol"}}, "white", "keyword"],
                ],
                [/(\()([ \t]*)(TOP|\xb8P)/, ["@brackets", "white", "keyword"]],
                [/TO|\xb8/, {token: "keyword", switchTo: "@statement"}],
                [invalidAbbreviatedTokensRegex, "invalid"],
                // A function or other keyword that takes an operand, as in `ABS TOP` or `AB. TOP`.
                [
                    new RegExp(`(?:${allTokensRegex}|${allByteTokensRegex}|[A-Z]+\\.)(?=[ \\t]*(TOP|\\xb8P))`),
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
            forOperand: [
                [/[ \t]+/, "white"],
                [/TOP|\xb8P/, "keyword", "@pop"],
                ["", "", "@pop"],
            ],
            common: [
                {include: "@whitespace"},
                [/~/, "invalid"],
                // Common operators from other languages which are not BBC BASIC operators.
                [/[=!]=/, "invalid"], // C and many other languages
                [/\*\*/, "invalid"], // Fortran, Javascript, Perl, Python and various other languages
                [/></, "invalid"], // E.g. Apple][ BASIC
                [/=[<>]/, "invalid"], // E.g. Apple][ BASIC
                [/[-+/*^]=/, "invalid"], // C and many other languages
                [/<</, "invalid"], // C and many other languages
                [/>>/, "invalid"], // C and many other languages
                // immediate
                [
                    "@symbols",
                    {
                        cases: {
                            "@operators": "operator",
                            "@default": "symbol",
                        },
                    },
                ],
                // numbers
                [/\d*\.\d*(E[-+\d]\d*)?/, "number.float"],
                [/\d+E[-+\d]\d*/, "number.float"],
                [/\d+/, "number"],
                [/&[0-9A-F]+/, "number.hex"],
                [/[()]/, "@brackets"],
                [/[a-zA-Z_][\w]*[$%]?/, "variable"],
                // strings
                [
                    /"([^"\n]|"")*(?=\n|$)/,
                    "invalid.string",
                ],
                ['"', {token: "string.quote", next: "@string"}],
                // Unusual cases. We treat @% as a regular variable (see #28).
                ["@%", "variable"],
            ],
            // FN and PROC names can start with a digit.
            fnProcName: [
                [/[a-zA-Z0-9_]+/, "variable", "@pop"],
                ["", "", "@pop"],
            ],
            strayDot: [[/\.\d*/, "invalid", "@pop"]],
            optionalHash: [
                [/[ \t\r]+/, "white"],
                ["#", "symbol", "@pop"],
                ["", "", "@pop"],
            ],
            // Not the newline, which would carry a state such as this statement's on to the next line.
            whitespace: [[/[ \t\r]+/, "white"]],
            string: [
                [/[^"]+/, "string"],
                ['"', {token: "string.quote", next: "@pop"}],
            ],
            remStatement: [[/.*/, "comment", "@pop"]],
            dataStatement: [
                ["\n", "", "@pop"],
                [",", "symbol"],
                {include: "@whitespace"},
                [/"([^"\n]|"")*(?=\n|$)/, "string"], // No closing quote before the end of the line
                ['"', {token: "string.quote", next: "@string"}],
                [/[^,\n]*[^,\n ]/, "string.unquoted"],
            ],
            asm: [
                [
                    /ADC|AND|ASL|B(CC|CS|EQ|MI|NE|PL|VC|VS)|BIT|BRK|CL[CDIV]|CMP|CP[XY]|DE[CXY]|EOR|IN[CXY]|JMP|JSR|LD[AXY]|LSR|NOP|ORA|PH[AP]|PL[AP]|RO[LR]|RTI|RTS|SBC|SE[CDI]|ST[AXY]|TA[XY]|TSX|TX[AS]|TYA/,
                    "keyword",
                ],
                [/OPT|EQU[BDSW]/, "keyword.directive"],
                [/\\[^:]*/, "comment"],
                [/,(?= *[XY]\b)/, {token: "symbol", switchTo: "@asmIndex"}],
                ["#", "symbol"], // Immediate addressing
                // labels
                [/\.([a-zA-Z_][\w]*%?|@%)/, "type.identifier"],
                [new RegExp(`TOP|\\xb8P|${allTokensForAsmRegex}|${allByteTokensForAsmRegex}`), "keyword"],
                [new RegExp(`${anyTokenRegex}|${invalidAbbreviatedTokensRegex}`), "invalid"],
                [/^\d+/, "constant.linenum"], // line numbers
                {include: "@common"},
                ["]", {token: "delimiter.square", next: "@pop"}],
            ],
            asmIndex: [
                {include: "@whitespace"},
                [/[XY]/, {token: "keyword", switchTo: "@asm"}],
            ],
        },
    });

    languages.setLanguageConfiguration("BBCBASIC", {
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
                /(-?\d*\.\d+)|(-?\d+)|([^`~!@#%^&*()\-=+[{\]}\\|;:'",.<>/?\s]+)/g.source,
        ),
    });

    // With thanks to https://stackoverflow.com/questions/57994101/show-quick-fix-for-an-error-in-monaco-editor
    languages.registerCodeActionProvider("BBCBASIC", {
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
    });
}

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

    for (const token of lineTokens.filter(token => token.type === "variable.BBCBASIC")) {
        const match = line.substr(token.offset).match(LowerCaseTokenRegex);
        if (match) {
            const upper = match[0].toUpperCase();
            // Don't warn about lower case versions of immediate commands, e.g. `new`.
            if (immediateCommands.indexOf(upper) !== -1) continue;
            warn(token.offset, match[0].length, {
                message: `BASIC keywords should be upper case, did you mean ${upper}?`,
            });
        }
    }
    // Suggest replacements for common operators from other languages.
    for (const token of lineTokens.filter(token => token.type === "invalid.BBCBASIC")) {
        // FIXME: The token string and length don't seem to be available, but
        // they are all 2 characters long currently so we can assume that.
        const tokenLen = 2;
        const badOperator = line.substr(token.offset, tokenLen);
        const abbreviated = line.substr(token.offset).match(invalidAbbreviatedTokenAtStart);
        if (abbreviated) {
            const abbreviation = abbreviated[0].slice(0, abbreviated[0].indexOf(".") + 1);
            warn(token.offset, abbreviated[0].length, {
                message: `${abbreviation} is not read as an abbreviation when followed directly by letters or digits, did you mean "${abbreviation} ${abbreviated[0].slice(abbreviation.length)}"?`,
                code: SpaceAfterAbbreviationCode,
            });
            continue;
        }
        if (InvalidOperatorMap.has(badOperator)) {
            warn(token.offset, tokenLen, {
                message: `${badOperator} is not a BBC BASIC operator, did you mean ${InvalidOperatorMap.get(badOperator)}?`,
            });
        }
    }
    return warnings;
}
