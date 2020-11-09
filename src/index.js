import $ from 'jquery';
import {editor as monacoEditor, KeyMod, KeyCode} from 'monaco-editor';
import {registerBbcBasicLanguage} from './bbcbasic';
import {Emulator} from './emulator';
import rootHtml from './root.html';

import './screech.less';

let screech = null;

const DefaultProgram = [
    'PRINT "HELLO WORLD"',
    'GOTO 10'
].join('\n');

class Screech {
    constructor() {
        const editorPane = document.getElementById('editor');
        this.editor = monacoEditor.create(editorPane, {
            value: localStorage.getItem("program") || DefaultProgram,
            minimap: {
                enabled: false
            },
            lineNumbers: l => l * 10,
            language: 'BBCBASIC',
            theme: 'vs-dark',
            fontFamily: "ModeSeven",
            fontSize: 16,
            scrollBeyondLastLine: false,
            wordWrap: 'on',
            lineDecorationsWidth: 0
        });

        this.editor.addAction({
            id: 'execute-basic',
            label: 'Run',
            keybindings: [KeyMod.CtrlCmd | KeyCode.Enter],
            keybindingContext: null,
            contextMenuGroupId: 'navigation',
            contextMenuOrder: 1.5,
            run: async () => await this.emulator.runProgram(this.editor.getModel().getValue()),
        });

        this.editor.getModel().onDidChangeContent(() => {
            localStorage.setItem("program", this.editor.getModel().getValue());
        });
        this.emulator = new Emulator($('#emulator'));
    }

    async updateProgram() {
        await this.emulator.runProgram(this.editor.getModel().getValue());
    }

    async initialise() {
        await this.emulator.initialise();
        await this.updateProgram();
        $(".toolbar .run").click(async () => this.updateProgram());
    }
}

async function initialise() {
    $('body').append(rootHtml);
    registerBbcBasicLanguage();

    screech = new Screech();
    await screech.initialise();
}

initialise().then(() => {
    console.log("Ready to go");
});
