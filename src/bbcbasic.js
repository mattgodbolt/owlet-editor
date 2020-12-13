import {languages} from "monaco-editor/esm/vs/editor/editor.api";
import {Flags, keywords} from "./tokens";

function escape(token) {
    return token.replace("$", "\\$").replace("(", "\\(");
}

function isExpressionToken(keyword) {
    // Does this token look like it'd be useful as a token. Used to find sensible things to tokenise
    // in assembly statements (like LEN).
    return (keyword.flags & ~Flags.Conditional) === 0;
}

const conditionalTokens = new Set(
    keywords.filter(kw => kw.flags & Flags.Conditional).map(kw => kw.keyword)
);

export const allTokensRegex = keywords
    .map(kw => kw.keyword)
    .sort((x, y) => y.length - x.length)
    .map(escape)
    .map(kw => (conditionalTokens.has(kw) ? kw + "\\b" : kw))
    .join("|");

export const allTokensForAsmRegex = keywords
    .filter(isExpressionToken)
    .map(kw => kw.keyword)
    .sort((x, y) => y.length - x.length)
    .map(escape)
    .join("|");

function findAllPrefixes() {
    const prefixes = new Set();
    for (const token of keywords.map(kw => kw.keyword)) {
        for (let i = 0; i < token.length; ++i) prefixes.add(token.substr(0, i));
    }
    const result = [];
    for (const prefix of prefixes) result.push(prefix + ".");
    return result;
}

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
        tokenPrefix: findAllPrefixes(),
        symbols: /[-+#=><!*/{}:?$;,~^']+/,
        tokenizer: {
            root: [
                [/(\bREM|\xf4)$/, {token: "keyword"}], // A REM on its own line
                [/(\bREM|\xf4)/, {token: "keyword", next: "@remStatement"}], // A REM consumes to EOL
                // This is slower than using the "tokens" built in to monarch but
                // doesn't require whitespace delimited tokens.
                [allTokensRegex, "keyword"],
                [/[A-Z$]+\./, {cases: {"@tokenPrefix": "keyword"}}],
                [/^\s*\d+/, "enum"], // line numbers
                {include: "@common"},
                ["\\[", {token: "delimiter.square", next: "@asm"}],
            ],
            common: [
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
                [/["\u201c\u201d]/, {token: "string.quote", next: "@string"}],
                // Unusual cases. We treat @% as a regular variable (see #28).
                ["@%", "variable"],
            ],
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
                [/[;\\][^:]*/, "comment"],
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
