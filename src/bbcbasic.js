import {languages} from 'monaco-editor/esm/vs/editor/editor.api';
import {tokens} from './tokens';

function escape(token) {
    return token.replace("$", "\\$").replace("(", "\\(");
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
        symbols: /[-+#=><!*/{}:?$;,]+/,
        tokenizer: {
            root: [
                // This is slower than using the "tokens" built in to monarch but
                // doesn't require whitespace delimited tokens.
                [tokens
                    .filter(x => x)
                    .map(escape)
                    .sort((x, y) => y.length - x.length)
                    .join("|"),
                    'keyword'],
                // Assume any abbreviation is "valid" - TODO can use 'keywords' to actually fix
                // by building a list of keywords that include all possible prefixes.
                [/[A-Z]+\./, 'keyword'],
                [/[a-zA-Z_][\w]*[$%]?/, 'type.identifier'],
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
                [/\b(REM\s*)\b.*/, 'comment']
            ],
            string: [
                [/[^"\u201c\u201d]+/, 'string'],
                [/["\u201c\u201d]C?/, {token: 'string.quote', next: '@pop'}]
            ],
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
            let suggestions = [];

            tokens.forEach(token =>{
              if (token !== null){
                suggestions.push({
                    label: token,
                    kind: languages.CompletionItemKind.Keyword,
                    insertText: token
                })
              }
            })
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
