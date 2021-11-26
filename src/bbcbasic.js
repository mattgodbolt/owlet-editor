import {languages, MarkerSeverity} from "monaco-editor/esm/vs/editor/editor.api";
import {Flags, keywords} from "./tokens";

function escape(token) {
    return token.replace("$", "\\$").replace("(", "\\(").replace(".", "\\.");
}

function isExpressionToken(keyword) {
    // Does this token look like it'd be useful in an expression. Used to find sensible things to tokenise
    // in assembly statements (like LEN).
    return (keyword.flags & ~Flags.Conditional) === 0 || keyword.keyword === "FN";
}

const conditionalTokens = new Set(
    keywords.filter(kw => kw.flags & Flags.Conditional).map(kw => kw.keyword)
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
            keywords.filter(kw => !conditionalTokens.has(kw.keyword)).map(kw => kw.keyword)
        )
    );
    const allConditional = new Set(
        allAbbreviations(
            keywords.filter(kw => (kw.flags & Flags.Conditional) !== 0).map(kw => kw.keyword)
        )
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
        brackets: [["(", ")", "delimiter.parenthesis"]],
        operators: [
            "+",
            "-",
            "*",
            "/",
            "<<",
            ">>",
            "^",
            "=",
            "==",
            "<>",
            "!=",
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
        symbols: /[-+#=><!*/{}:?$;,~^']+/,
        tokenizer: {
            root: [
                [/(\bREM|\xf4)$/, {token: "keyword"}], // A REM on its own line
                [/(\bREM|\xf4)/, {token: "keyword", next: "@remStatement"}], // A REM consumes to EOL
                [/(FN|PROC|\xa4|\xf2)/, {token: "keyword", next: "@fnProcName"}],
                // This is slower than using the "tokens" built in to monarch but
                // doesn't require whitespace delimited tokens.
                [allTokensRegex, "keyword"],
                [abbreviatedDollarTokensRegex, "keyword"],
                [invalidAbbreviatedTokensRegex, "invalid"],
                [/[A-Z]+\./, {cases: {"@tokenPrefix": "keyword"}}],
                {include: "@common"},
                ["\\[", {token: "delimiter.square", next: "@asm"}],
            ],
            common: [
                [/^\s*\d+/, "enum"], // line numbers
                {include: "@whitespace"},
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
                [/\d*\.\d*(E[-+]?\d+)?/, "number.float"],
                [/\d+E[-+]?\d+/, "number.float"],
                [/\d+/, "number"],
                [/&[0-9A-F]+/, "number.hex"],
                [/[{}()]/, "@brackets"],
                [/[a-zA-Z_][\w]*[$%]?/, "variable"],
                // strings
                [
                    /["\u201c\u201d]([^"\u201c\u201d]|["\u201c\u201d]["\u201c\u201d])*$/,
                    "invalid.string",
                ],
                [/["\u201c\u201d]/, {token: "string.quote", next: "@string"}],
                // Unusual cases. We treat @% as a regular variable (see #28).
                ["@%", "variable"],
            ],
            // FN and PROC names can start with a digit.
            fnProcName: [[/[a-zA-Z0-9_]+/, "variable", "@pop"]],
            whitespace: [[/[ \t\r\n]+/, "white"]],
            string: [
                [/[^"\u201c\u201d]+/, "string"],
                [/["\u201c\u201d]/, {token: "string.quote", next: "@pop"}],
            ],
            remStatement: [[/.*/, "comment", "@pop"]],
            asm: [
                [
                    /ADC|AND|ASL|B(CC|CS|EQ|MI|NE|PL|VC|VS)|BIT|BRK|CL[CDIV]|CMP|CP[XY]|DE[CXY]|EOR|IN[CXY]|JMP|JSR|LD[AXY]|LSR|NOP|ORA|PH[AP]|PL[AP]|RO[LR]|RTI|RTS|SBC|SE[CDI]|ST[AXY]|TA[XY]|TSX|TX[AS]|TYA/,
                    "keyword",
                ],
                [/OPT|EQU[BDSW]/, "keyword.directive"],
                [/\\[^:]*/, "comment"],
                [/,\s*[XY]/, "keyword"],
                // labels
                [/\.([a-zA-Z_][\w]*%?|@%)/, "type.identifier"],
                [allTokensForAsmRegex, "keyword"],
                {include: "@common"},
                ["]", {token: "delimiter.square", next: "@pop"}],
            ],
        },
    });

    // Register a completion item provider for the new language
    const uniqueTokens = [...new Set(keywords.map(kw => kw.keyword))];
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
            blockComment: ["REM", ":"],
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
                /(-?\d*\.\d+)|(-?\d+)|([^`~!@#%^&*()\-=+[{\]}\\|;:'",.<>/?\s]+)/g.source
        ),
    });

    // With thanks to https://stackoverflow.com/questions/57994101/show-quick-fix-for-an-error-in-monaco-editor
    languages.registerCodeActionProvider("BBCBASIC", {
        provideCodeActions(model, range, context) {
            const actions = context.markers.map(marker => {
                const text = model.getValueInRange(marker);
                return {
                    title: `Replace with ${text.toUpperCase()}`,
                    diagnostics: [marker],
                    kind: "quickfix",
                    edit: {
                        edits: [
                            {
                                resource: model.uri,
                                edit: {
                                    range: marker,
                                    text: text.toUpperCase(),
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

export function getWarnings(lineNum, line, lineTokens) {
    const warnings = [];

    for (const token of lineTokens.filter(token => token.type === "variable.BBCBASIC")) {
        const match = line.substr(token.offset).match(LowerCaseTokenRegex);
        if (match) {
            warnings.push({
                severity: MarkerSeverity.Warning,
                message: `BASIC keywords should be upper case, did you mean ${match[0].toUpperCase()}?`,
                startLineNumber: lineNum,
                startColumn: token.offset + 1,
                endLineNumber: lineNum,
                endColumn: token.offset + match[0].length + 1,
            });
        }
    }
    return warnings;
}
