import $ from "jquery";
import {
    editor as monacoEditor,
    KeyCode,
    KeyMod,
    MarkerSeverity,
} from "monaco-editor/esm/vs/editor/editor.api";

import {Emulator} from "./emulator";
import Examples from "./examples.yaml";
import {expandCode, partialDetokenise} from "./tokens";
import {encode} from "base2048";
import tokenise from "jsbeeb/basic-tokenise";
import "./owlet-editor.less";
import {getWarnings} from "./bbcbasic";
import ResizeObserver from "resize-observer-polyfill";
import {makeUEF} from "./UEF";
import {AcornDFSdisc} from "./DFS";

const TweetMaximum = 280;
const StateVersion = 1;

function defaultLineNumber(line) {
    return line * 10;
}

export class OwletEditor {
    constructor(onChangeHandler) {
        const editorPane = $("#editor");
        this.editStatus = $("#edit_status");
        this.observer = new ResizeObserver(() => this.editor.layout());
        this.observer.observe(editorPane.parent()[0]);
        this.tokeniser = null;
        this.onChangeHandler = onChangeHandler;

        monacoEditor.defineTheme("bbcbasicTheme", {
            base: "vs-dark",
            inherit: true,
            rules: [
                {token: "variable", foreground: "bb8844"},
                {token: "number", foreground: "22bb88"},
            ],
        });

        this.editor = monacoEditor.create(editorPane[0], {
            value: "",
            minimap: {
                enabled: false,
            },
            suggest: {
                showValues: false, // Prevents hex constants from trying to autocomplete
            },
            lineNumbers: defaultLineNumber,
            language: "BBCBASIC",
            theme: "bbcbasicTheme",
            renderWhitespace: "none", // seems to fix odd space/font interaction
            fontSize: 16,
            scrollBeyondLastLine: false,
            wordWrap: "on",
            lineDecorationsWidth: 0,
        });

        this.editor.addAction({
            id: "execute-basic",
            label: "Run",
            keybindings: [KeyMod.CtrlCmd | KeyCode.Enter],
            keybindingContext: null,
            contextMenuGroupId: "navigation",
            contextMenuOrder: 1.5,
            run: () => this.updateProgram(),
        });

        this.editor.addAction({
            id: "expand-code",
            label: "Expand code",
            keybindings: [KeyMod.CtrlCmd | KeyCode.KEY_E],
            keybindingContext: null,
            contextMenuGroupId: "navigation",
            contextMenuOrder: 1.5,
            run: () => this.expandCode(),
        });

        this.editor.getModel().onDidChangeContent(() => {
            const basicText = this.getBasicText();
            this.onChangeHandler(basicText);
            this.lineNumberDetect(basicText);
            this.updateStatus(basicText);
            this.updateWarnings();
        });

        this.emulator = new Emulator($("#emulator"));

        this.examples = {};
        for (const example of Examples.examples) this.addExample(example);
    }

    static stateForBasicProgram(program) {
        return {v: StateVersion, program: program};
    }

    static decodeStateString(stateString) {
        try {
            const state = JSON.parse(decodeURIComponent(stateString));
            if (state.v !== StateVersion) return null;
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
        const tokens = monacoEditor.tokenize(this.getBasicText(), "BBCBASIC");
        let lineNum = 0;
        for (const lineTokens of tokens) {
            warnings.push(...getWarnings(++lineNum, model.getLineContent(lineNum), lineTokens));
        }
        monacoEditor.setModelMarkers(model, "warnings", warnings);
    }

    updateEditorText(newText, updateType) {
        if (updateType) {
            this.editor.pushUndoStop();
            const previousSelections = this.editor.getSelections();
            this.editor.executeEdits(
                updateType,
                [
                    {
                        range: this.editor.getModel().getFullModelRange(),
                        text: newText,
                    },
                ],
                previousSelections
            );
            this.editor.pushUndoStop();
        } else {
            this.editor.getModel().setValue(newText);
        }
    }

    addExample(example) {
        this.examples[example.id] = example;

        const $examples = $("#examples");
        const newElem = $examples
            .find("div.template")
            .clone()
            .removeClass("template")
            .addClass("example")
            .click(() => this.chooseExample(example.id))
            .appendTo($examples);

        if (example.link) newElem.click(() => (window.location.href = example.link));

        newElem.find(".thumb").attr("src", example.thumb);
        newElem.find(".name").text(example.name);
        newElem.find(".description").text(example.description);
        if (example.basic)
            newElem.find(".code").text(example.basic.split("\n").slice(0, 3).join("\n"));
    }

    toStateString(basicText) {
        return encodeURIComponent(JSON.stringify(OwletEditor.stateForBasicProgram(basicText)))
            .replace(/[(]/g, "%28")
            .replace(/[)]/g, "%29");
    }

    setState(state) {
        // Turn invisible characters into equivalent visible ones.
        const basic = state.program.replace(/[\x00-\x09\x0b-\x1f\x7f-\u009f]/g, function (c) {
            return String.fromCharCode(c.charCodeAt(0) | 0x100);
        });
        this.editor.getModel().setValue(basic);
        this.updateProgram();
        this.selectView("screen");
    }

    lineNumberDetect(text) {
        if (/^\s*\d+/.test(text)) {
            this.editor.updateOptions({lineNumbers: "off"});
        } else {
            this.editor.updateOptions({lineNumbers: defaultLineNumber});
        }
    }

    getBasicText() {
        // We strip leading text here to avoid issues with any tokenisers that
        // aren't expecting any. This does mean "getBasicText()" doesn't round-trip
        // back; we lose the leading spaces. That's _probably_ a feature.
        // Added for #31.
        return this.editor
            .getModel()
            .getLinesContent()
            .map(line => line.trimStart())
            .join("\n");
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
                    markers.push({
                        severity: MarkerSeverity.Error,
                        message: "Unable to tokenise line - too many characters?",
                        startLineNumber: lineNum,
                        startColumn: 0,
                        endLineNumber: lineNum,
                        endColumn: Infinity,
                    });
                }
            }
        }
        monacoEditor.setModelMarkers(this.editor.getModel(), "updateProgram", markers);
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
    }

    selectView(selected) {
        const $play = $("#play-pause");
        if (
            selected !== "screen" ||
            (selected === "screen" &&
                this.emulator.running &&
                $("#screen-button").hasClass("selected"))
        ) {
            this.emulator.pause();
            $play.addClass("play");
            $play.html("▼");
        } else {
            this.emulator.start();
            $play.removeClass("play");
            $play.html("&#10074;&#10074;");
        }

        for (const element of ["screen", "about", "examples"]) {
            $(`#${element}`).toggle(element === selected);
            $(`#${element}-button`).toggleClass("selected", element === selected);
        }
    }

    share() {
        const shareModal = document.getElementById("share");
        const copyText = document.getElementById("copyText");
        shareModal.style.display = "block";
        copyText.value = `${location.origin}/#${this.toStateString(this.getBasicText())}`;
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
            text = encode(text.split("").map(c => c.charCodeAt(0)));
        }
        return encodeURIComponent(text);
    }

    async rocket() {
        $("#rocket").addClass("backgroundAnimated");
        const program = await this.tokeniser.tokenise(this.getBasicText());
        await this.emulator.beebjit(program);
        $("#rocket").removeClass("backgroundAnimated");
    }

    async downloadDisc() {
        let disc = new AcornDFSdisc();
        const program = await this.tokeniser.tokenise(this.getBasicText());
        const screenDump = [];

        for (let i = 0x3000; i <= 0x7fff; i++) {
            screenDump.push(this.emulator.cpu.readmem(i));
        }

        disc.save("README", "Created by Owlet https://bbcmic.ro\r", 0x0000, 0x0000);
        disc.save("PROGRAM", program, 0x1900, 0x1900);
        disc.save("SCREEN", screenDump, 0x3000, 0x0000);
        disc.save("!BOOT", 'CHAIN"PROGRAM"\r', 0x1900, 0x1900);

        downloadBlob(new Blob([disc.image]), "owletExport.ssd");

        function downloadBlob(blob, name) {
            const blobUrl = window.URL.createObjectURL(blob);
            // Create a link element and click it
            const link = document.createElement("a");
            link.href = blobUrl;
            link.download = name;
            document.body.appendChild(link);
            link.dispatchEvent(
                new MouseEvent("click", {
                    bubbles: true,
                    cancelable: true,
                    view: window,
                })
            );
            link.remove();
        }
    }

    async openCassette() {
        let tokenized = await this.tokeniser.tokenise(this.getBasicText());

        let uef = btoa(
            String.fromCharCode.apply(null, makeUEF("TWEET", 0x1900, 0x1900, tokenized))
        );
        console.log(uef);
        uef = uef.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); // make URL safe base64

        window.open(`https://bbcmic.ro/tape/index.html?DATA=${uef}`, "_new");
    }

    async initialise(initialState) {
        await this.emulator.initialise();
        this.tokeniser = await tokenise.create();

        const actions = {
            run: () => {
                this.updateProgram();
                this.emulator.pause();
                this.selectView("screen");
            },
            tokenise: () => this.tokenise(),
            expand: () => this.expandCode(),
            share: () => this.share(),

            emulator: () => this.selectView("screen"),
            examples: () => this.selectView("examples"),
            about: () => this.selectView("about"),

            jsbeeb: () =>
                window.open(
                    `https://bbc.godbolt.org/?embedBasic=${encodeURIComponent(
                        this.getBasicText()
                    )}&rom=gxr.rom`,
                    "_blank"
                ),
            rocket: () => this.rocket(),
            copy: () => {
                this.copy();
                this.closeModal();
            },
            cassette: () => {
                this.openCassette();
                this.closeModal();
            },
            disc: () => {
                this.downloadDisc();
                this.closeModal();
            },
            tweet: () => {
                window.open(
                    `https://twitter.com/intent/tweet?screen_name=BBCmicrobot&text=${this.codeToTweet()}`,
                    "_new"
                );
                this.closeModal();
            },
            closeModal: () => this.closeModal(),
        };
        $("button[data-action]").click(e => actions[e.target.dataset.action]());

        this.setState(initialState);
    }
}
