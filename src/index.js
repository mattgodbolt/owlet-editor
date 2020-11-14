import $ from 'jquery';
import {editor as monacoEditor, KeyCode, KeyMod} from 'monaco-editor';
import {registerBbcBasicLanguage} from './bbcbasic';
import {Emulator} from './emulator';
import rootHtml from './root.html';

import './owlet-editor.less';

const DefaultProgram = [
    'PRINT "HELLO WORLD"',
    'GOTO 10'
].join('\n');

const StateVersion = 1;
const tweetMaximum = 280;

class OwletEditor {
    constructor() {
        const state = OwletEditor.decodeStateString(window.location.hash.substr(1));
        const program = state ? state.program : localStorage.getItem("program") || DefaultProgram;
        const editorPane = $('#editor');
        this.editStatus = $('#edit_status');
        this.emuStatus = $('#emu_status');
        this.observer = new ResizeObserver(() => this.editor.layout());
        this.observer.observe(editorPane.parent()[0]);
        this.editor = monacoEditor.create(editorPane[0], {
            value: program,
            minimap: {
                enabled: false
            },
            lineNumbers: l => l * 10,
            language: 'BBCBASIC',
            theme: 'vs-dark',
            renderWhitespace: "none", // seems to fix odd space/font interaction
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
            const basicText = this.getBasicText();
            localStorage.setItem("program", basicText);
            history.replaceState(null, '', `#${this.toStateString()}`);
            this.updateStatus(basicText);
        });
        this.emulator = new Emulator($('#emulator'));
        this.updateStatus(program);

        editorPane.on("")
    }

    getBasicText() {
        return this.editor.getModel().getValue();
    }

    toStateString() {
        const state = {v: StateVersion, program: this.getBasicText()};
        return encodeURIComponent(JSON.stringify(state));
    }

    static decodeStateString(stateString) {
        try {
            const state = JSON.parse(decodeURIComponent(stateString));
            if (state.v !== StateVersion)
                return null;
            return state;
        } catch (e) {
            return null;
        }
    }

    async onHashChange() {
        const state = OwletEditor.decodeStateString(window.location.hash.substr(1));
        if (state) {
            this.editor.getModel().setValue(state.program);
            await this.updateProgram();
            this.selectView('screen')
        }
    }

    async updateProgram() {
        await this.emulator.runProgram(this.getBasicText());
    }

    updateStatus(basicText) {
        this.editStatus
            .find(".count")
            .text(basicText.length)
            .toggleClass("too_long", basicText.length >= tweetMaximum);
        this.emuStatus.text("BBC Micro Model B | GXR ROM");
    }

    selectView(selected) {
        for (const element of ['screen', 'about', 'examples']) {
            $(`#${element}`).toggle(element === selected);
        }
        if (selected === 'screen')
            this.emulator.start();
        else
            this.emulator.pause();
    }

    async initialise() {
        await this.emulator.initialise();
        await this.updateProgram();
        const actions = {
            run: async () => {
                await this.updateProgram();
                this.selectView('screen')
            },
            jsbeeb: () => window.open(`https://bbc.godbolt.org/?embedBasic=${encodeURIComponent(this.getBasicText())}&rom=gxr.rom`, "_blank"),
            tweet: () => window.open(`https://twitter.com/intent/tweet?screen_name=BBCmicroBot&text=${encodeURIComponent(this.getBasicText())}`, '_new'),
            examples: () => this.selectView('examples'),
            emulator: () => this.selectView('screen'),
            about: () => this.selectView('about')
        };
        $(".toolbar button").click(e => actions[e.target.dataset.action]());
    }
}

async function initialise() {
    $('body').append(rootHtml);
    registerBbcBasicLanguage();

    const owletEditor = new OwletEditor();
    await owletEditor.initialise();

    window.onhashchange = () => owletEditor.onHashChange();

    function setTheme(themeName) {
        localStorage.setItem('theme', themeName);
        document.documentElement.className = themeName;
    }

    setTheme("theme-beeb-dark");
}

initialise().then(() => {
    console.log("Ready to go");
});
