import $ from "jquery";
import {editor as monacoEditor, KeyCode, KeyMod, MarkerSeverity} from "monaco-editor/esm/vs/editor/editor.api";

import {Emulator} from "./emulator";
import Examples from "./examples.yaml";
import {expandCode, partialDetokenise} from "./tokens";
import {encode} from 'base2048';
import tokenise from 'jsbeeb/basic-tokenise';
import './owlet-editor.less';
import {allTokensRegex} from "./bbcbasic";

const DefaultProgram = [
    'PRINT "HELLO WORLD"',
    'GOTO 10'
].join('\n');

const TweetMaximum = 280;
const StateVersion = 1;

function defaultLineNumber(line) {
    return line * 10;
}

const LowerCaseTokenRegex = new RegExp(`^(${allTokensRegex.toLowerCase()})`);

export class OwletEditor {
    constructor() {
        const editorPane = $('#editor');
        this.editStatus = $('#edit_status');
        this.emuStatus = $('#emu_status');
        this.observer = new ResizeObserver(() => this.editor.layout());
        this.observer.observe(editorPane.parent()[0]);
        this.tokeniser = null;

        monacoEditor.defineTheme('bbcbasicTheme', {
            base: 'vs-dark',
            inherit: true,
            rules: [
                {token: 'variable', foreground: 'bb8844'},
                {token: 'number', foreground: '22bb88'}
            ]
        });

        this.editor = monacoEditor.create(editorPane[0], {
            value: '',
            minimap: {
                enabled: false
            },
            lineNumbers: defaultLineNumber,
            language: 'BBCBASIC',
            theme: 'bbcbasicTheme',
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
            run: () => this.updateProgram()
        });

        this.editor.addAction({
            id: 'expand-code',
            label: 'Expand code',
            keybindings: [KeyMod.CtrlCmd | KeyCode.KEY_E],
            keybindingContext: null,
            contextMenuGroupId: 'navigation',
            contextMenuOrder: 1.5,
            run: () => this.expandCode()
        });

        this.editor.getModel().onDidChangeContent(() => {
            const basicText = this.getBasicText();
            localStorage.setItem("program", basicText);
            this.lineNumberDetect(basicText);
            this.updateStatus(basicText);
            this.updateWarnings();
        });

        this.emulator = new Emulator($('#emulator'));

        this.examples = {};
        for (const example of Examples.examples)
            this.addExample(example);
    }

    static stateForBasicProgram(program) {
        return {v: StateVersion, program: program};
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

    chooseExample(id) {
        const example = this.examples[id];
        if (example.basic) {
            this.updateEditorText(example.basic, "load example");
            this.updateProgram();
        }
    }

    updateWarnings() {
        const warnings = [];
        const model = this.editor.getModel();
        const tokens = monacoEditor.tokenize(this.getBasicText(), 'BBCBASIC');
        let lineNum = 0;
        for (const lineTokens of tokens) {
            lineNum++;
            const line = model.getLineContent(lineNum);
            for (const token of lineTokens.filter(token => token.type === 'variable.BBCBASIC')) {
                const match = line.substr(token.offset).match(LowerCaseTokenRegex);
                if (match) {
                    warnings.push({
                        severity: MarkerSeverity.Warning,
                        message: `BASIC keywords should be upper case, did you mean ${match[0].toUpperCase()}`,
                        startLineNumber: lineNum,
                        startColumn: token.offset + 1,
                        endLineNumber: lineNum,
                        endColumn: token.offset + match[0].length + 1,
                    });
                }
            }
        }
        monacoEditor.setModelMarkers(model, 'warnings', warnings);
    }

    updateEditorText(newText, updateType) {
        if (updateType) {
            this.editor.pushUndoStop();
            const previousSelections = this.editor.getSelections();
            this.editor.executeEdits(
                updateType,
                [{
                    range: this.editor.getModel().getFullModelRange(),
                    text: newText
                }],
                previousSelections);
            this.editor.pushUndoStop();
        } else {
            this.editor.getModel().setValue(newText);
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

    toStateString() {
        return encodeURIComponent(JSON.stringify(OwletEditor.stateForBasicProgram(this.getBasicText())));
    }

    setState(state) {
        this.editor.getModel().setValue(state.program);
        this.updateProgram();
        this.selectView('screen');
    }

    lineNumberDetect(text) {
        if (/^\s*\d+/.test(text)) {
            this.editor.updateOptions({lineNumbers: "off"});
        } else {
            this.editor.updateOptions({lineNumbers: defaultLineNumber});
        }
    }

    getBasicText() {
        return this.editor.getModel().getValue();
    }

    tryGetTokenisedText() {
        try {
            return this.tokeniser.tokenise(this.getBasicText());
        } catch (e) {
            return null;
        }
    }

    updateProgram() {
        const tokenised = this.tryGetTokenisedText();
        const markers = [];
        if (tokenised) {
            this.emulator.runProgram(tokenised);
        } else {
            // Try and find the lines that we couldn't tokenise.
            const numLines = this.editor.getModel().getLineCount();
            for (let lineNum = 1; lineNum <= numLines; ++lineNum) {
                try {
                    this.tokeniser.tokenise(this.editor.getModel().getLineContent(lineNum));
                } catch (e) {
                    markers.push(
                        {
                            severity: MarkerSeverity.Error,
                            message: "Unable to tokenise line - too many characters?",
                            startLineNumber: lineNum,
                            startColumn: 0,
                            endLineNumber: lineNum,
                            endColumn: Infinity,
                        }
                    );
                }
            }
        }
        monacoEditor.setModelMarkers(this.editor.getModel(), 'updateProgram', markers);
    }

    updateStatus(basicText) {
        let outputProgram = basicText;
        let format = "text";

        if (outputProgram.length > TweetMaximum) {
            outputProgram = encode(outputProgram.split("").map(c => c.charCodeAt(0)));
            format = "base2048";
        }

        this.editStatus
            .find(".count")
            .text(`${outputProgram.length} ${format}`)
            .toggleClass("too_long", outputProgram.length > TweetMaximum);

        this.emuStatus.text("BBC Micro Model B | GXR ROM");
    }


    selectView(selected) {

        if (selected !== 'screen' || (selected === 'screen' && this.emulator.running && $("#screen-button").hasClass("selected"))) {
            this.emulator.pause();
            $("#screen-button").html("▶");
        } else {
            this.emulator.start();
            $("#screen-button").html("&#10074;&#10074;");
        }

        for (const element of ['screen', 'about', 'examples']) {
            $(`#${element}`).toggle(element === selected);
            $(`#${element}-button`).toggleClass("selected", element === selected);
        }

    }

    share() {
        const shareModal = document.getElementById("share");
        const copyText = document.getElementById("copyText");
        shareModal.style.display = "block";
        copyText.value = `${location.origin}/#${this.toStateString()}`;
    }

    expandCode() {
        this.updateEditorText(expandCode(this.getBasicText()), "expand code");
    }

    tokenise() {
        const rawTokenised = this.tryGetTokenisedText();
        if (!rawTokenised) {
            // TODO, something went wrong.
            return;
        }
        this.updateEditorText(partialDetokenise(rawTokenised), "tokenise");
    }

    copy() {
        const copyText = document.getElementById("copyText");
        copyText.select();
        copyText.setSelectionRange(0, 99999); // For mobile devices
        document.execCommand("copy");
    }

    closeModal() {
        const modal = document.getElementById("share");
        modal.style.display = "none";
    }

    codeToTweet() {
        let text = this.getBasicText();
        if (text.length > TweetMaximum) {
            text = encode(text.split("").map(c => c.charCodeAt(0)))
        }
        return encodeURIComponent(text);
    }

    async initialise(initialState) {
        await this.emulator.initialise();
        this.tokeniser = await tokenise.create();


        const actions = {
            run: () => {
                this.updateProgram();
                this.emulator.pause();
                this.selectView('screen');
            },
            tokenise: () => this.tokenise(),
            expand: () => this.expandCode(),
            share: () => this.share(),

            emulator: () => this.selectView('screen'),
            examples: () => this.selectView('examples'),
            about: () => this.selectView('about'),

            jsbeeb: () => window.open(`https://bbc.godbolt.org/?embedBasic=${encodeURIComponent(this.getBasicText())}&rom=gxr.rom`, "_blank"),

            copy: () => {
                this.copy();
                this.closeModal();
            },
            tweet: () => {
                window.open(`https://twitter.com/intent/tweet?screen_name=BBCmicrobot&text=${this.codeToTweet()}`, "_new");
                this.closeModal();
            },
            closeModal: () => this.closeModal()
        };
        $("button[data-action]").click(e => actions[e.target.dataset.action]());

        this.setState(initialState
            || OwletEditor.stateForBasicProgram(localStorage.getItem("program") || DefaultProgram));
    }
}
