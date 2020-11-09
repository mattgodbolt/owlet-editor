import * as monaco from 'monaco-editor';
import {registerBbcBasicLanguage} from './bbcbasic';

function initialise() {
    registerBbcBasicLanguage();

    const editorPane = document.getElementById('editor');
    const editor = monaco.editor.create(editorPane, {
        value: [
            'PRINT "HELLO WORLD"',
            'GOTO 10'
        ].join('\n'),
        minimap: {
            enabled: false
        },
        lineNumbers: l => l * 10,
        language: 'BBCBASIC',
        theme: 'vs-dark',
        // fontFamily: "ModeSeven", // selected text breaks
        fontSize: 16,
        scrollBeyondLastLine: false,
        wordWrap: 'on',
        lineDecorationsWidth: 0
    });
}

initialise();
