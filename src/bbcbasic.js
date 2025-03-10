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
    .map(escape)
    .map(kw => (conditionalTokens.has(kw) ? kw + "\\b" : kw))
    .join("|");

const allTokensForAsmRegex = keywords
    .filter(isExpressionToken)
    .map(kw => kw.keyword)
    .sort((x, y) => y.length - x.length)
    .map(escape)
    .join("|");

const allByteTokensRegex =
    "[" +
    keywords
        .map(kw => String.fromCodePoint(kw.token < 160 ? kw.token + 0x100 : kw.token))
        .join("") +
    "]";

const allByteTokensForAsmRegex =
    "[" +
    keywords
        .filter(isExpressionToken)
        .map(kw => String.fromCodePoint(kw.token < 160 ? kw.token + 0x100 : kw.token))
        .join("") +
    "]";

function allAbbreviations(tokens) {
    const prefixes = new Set();
    for (const token of tokens) {
        for (let i = 1; i < token.length; ++i) prefixes.add(token.substr(0, i));
    }
    return [...prefixes].map(prefix => prefix + ".");
}

const invalidAbbreviatedTokensRegex = (() => {
    // The "Conditional" bit applies even to abbreviations, so "F.A=H.TO8^5" is
    // parsed as a variable named "H" followed by ".", and BASIC reports error
    // "No such variable" if "H" isn't a variable or "No TO" if it is.
    const allNonConditional = new Set(
        allAbbreviations(
            keywords.filter(kw => !conditionalTokens.has(kw.keyword)).map(kw => kw.keyword),
        ),
    );
    const allConditional = new Set(
        allAbbreviations(
            keywords.filter(kw => (kw.flags & Flags.Conditional) !== 0).map(kw => kw.keyword),
        ),
    );
    return [...allConditional]
        .filter(x => !allNonConditional.has(x))
        .map(escape)
        .map(kw => kw + "[a-zA-Z0-9]+")
        .join("|");
})();

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
            "~",
            "!",
            "'",
        ],
        tokenPrefix: allAbbreviations(keywords.map(kw => kw.keyword)),
        symbols: /[-+=><!*/:?$;,~^']+/,
        tokenizer: {
            root: [
                {include: "@whitespace"},
                [/\d+/, "constant.linenum"], // line numbers
                [/(?=[^*])/, "", "@statement"], // As soon as we know this statement doesn't start with * we can process it with statement
                [/\*.*/, {token: "keyword.oscli"}],
            ],
            statement: [
                ["\n", "", "@pop"],
                [":", "symbol", "@pop"],
                [/(\bREM|\xf4)/, {token: "keyword", next: "@remStatement"}], // A REM consumes to EOL
                [/(FN|PROC|PRO\.|\xa4|\xf2)/, {token: "keyword", next: "@fnProcName"}],
                [/(\bDATA|\bDAT\.|\bDA\.|\bD\.|\xdc)/, {token: "keyword", switchTo: "@dataStatement"}], // DATA consumes to EOL
                [/(PRINT|PRIN\.|PRI\.|PR\.|P\.|\xf1)/, {token: "keyword", next: "@optionalHash"}],
                [/(INPUT|INPU\.|INP\.|IN\.|I\.|\xe8)/, {token: "keyword", next: "@optionalHash"}],
                [
                    /((BGET|BPUT|CLOSE|EOF|EXT|PTR)\b|B\.|BG\b|BGE\.|BP\.|BPU\.|CLO\.|CLOS\.|EO\.|PT\.|\u019a|\xd5|\xd9|\xc5|\xa2|\u018f|\xcf)/,
                    {token: "keyword", next: "@optionalHash"},
                ],
                [
                    /THEN|THE\.|TH\.|ELSE|ELS\.|EL\.|ERROR|ERRO\.|ERR\.|\u018c|\u018b|\u0185/,
                    "keyword",
                    "@pop",
                ], // THEN, ELSE, ERROR end a statement
                // This is slower than using the "tokens" built in to monarch but
                // doesn't require whitespace delimited tokens.
                [allTokensRegex, "keyword"],
                [allByteTokensRegex, "keyword"],
                [abbreviatedDollarTokensRegex, "keyword"],
                [invalidAbbreviatedTokensRegex, "invalid"],
                [/[A-Z]+\./, {cases: {"@tokenPrefix": "keyword"}}],
                {include: "@common"},
                ["\\[", {token: "delimiter.square", next: "@asm"}],
            ],
            common: [
                {include: "@whitespace"},
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
                    /"([^"]|"")*$/,
                    "invalid.string",
                ],
                ['"', {token: "string.quote", next: "@string"}],
                // Unusual cases. We treat @% as a regular variable (see #28).
                ["@%", "variable"],
            ],
            // FN and PROC names can start with a digit.
            fnProcName: [[/[a-zA-Z0-9_]+/, "variable", "@pop"]],
            optionalHash: [
                {include: "@whitespace"},
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
                [allTokensForAsmRegex, "keyword"],
                [allByteTokensForAsmRegex, "keyword"],
                [allTokensRegex, "invalid"],
                [allByteTokensRegex, "invalid"],
                [abbreviatedDollarTokensRegex, "invalid"],
                [invalidAbbreviatedTokensRegex, "invalid"],
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
