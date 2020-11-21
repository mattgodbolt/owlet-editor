import {languages} from 'monaco-editor';
import Tokens from './tokens';

export function registerBbcBasicLanguage() {
    languages.register({id: 'BBCBASIC'});

    // Register a tokens provider for the language
    languages.setMonarchTokensProvider('BBCBASIC', {
        defaultToken: 'invalid',
        brackets: [
            ['[', ']', 'delimiter.square'],
            ['(', ')', 'delimiter.parenthesis'],
        ],
        keywords: Tokens,

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

            Tokens.forEach(token =>
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
