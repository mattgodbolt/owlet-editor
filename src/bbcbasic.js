import {languages} from 'monaco-editor/esm/vs/editor/editor.api';
import {tokens} from './tokens';

function escape(token) {
    return token.replace("$", "\\$").replace("(", "\\(");
}

function findAllPrefixes() {
    const prefixes = new Set();
    for (const token of tokens.filter(x => x)) {
        for (let i = 0; i < token.length; ++i)
            prefixes.add(token.substr(0, i));
    }
    const result = [];
    for (const prefix of prefixes)
        result.push(prefix + '.');
    return result;
}

export function registerBbcBasicLanguage() {
    languages.register({id: 'BBCBASIC'});

    // Register a tokens provider for the language
    languages.setMonarchTokensProvider('BBCBASIC', {
        defaultToken: 'invalid',
        brackets: [
            ['(', ')', 'delimiter.parenthesis'],
        ],
        operators: [
            '#', // immediate
            '+', '-', '*', '/', '<<', '>>', '^', '=', '==', '<>', '!=', '<', '>', '<=', '>=',
            '{', '}', ':', '$', '?', ';', ','
        ],
        tokenPrefix: findAllPrefixes(),
        symbols: /[-+#=><!*/{}:?$;,]+/,
        tokenizer: {
            root: [
                [/\bREM$/, {token: 'keyword'}], // A REM on its own line
                [/\bREM/, {token: 'keyword', next: '@remStatement'}], // A REM consumes to EOL
                // This is slower than using the "tokens" built in to monarch but
                // doesn't require whitespace delimited tokens.
                [tokens
                    .filter(x => x)
                    .map(escape)
                    .sort((x, y) => y.length - x.length)
                    .join("|"),
                    'keyword'],
                [/[A-Z]+\./, {cases: {'@tokenPrefix': 'keyword'}}],
                [/[a-zA-Z_][\w]*[$%]?/, 'variable'],
                [/^\s*\d+/, 'enum'], // line numbers
                // whitespace
                {include: '@whitespace'},
                {include: '@common'},
                ['\\[', {token: 'delimiter.square', next: '@asm'}]
            ],
            common: [
                // immediate
                [/@symbols/, {cases: {'@operators': 'operator', '@default': ''}}],
                // numbers
                [/\d*\.\d+([eE][-+]?\d+)?/, 'number.float'],
                [/&[0-9a-fA-F]+/, 'number.hex'],
                [/\d+/, 'number'],
                [/[{}()]/, '@brackets'],
                // strings
                [/["\u201c\u201d]/, {token: 'string.quote', next: '@string'}],
                // Unusual cases
                ['@%', 'type.identifier'],
            ],
            whitespace: [
                [/[ \t\r\n]+/, 'white'],
            ],
            string: [
                [/[^"\u201c\u201d]+/, 'string'],
                [/["\u201c\u201d]C?/, {token: 'string.quote', next: '@pop'}]
            ],
            remStatement: [[/.*/, 'comment', '@pop']],
            asm: [
                // Not exactly working properly yet...but a start
                [/[a-zA-Z]{3}/, 'keyword'],
                [/[ \t\r\n]+/, 'white'],
                [/[;\\].*/, 'comment'],
                {include: '@common'},
                [/,\s*[XY]/, 'keyword'],
                // labels
                [/\.[a-zA-Z_$][\w$]*/, 'type.identifier'],
                [']', {token: 'delimiter.square', next: '@pop'}]
            ]
        }
    });

    // Register a completion item provider for the new language
    languages.registerCompletionItemProvider('BBCBASIC', {
        provideCompletionItems: () => {
            return {
                suggestions: tokens.filter(x => x).map(token => ({
                    label: token,
                    kind: languages.CompletionItemKind.Keyword,
                    insertText: token
                }))
            };
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
