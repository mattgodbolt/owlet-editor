import {languages} from 'monaco-editor';

export function registerBbcBasicLanguage() {
    languages.register({id: 'BBCBASIC'});

    const keywords = ["AND", "DIV", "EOR", "MOD", "OR", "ERROR", "LINE", "OFF", "STEP", "SPC", "TAB(",
        "ELSE", "THEN", "OPENIN", "PTR", "PAGE", "TIME", "LOMEM", "HIMEM", "ABS", "ACS", "ADVAL",
        "ASC", "ASN", "ATN", "BGET", "COS", "COUNT", "DEG", "ERL", "ERR", "EVAL", "EXP", "EXT", "FALSE",
        "FN", "GET", "INKEY", "INSTR", "INT", "LEN", "LN", "LOG", "NOT", "OPENIN", "OPENOUT", "PI",
        "POINT(", "POS", "RAD", "RND", "SGN", "SIN", "SQR", "TAN", "TO", "TRUE", "USR", "VAL", "VPOS",
        "CHR$", "GET$", "INKEY$", "LEFT$(", "MID$(", "RIGHT$(", "STR$", "STRING$(", "EOF", "AUTO",
        "DELETE", "LOAD", "LIST", "NEW", "OLD", "RENUMBER", "SAVE", "PUT", "PTR", "PAGE",
        "TIME", "LOMEM", "HIMEM", "SOUND", "BPUT", "CALL", "CHAIN", "CLEAR", "CLOSE", "CLG",
        "CLS", "DATA", "DEF", "DIM", "DRAW", "END", "ENDPROC", "ENVELOPE", "FOR", "GOSUB",
        "GOTO", "GCOL", "IF", "INPUT", "LET", "LOCAL", "MODE", "MOVE", "NEXT", "ON", "VDU",
        "PLOT", "PRINT", "PROC", "READ", "REM", "REPEAT", "REPORT", "RESTORE", "RETURN", "RUN",
        "STOP", "COLOUR", "TRACE", "UNTIL", "WIDTH", "OSCLI"];

    // Register a tokens provider for the language
    languages.setMonarchTokensProvider('BBCBASIC', {
        defaultToken: 'invalid',
        brackets: [
            ['[', ']', 'delimiter.square'],
            ['(', ')', 'delimiter.parenthesis'],
        ],
        keywords: keywords,

        operators: [
            '#', // immediate
            '+', '-', '*', '/', '<<', '>>', '^', '=', '==', '<>', '!=', '<', '>', '<=', '>=',
            '{', '}', ':'
        ],
        symbols: /[-+#=><!*/{}:]+/,
        tokenizer: {
            root: [
                // identifiers and keywords
                [/[a-zA-Z_$][\w$]*/, {
                    cases: {
                        '@keywords': 'keyword',
                        '@operators': 'operator',
                        '@default': 'identifier'
                    }
                }],
                [/,\s*[XY]/, 'keyword'],
                // whitespace
                {include: '@whitespace'},
                // labels
                [/\.[a-zA-Z_$][\w$]*/, 'type.identifier'],
                // immediate
                [/@symbols/, {cases: {'@operators': 'operator', '@default': ''}}],
                // numbers
                [/\d*\.\d+([eE][-+]?\d+)?/, 'number.float'],
                [/&[0-9a-fA-F]+/, 'number.hex'],
                [/\d+/, 'number'],
                [/[{}()[\]]/, '@brackets'],
                // strings
                [/["\u201c\u201d]/, {token: 'string.quote', next: '@string'}]
            ],
            whitespace: [
                [/[ \t\r\n]+/, 'white'],
                [/\b(REM\s*)\b.*/, 'comment']
            ],
            string: [
                [/[^"\u201c\u201d]+/, 'string'],
                [/["\u201c\u201d]C?/, {token: 'string.quote', next: '@pop'}]
            ]
        }
    });

    // Register a completion item provider for the new language
    languages.registerCompletionItemProvider('BBCBASIC', {
        provideCompletionItems: () => {
            const suggestions = [];

            keywords.forEach(token =>
                suggestions.push({
                    label: token,
                    kind: languages.CompletionItemKind.Keyword,
                    insertText: token
                })
            )
            return {suggestions: suggestions};
        }
    });

    languages.setLanguageConfiguration('BBCBASIC', {
        comments: {
            blockComment: ['REM', ':'], lineComment: 'REM'
        },
        brackets: [
            ['[', ']'],
            ['(', ')']
        ],
        autoClosingPairs: [
            {open: '(', close: ')'},
            {open: '"', close: '"', notIn: ['string']}
        ],
        surroundingPairs: [
            {open: '(', close: ')'},
            {open: '"', close: '"'}
        ]
    });
}
