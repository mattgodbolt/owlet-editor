import $ from 'jquery';
import {editor as monacoEditor, KeyMod, KeyCode} from 'monaco-editor';
import {registerBbcBasicLanguage} from './bbcbasic';
import {Emulator} from './emulator';
import rootHtml from './root.html';

import './owlet-editor.less';

let owletEditor = null;

const DefaultProgram = [
    'PRINT "HELLO WORLD"',
    'GOTO 10'
].join('\n');

const GxrRomUrl = document.location.href + "jsbeeb/roms/gxr.rom";
const StateVersion = 1;

class OwletEditor {
    constructor() {
        const state = OwletEditor.decodeStateString(window.location.hash.substr(1));
        const program = state ? state.program : localStorage.getItem("program") || DefaultProgram;
        const editorPane = document.getElementById('editor');
        this.observer = new ResizeObserver(() => this.editor.layout());
        this.observer.observe(editorPane.parentElement);
        this.editor = monacoEditor.create(editorPane, {
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
            localStorage.setItem("program", this.getBasicText());
            history.replaceState(null, '', `#${this.toStateString()}`)
        });
        this.emulator = new Emulator($('#emulator'));
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
        console.log("hash changed");
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

    selectView(selected) {
        for (const element of ['screen', 'about', 'examples']) {
            document.getElementById(element).style.display = element === selected ? 'block' : 'none';
        }
    }

    async initialise() {
        await this.emulator.initialise();
        await this.updateProgram();
        const actions = {
            run: async () => {
                await this.updateProgram();
                this.selectView('screen')
            },
            pause: async () => {
                this.emulator.pause();
                this.selectView('screen')
            },
            resume: async () => {
                this.emulator.start();
                this.selectView('screen')
            },
            jsbeeb: () => {
                const url = `https://bbc.godbolt.org/?embedBasic=${encodeURIComponent(this.getBasicText())}&autorun&rom=gxr.rom`;
                window.open(url, "_blank");
            },
            tweet: () => {
                const url = `https://twitter.com/intent/tweet?screen_name=BBCmicroBot&text=${encodeURIComponent(this.getBasicText())}`;
                window.open(url, '_new');
            },
            examples: async () => this.selectView('examples'),
            emulator: async () => this.selectView('screen'),
            about: async () => this.selectView('about')
        };
        $(".toolbar button").click(e => actions[e.target.dataset.action]());
    }
}

async function initialise() {
    $('body').append(rootHtml);
    registerBbcBasicLanguage();

    owletEditor = new OwletEditor();
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
