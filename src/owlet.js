import $ from "jquery";
import {editor as monacoEditor, KeyCode, KeyMod} from "monaco-editor";
import {Emulator} from "./emulator";
import Examples from "./examples.yaml";
import {detokenise} from "./tokens";
import './owlet-editor.less';

const DefaultProgram = [
    'PRINT "HELLO WORLD"',
    'GOTO 10'
].join('\n');

const TweetMaximum = 280;

export class OwletEditor {
    constructor(optionalInitialProgram) {
        const program = optionalInitialProgram ? optionalInitialProgram : localStorage.getItem("program") || DefaultProgram;
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
            this.updateStatus(basicText);
        });
        this.emulator = new Emulator($('#emulator'));
        this.updateStatus(program);

        this.examples = {};
        for (const example of Examples.examples)
            this.addExample(example);
    }

    async chooseExample(id) {
        const example = this.examples[id];
        if (example.basic) {
            this.editor.getModel().setValue(example.basic);
            await this.updateProgram();
        }
    }

    addExample(example) {
        this.examples[example.id] = example;
        const $examples = $('#examples');
        const newElem =
            $examples.find("div.template")
                .clone()
                .removeClass("template")
                .appendTo($examples);
        newElem.find(".name")
            .text(example.name)
            .click(() => this.chooseExample(example.id));
        newElem.find(".description").text(example.description);
        if (example.basic)
            newElem.find(".code").text(example.basic);
    }

    getBasicText() {
        return this.editor.getModel().getValue();
    }

    async updateProgram() {
        await this.emulator.runProgram(this.getBasicText());
    }

    updateStatus(basicText) {
        this.editStatus
            .find(".count")
            .text(basicText.length)
            .toggleClass("too_long", basicText.length >= TweetMaximum);
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

    share() {
        const shareModal = document.getElementById("share");
        shareModal.style.display = "block";
    }

    async initialise() {
        await this.emulator.initialise();
        await this.updateProgram();
        const actions = {
            run: async () => {
                await this.updateProgram();
                this.selectView('screen')
            },
            examples: () => this.selectView('examples'),
            jsbeeb: () => window.open(`https://bbc.godbolt.org/?embedBasic=${encodeURIComponent(this.getBasicText())}&rom=gxr.rom`, "_blank"),
            tweet: () => this.share(),
            emulator: () => this.selectView('screen'),
            about: () => this.selectView('about'),
            detokenise: () => this.editor.getModel().setValue(detokenise(this.getBasicText()))
        };
        $(".toolbar button").click(e => actions[e.target.dataset.action]());
    }
}
