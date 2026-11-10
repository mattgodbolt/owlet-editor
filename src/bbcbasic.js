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

const allTokensRegex = keywords
    .map(kw => kw.keyword)
    .sort((x, y) => y.length - x.length)
    .map(kw => {
        // A keyword that begins an earlier one in the table is not read before a dot: "END." is ENDPROC.
        const beforeDot = abbreviatedKeyword(`${kw}.`).keyword === kw ? "" : "(?!\\.)";
        return escape(kw) + beforeDot + (conditionalTokens.has(kw) ? "\\b" : "");
    })
    .join("|");

function keywordsRegex(kws) {
    return kws
        .map(kw => kw.keyword)
        .sort((x, y) => y.length - x.length)
        .map(escape)
        .join("|");
}

function tokenChar(kw) {
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
function abbreviatedKeyword(abbreviation) {
    return keywords.find(kw => kw.keyword.startsWith(abbreviation.slice(0, -1)));
}

// The "Conditional" bit applies even to abbreviations, so "F.A=H.TO8^5" is
// parsed as a variable named "H" followed by ".", and BASIC reports error
// "No such variable" if "H" isn't a variable or "No TO" if it is.
const invalidAbbreviatedTokensRegex = allAbbreviations(keywords.map(kw => kw.keyword))
    .filter(abbreviation => abbreviatedKeyword(abbreviation).flags & Flags.Conditional)
    .map(escape)
    .map(kw => kw + "[a-zA-Z0-9]+")
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

// Every way of typing a token that ends in "(" (e.g. RIGHT$(, RI., RIGHT$., or the raw token character). Monaco's
// bracket matching scans the text, so it needs these as openers to pair them with their ")".
const hiddenOpenParens = (() => {
    const forms = new Set();
    for (const kw of openParenKeywords) {
        forms.add(kw.keyword);
        forms.add(tokenChar(kw));
        if (kw.keyword.endsWith("$(")) forms.add(kw.keyword.slice(0, -1) + ".");
    }
    for (const abbreviation of allAbbreviations(openParenKeywords.map(kw => kw.keyword))) {
        if (/^[A-Z]+\.$/.test(abbreviation) && abbreviatedKeyword(abbreviation).keyword.endsWith("(")) {
            forms.add(abbreviation);
        }
    }
    return [...forms];
})();

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
                [/(?=[^*])/, "", "@statement"], // As soon as we know this statement doesn't start with * we can process it with statement
                [/\*.*/, "keyword.oscli.string"], // "string" keeps bracket matching out; the theme colours it as keyword.oscli
            ],
            statement: [
                ["\n", "", "@pop"],
                [":", "symbol", "@pop"],
                [/(\bREM|\xf4)/, {token: "keyword", next: "@remStatement"}], // A REM consumes to EOL
                [/(FN|PROC|PRO\.|\xa4|\xf2)/, {token: "keyword", next: "@fnProcName"}],
                [/(\bDATA|\bDAT\.|\bDA\.|\bD\.|\xdc)/, {token: "keyword", switchTo: "@dataStatement"}], // DATA consumes to EOL
                [/(PRINT|PRIN\.|PRI\.|PR\.|P\.|\xf1)/, {token: "keyword", switchTo: "@printHash"}],
                [/(INPUT|INPU\.|INP\.|IN\.|I\.|\xe8)/, {token: "keyword", next: "@optionalHash"}],
                [invalidAbbreviatedTokensRegex, "invalid"],
                [
                    /((BGET|BPUT|CLOSE|EOF|EXT|PTR)\b|B\.|BG\.|BGE\.|BP\.|BPU\.|CLO\.|CLOS\.|EO\.|PT\.|\u019a|\xd5|\xd9|\xc5|\xa2|\u018f|\xcf)/,
                    {token: "keyword", next: "@optionalHash"},
                ],
                [/THEN|THE\.|TH\.|ELSE|ELS\.|EL\.|\u018c|\u018b/, "keyword", "@pop"], // THEN and ELSE end a statement
                // A number after ERROR is not a line number, but a * command may follow ON ERROR.
                [/(ERROR|ERRO\.|ERR\.|\u0185)(?=[ \t]*\*)/, "keyword", "@pop"],
                [/(STR\$|STR\.|\xc3)([ \t]*)(~)/, ["keyword", "white", "operator"]],
                [/(FOR|FO\.|F\.|\xe3)/, {token: "keyword", switchTo: "@forStatement"}],
                // This is slower than using the "tokens" built in to monarch but
                // doesn't require whitespace delimited tokens.
                [new RegExp(`TOP|\\xb8P|${anyTokenRegex}`), "keyword"],
                // Not an abbreviation, so the dot is a number (e.g. P.X.), not part of the name.
                [/[A-Z]+\./, {cases: {"@tokenPrefix": "keyword", "@default": {token: "variable", goBack: 1}}}],
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
            printHash: [
                [/[ \t\r]+/, "white"],
                ["#", {token: "symbol", switchTo: "@statement"}],
                ["", {token: "", switchTo: "@printStatement"}],
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
                // A function or other keyword that takes an operand, as in `ABS TOP` or `AB. TOP`.
                [invalidAbbreviatedTokensRegex, "invalid"],
                [
                    new RegExp(`(?:${allTokensRegex}|${allByteTokensRegex}|[A-Z]+\\.)(?=[ \\t]*(TOP|\\xb8P))`),
                    {
                        cases: {
                            "@tokenPrefix": {token: "keyword", next: "@forOperand"},
                            "[A-Z]+\\.": {token: "variable", goBack: 1},
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
            optionalHash: [
                [/[ \t\r]+/, "white"],
                ["#", "symbol"],
                ["", "", "@pop"],
            ],
            whitespace: [[/[ \t\r\n]+/, "white"]],
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

    // Register a completion item provider for the new language
    // Filter out immediate tokens which aren't valid in a program
    const uniqueTokens = [
        ...new Set(keywords.filter(kw => kw.token < 0xc6 || kw.token > 0xcd).map(kw => kw.keyword)),
    ];
    languages.registerCompletionItemProvider("BBCBASIC", {
        provideCompletionItems: (model, position) => {
            const linePrefix = model.getLineContent(position.lineNumber).substr(0, position.column);
            // Does it look like a hex constant? If so, don't try to autocomplete
            if (linePrefix.match(/&[0-9A-F]*$/)) {
                return null;
            }
            return {
                suggestions: uniqueTokens.map(token => ({
                    label: token,
                    kind: languages.CompletionItemKind.Keyword,
                    insertText: token,
                })),
            };
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
                    const insertAt = marker.startColumn + text.indexOf(".") + 1;
                    return {
                        title: `Insert a space after ${text.slice(0, text.indexOf(".") + 1)}`,
                        diagnostics: [marker],
                        kind: "quickfix",
                        edit: {
                            edits: [
                                {
                                    resource: model.uri,
                                    textEdit: {
                                        range: {
                                            startLineNumber: marker.startLineNumber,
                                            startColumn: insertAt,
                                            endLineNumber: marker.startLineNumber,
                                            endColumn: insertAt,
                                        },
                                        text: " ",
                                    },
                                },
                            ],
                        },
                        isPreferred: true,
                    };
                }
                const replacement = InvalidOperatorMap.has(text) ?
                    InvalidOperatorMap.get(text) :
                    text.toUpperCase();
                return {
                    title: `Replace with ${replacement}`,
                    diagnostics: [marker],
                    kind: "quickfix",
                    edit: {
                        edits: [
                            {
                                resource: model.uri,
                                textEdit: {
                                    range: marker,
                                    text: replacement,
                                },
                            },
                        ],
                    },
                    isPreferred: true,
                };
            });
            return {
                actions: actions,
                dispose: () => {},
            };
        },
    });
}

const LowerCaseTokenRegex = new RegExp(`^(${allTokensRegex.toLowerCase()})(?![%$])`);

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

    for (const token of lineTokens.filter(token => token.type === "variable.BBCBASIC")) {
        const match = line.substr(token.offset).match(LowerCaseTokenRegex);
        if (match) {
            const upper = match[0].toUpperCase();
            // Don't warn about lower case versions of immediate commands, e.g. `new`.
            if (immediateCommands.indexOf(upper) !== -1) continue;
            warnings.push({
                severity: MarkerSeverity.Warning,
                message: `BASIC keywords should be upper case, did you mean ${upper}?`,
                startLineNumber: lineNum,
                startColumn: token.offset + 1,
                endLineNumber: lineNum,
                endColumn: token.offset + match[0].length + 1,
            });
        }
    }
    // Suggest replacements for common operators from other languages.
    for (const token of lineTokens.filter(token => token.type === "invalid.BBCBASIC")) {
        // FIXME: The token string and length don't seem to be available, but
        // they are all 2 characters long currently so we can assume that.
        const tokenLen = 2;
        const badOperator = line.substr(token.offset, tokenLen);
        // A keyword that can't be abbreviated when followed by letters or digits, e.g. "H.TO" is the variable
        // H, then ".TO". The tokeniser has been checked to produce the keyword for "H. TO" instead.
        const abbreviated = line.substr(token.offset).match(invalidAbbreviatedTokenAtStart);
        if (abbreviated) {
            const abbreviation = abbreviated[0].slice(0, abbreviated[0].indexOf(".") + 1);
            warnings.push({
                severity: MarkerSeverity.Warning,
                message: `${abbreviation} is not read as an abbreviation when followed directly by letters or digits, did you mean "${abbreviation} ${abbreviated[0].slice(abbreviation.length)}"?`,
                code: SpaceAfterAbbreviationCode,
                startLineNumber: lineNum,
                startColumn: token.offset + 1,
                endLineNumber: lineNum,
                endColumn: token.offset + abbreviated[0].length + 1,
            });
            continue;
        }
        if (InvalidOperatorMap.has(badOperator)) {
            const goodOperator = InvalidOperatorMap.get(badOperator);
            warnings.push({
                severity: MarkerSeverity.Warning,
                message: `${badOperator} is not a BBC BASIC operator, did you mean ${goodOperator}?`,
                startLineNumber: lineNum,
                startColumn: token.offset + 1,
                endLineNumber: lineNum,
                endColumn: token.offset + tokenLen + 1,
            });
        }
    }
    return warnings;
}
