import $ from "jquery";
import {
    editor as monacoEditor,
    KeyCode,
    KeyMod,
    MarkerSeverity,
} from "monaco-editor/editor/editor.api";
import "monaco-editor/editor/contrib/hover/browser/hoverContribution";
import "monaco-editor/editor/contrib/codeAction/browser/codeActionContributions";

import {Emulator} from "./emulator";
import {BasicDebugger} from "./basic-debugger";
import Examples from "./examples.yaml";
import {expandCode} from "./expand-code";
import {partialDetokenise} from "./detokenise";
import {createTokenisers, tokeniserFor} from "./tokeniser";
import {encode} from "base2048";
import "./owlet-editor.less";
import {
    getSyntaxMarkers,
    getWarnings,
    LanguageId,
    rebuildBracketPairs,
    registerBbcBasicLanguage,
    setTypingPoint,
    withoutCodes,
} from "./bbcbasic";
import {registerCompletions} from "./completions";
import {registerOccurrences} from "./occurrences";
import * as models from "jsbeeb/src/models";
import {dialectFor} from "./parser/dialect";
import {problemCount} from "./problem-count";
import {getLineNumberMarkers} from "./line-numbers";
import {
    Choices,
    DefaultMachine,
    choiceFor,
    choiceOf,
    labelOf,
    modelQuery,
    withMachine,
} from "./machines";
import {followImplicitLineNumbers} from "./renumber";
import {fitMarkerWidgetToWrappedMessage} from "./marker-widget";
import {makeUEF} from "./UEF";
import {AcornDFSdisc} from "./DFS";
import {createVduReference} from "./vdu-reference";
import {describeBuild} from "./version";

const TweetMaximum = 500;
const StateVersion = 1;
const SyntaxMarkerDelayMs = 500;

function defaultLineNumber(line) {
    return line * 10;
}

export class OwletEditor {
    constructor(onChangeHandler, onMachineChangeHandler) {
        const editorPane = $("#editor");
        this.editStatus = $("#edit_status");
        this.problems = $("#problems").on("click", () => {
            this.editor.focus();
            this.editor.trigger("problems", "editor.action.marker.next", null);
        });
        const build = describeBuild(
            import.meta.env.OWLET_GIT_SHA,
            import.meta.env.OWLET_BUILD_DATE,
        );
        $("#version").append(
            build.url ? $("<a>").attr("href", build.url).text(build.label) : build.label,
        );
        this.tokenisers = null;
        this.onChangeHandler = onChangeHandler;
        this.onMachineChangeHandler = onMachineChangeHandler;

        // The emulator starts on the default machine; setMachine changes the dialect when another is chosen.
        this.dialect = dialectFor(models.findModel(DefaultMachine));
        this.registerLanguage();

        monacoEditor.defineTheme("bbcbasicTheme", {
            base: "vs-dark",
            inherit: true,
            colors: {},
            rules: [
                {token: "variable", foreground: "bb8844"},
                {token: "number", foreground: "22bb88"},
                {token: "number.hex", fontStyle: "bold"},
                {token: "number.float", fontStyle: "italic"},
                {token: "constant.linenum", foreground: "44eeaa"},
                {token: "keyword.oscli", foreground: "bb66bb"},
                {token: "keyword.directive", fontStyle: "bold"},
            ],
        });

        this.editor = monacoEditor.create(editorPane[0], {
            value: "",
            minimap: {
                enabled: false,
            },
            // Enter would replace a name that begins a keyword, as A at the end of PRINT A becomes ABS; Tab accepts.
            acceptSuggestionOnEnter: "off",
            wordBasedSuggestions: "off",
            lineNumbers: defaultLineNumber,
            language: LanguageId,
            theme: "bbcbasicTheme",
            renderWhitespace: "none", // seems to fix odd space/font interaction
            fontSize: 16,
            scrollBeyondLastLine: false,
            wordWrap: "on",
            lineDecorationsWidth: 0,
            automaticLayout: true,
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
            keybindings: [KeyMod.CtrlCmd | KeyCode.KeyE],
            keybindingContext: null,
            contextMenuGroupId: "navigation",
            contextMenuOrder: 1.5,
            run: () => this.expandCode(),
        });

        // Alt+F8 and Ctrl+. are often intercepted outside the page (the problem hover advertises them); these come
        // later, so the hover footer shows them instead.
        monacoEditor.addKeybindingRules([
            {
                keybinding: KeyMod.Alt | KeyCode.Enter,
                command: "editor.action.quickFix",
                when: "editorTextFocus",
            },
            {keybinding: KeyCode.F8, command: "editor.action.marker.next", when: "editorFocus"},
        ]);

        this.followLineNumbers = followImplicitLineNumbers(this.editor, this.dialect);
        fitMarkerWidgetToWrappedMessage(this.editor);
        // An unfinished line is not marked while the cursor is on it, so moving off it marks it, unless an edit has the
        // markers about to be made anyway.
        this.editor.onDidChangeCursorPosition(({position}) => {
            if (this.typingEdited || position.lineNumber !== this.typingPoint?.lineNumber)
                this.followTyping();
            if (!this.syntaxTimer && position.lineNumber !== this.syntaxCursorLine)
                this.showSyntaxMarkers();
        });
        this.editor.getModel().onDidChangeContent(() => {
            this.typingEdited = true;
            queueMicrotask(() => {
                if (this.typingEdited) this.followTyping();
            });
            const basicText = this.getBasicText();
            this.onChangeHandler(basicText);
            this.lineNumberDetect(basicText);
            this.updateStatus(basicText);
            this.updateWarnings();
            this.updateSyntaxMarkers();
        });

        this.emulator = new Emulator($("#emulator"));
        this.basicDebugger = new BasicDebugger(this.editor, this.emulator, () => this.dialect);

        this.examples = {};
        for (const example of Examples.examples) this.addExample(example);
    }

    static stateForBasicProgram(program, choice = DefaultMachine) {
        return withMachine({v: StateVersion, program: program}, choice);
    }

    static decodeStateString(stateString, fixup = true) {
        try {
            const state = JSON.parse(decodeURIComponent(stateString));
            if (state.v !== 3 && state.v !== 1) return null;
            return state;
        } catch (e) {
            if (e instanceof URIError && fixup) {
                // URLs shared on Discord lose the "%25" that encodes a literal "%". Handle this as best we can.
                // See https://github.com/mattgodbolt/owlet-editor/issues/103
                const fixupRegex = /%([^0-9A-F][^0-9A-F]?)/g;
                return OwletEditor.decodeStateString(
                    stateString.replaceAll(fixupRegex, "%25$1"),
                    false,
                );
            }
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
        const model = this.editor.getModel();
        monacoEditor.setModelMarkers(
            model,
            "warnings",
            withoutCodes(getWarnings(model.getValue(), this.dialect)),
        );
    }

    // The line being typed is the one the cursor is on after an edit, until the cursor leaves it. Monaco reports the
    // cursor's move after the edit, and before its own listeners colour the line again (suggestions do, as you type);
    // an edit that leaves the cursor where it was (Delete) reports no move, and is followed once it is done.
    followTyping() {
        const edited = this.typingEdited;
        this.typingEdited = false;
        const model = this.editor.getModel();
        const {lineNumber, column} = this.editor.getPosition();
        if (!edited && lineNumber === this.typingPoint?.lineNumber) return;
        const text = edited ? model.getLineContent(lineNumber) : null;
        this.typingPoint = edited ? {lineNumber, text, column: column - 1} : null;
        setTypingPoint(model, this.typingPoint);
    }

    // The markers for lines that end too soon, and for lines that are not there yet, would be wrong while the line is
    // still being typed, so they come only after the typing stops. The old ones stay until then; Monaco moves them
    // along with the text.
    updateSyntaxMarkers() {
        clearTimeout(this.syntaxTimer);
        this.syntaxTimer = setTimeout(() => this.showSyntaxMarkers(), SyntaxMarkerDelayMs);
    }

    showSyntaxMarkers() {
        clearTimeout(this.syntaxTimer);
        this.syntaxTimer = null;
        const model = this.editor.getModel();
        this.syntaxCursorLine = this.editor.getPosition().lineNumber;
        const text = model.getValue();
        const {lineNumber, column} = this.typingPoint ?? {};
        const typingAt = lineNumber === this.syntaxCursorLine ? column : null;
        const syntax = getSyntaxMarkers(text, this.dialect, this.syntaxCursorLine, typingAt);
        const lineNumbers = getLineNumberMarkers(text, this.dialect, this.syntaxCursorLine);
        monacoEditor.setModelMarkers(model, "syntax", withoutCodes(syntax));
        monacoEditor.setModelMarkers(model, "lineNumbers", lineNumbers);
        const warnings = getWarnings(text, this.dialect);
        const summary = problemCount({syntax, lineNumbers, warnings});
        const [first] = [...syntax, ...lineNumbers, ...warnings].sort(
            (a, b) => a.startLineNumber - b.startLineNumber || a.startColumn - b.startColumn,
        );
        this.problems
            .prop("hidden", !summary)
            .text(summary)
            .attr("title", first?.message ?? "");
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
                previousSelections,
            );
            this.editor.pushUndoStop();
            // Monaco colours the lines of a replaced text in idle time, which a running emulator can leave it no
            // chance of, so the whole text is coloured here.
            this.editor
                .getModel()
                .tokenization.forceTokenization(this.editor.getModel().getLineCount());
        } else {
            this.setProgram(newText);
        }
    }

    setProgram(text) {
        const model = this.editor.getModel();
        model.setValue(text);
        rebuildBracketPairs(model);
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
        const state = OwletEditor.stateForBasicProgram(basicText, this.choice);
        return encodeURIComponent(JSON.stringify(state))
            .replace(/[(]/g, "%28")
            .replace(/[)]/g, "%29");
    }

    async setState(state) {
        // Turn invisible characters into equivalent visible ones.
        const basic = state.program
            // eslint-disable-next-line no-control-regex
            .replace(/[\x00-\x09\x0b-\x1f\x7f-\u009f]/g, function (c) {
                return String.fromCharCode(c.charCodeAt(0) | 0x100);
            })
            .replace(/[\u201c\u201d]/g, '"'); // BBCMicrobot normalises smartquotes like this.
        this.setProgram(basic);
        this.selectView("screen");

        if (state.mode > 1) {
            // A snapshot from bbcmicrobot is of a Model B.
            if (this.setMachine(DefaultMachine)) await this.emulator.initialise();
            //  Load BBC Micro state snapshot
            await this.updateProgram();
            this.emulator.pause();
            this.emulator.snapshot.load(state.state, this.emulator.cpu);
            console.log(state.state);
            this.emulator.setTotalCycles(this.emulator.cyclesPerSecond * 60 * 60 * 3);
            this.emulator.start();
        } else {
            this.setMachine(choiceOf(state));
            await this.emulator.initialise();
            this.updateProgram();
        }
    }

    registerLanguage() {
        registerBbcBasicLanguage(this.dialect);
        registerOccurrences(this.dialect);
        registerCompletions(this.dialect);
    }

    /** Has the editor read BBC BASIC as the chosen machine's BASIC does. */
    useDialect(dialect) {
        if (dialect === this.dialect) return;
        this.dialect = dialect;
        this.registerLanguage();
        this.followLineNumbers.dispose();
        this.followLineNumbers = followImplicitLineNumbers(this.editor, dialect);
    }

    /** The menu choice the emulator is on. */
    get choice() {
        return choiceFor(this.emulator.machine, this.emulator.useGxr);
    }

    /** Chooses the machine the emulator builds next, and its BASIC for the editor; returns whether it changed. */
    setMachine(choice) {
        const {machine, gxr} = Choices[choice];
        const changed = this.emulator.setMachine(machine, gxr);
        $("#machine").val(choice);
        // The snapshot beebjit sends is of a Model B, with or without the GXR.
        const sendable = machine === DefaultMachine;
        $("#rocket")
            .prop("disabled", !sendable)
            .attr("title", sendable ? "send to beebjit" : "bbcmicrobot snapshots are of a Model B");
        this.useDialect(dialectFor(this.emulator.model, this.emulator.useGxr));
        this.updateWarnings();
        this.showSyntaxMarkers();
        this.onMachineChangeHandler(choice);
        return changed;
    }

    async chooseMachine(choice) {
        const $machine = $("#machine").prop("disabled", true);
        const previous = this.choice;
        try {
            this.setMachine(choice);
            await this.emulator.initialise();
            this.run();
        } catch (e) {
            // The machine that was running goes on.
            this.setMachine(previous);
            throw e;
        } finally {
            $machine.prop("disabled", false);
        }
    }

    run() {
        this.updateProgram();
        this.emulator.pause();
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

    /** The tokeniser of the chosen machine's BASIC, or null until they are created at startup. */
    get tokeniser() {
        return this.tokenisers && tokeniserFor(this.tokenisers, this.emulator.model);
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
        this.editStatus
            .find(".count")
            .text(`${outputProgram.length}`)
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
            $play.html('<i class="fa-solid fa-play" style="pointer-events: none;"></i>');
        } else {
            this.emulator.start();
            $play.removeClass("play");
            $play.html("&#10074;&#10074;");
        }

        for (const element of ["screen", "about", "examples", "reference"]) {
            $(`#${element}`).toggle(element === selected);
            $(`#${element}-button`).toggleClass("selected", element === selected);
        }
        this.basicDebugger.setScreenShown(selected === "screen");
    }

    share() {
        const shareModal = document.getElementById("share");
        const copyText = document.getElementById("copyText");
        shareModal.style.display = "block";
        // A link made with the sound on asks for it, though the browser still needs a click to allow it.
        const sound = this.emulator.sound.isOn ? "?sound" : "";
        copyText.value = `${location.origin}/${sound}#${this.toStateString(this.getBasicText())}`;
    }

    save() {
        const saveModal = document.getElementById("save");
        const saveStartAddr = document.getElementById("saveStartAddr");
        const saveLen = document.getElementById("saveLen");
        saveModal.style.display = "block";
        const PAGE = this.emulator.readmem(0x18) << 8;
        const TOP = (this.emulator.readmem(0x13) << 8) | this.emulator.readmem(0x12);
        saveStartAddr.value = PAGE;
        saveLen.value = TOP - PAGE;
    }

    expandCode() {
        // The tokeniser is created asynchronously at startup; until it exists nothing can be judged, so expand as before.
        const fits = line => {
            if (!this.tokeniser) return true;
            try {
                this.tokeniser.tokenise(line);
                return true;
            } catch (e) {
                return false;
            }
        };
        this.updateEditorText(expandCode(this.getBasicText(), this.dialect, fits), "expand code");
    }

    tokenise() {
        const rawTokenised = this.tryGetTokenisedText();
        if (!rawTokenised) {
            // TODO, something went wrong.
            return;
        }
        this.updateEditorText(partialDetokenise(rawTokenised, this.dialect), "tokenise");
    }

    copy() {
        const copyText = document.getElementById("copyText");
        copyText.select();
        copyText.setSelectionRange(0, 99999); // For mobile devices
        document.execCommand("copy");
    }

    closeModal() {
        const modal = document.getElementById("share");
        const modal2 = document.getElementById("save");
        modal.style.display = "none";
        modal2.style.display = "none";
    }

    codeToTweet() {
        let text = this.getBasicText();
        if (text.length > TweetMaximum) {
            text = encode(text.split("").map(c => c.charCodeAt(0)));
        }
        return encodeURIComponent(text);
    }

    toggleSound() {
        const {sound} = this.emulator;
        if (sound.isOn) sound.disable();
        else sound.enable();
    }

    showSound(state) {
        const $sound = $("#sound");
        const labels = {
            off: ["Sound off", "Turn sound on"],
            armed: [
                "Click for sound",
                "Sound is on its way: click anywhere or press a key to turn it on",
            ],
            on: ["Sound on", "Turn sound off"],
            unavailable: [
                "No sound",
                `Sound is not available: ${this.emulator.sound.failure}${this.emulator.sound.retryable ? ". Click to try again" : ""}`,
            ],
        };
        const [label, title] = labels[state];
        // The name is the words on the button (and stays when portrait hides them), so "click Sound off" matches it;
        // it says whether sound is on, so aria-pressed would only say it again.
        $sound.attr({
            "data-state": state,
            "aria-label": label,
            title,
        });
        $("#sound-label").text(label);
    }

    async rocket() {
        // The snapshot beebjit loads is of a Model B, whatever machine is running.
        if (this.emulator.machine !== DefaultMachine) return;
        this.updateProgram();
        const $rocket = $("#rocket");
        $rocket.addClass("backgroundAnimated");
        const program = await this.tokeniser.tokenise(this.getBasicText());
        await this.emulator.beebjit(program);
        $rocket.removeClass("backgroundAnimated");
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
        disc.save("SCREEN", screenDump, 0xffff3000, 0x0000);
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
                }),
            );
            link.remove();
        }
    }

    async openCassette() {
        let tokenized = await this.tokeniser.tokenise(this.getBasicText());

        let uef = btoa(
            String.fromCharCode.apply(null, makeUEF("TWEET", 0x1900, 0x1900, tokenized)),
        );
        console.log(uef);
        uef = uef.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); // make URL safe base64

        window.open(`https://bbcmic.ro/tape/index.html?DATA=${uef}`, "_new");
    }

    async initialise(initialState) {
        await this.emulator.initialise();

        this.tokenisers = await createTokenisers();

        const {sound} = this.emulator;
        sound.onChange = state => this.showSound(state);
        this.showSound(sound.state);
        // The button turns sound on itself, so a click on it is not also taken as the one that arms.
        sound.ignore = event =>
            event.target instanceof Element && event.target.closest("#sound") !== null;
        const actions = {
            run: () => this.run(),
            new: () => this.updateEditorText("", "new"),
            tokenise: () => this.tokenise(),
            expand: () => this.expandCode(),
            share: () => this.share(),
            save: () => this.save(),

            emulator: () => this.selectView("screen"),
            examples: () => this.selectView("examples"),
            about: () => this.selectView("about"),
            reference: () =>
                this.selectView(
                    $("#reference-button").hasClass("selected") ? "screen" : "reference",
                ),

            virtualbeeb: () => {
                const gxr = this.emulator.hasGxr ? "&rom=gxr.rom" : "";
                window.open(
                    `https://virtual.bbcmic.ro/?embedBasic=${encodeURIComponent(
                        this.getBasicText(),
                    )}${gxr}${modelQuery(this.emulator.machine)}`,
                    "_blank",
                );
                this.closeModal();
            },
            jsbeeb: () => {
                const gxr = this.emulator.hasGxr ? "&rom=gxr.rom" : "";
                window.open(
                    `https://bbc.xania.org/?embedBasic=${encodeURIComponent(
                        this.getBasicText(),
                    )}${gxr}${modelQuery(this.emulator.machine)}`,
                    "_blank",
                );
                this.closeModal();
            },
            rocket: () => this.rocket(),
            sound: () => this.toggleSound(),
            debug: () => this.basicDebugger.toggle(),
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
                /* FIXME Automate posting to Mastodon?
                window.open(
                    `https://twitter.com/intent/tweet?screen_name=BBCmicrobot&text=${this.codeToTweet()}`,
                    "_new"
                );
                */
                this.closeModal();
            },
            copyMem: () => {
                let data = "";
                const saveStartAddr = document.getElementById("saveStartAddr");
                const saveLen = document.getElementById("saveLen");
                let addr = saveStartAddr.value;
                let len = saveLen.value;
                let byte10Count = 0;
                let byte13Count = 0;
                while (len--) {
                    let b = this.emulator.readmem(addr++);
                    if (b < 32 || (b >= 127 && b < 161)) {
                        if (b === 10) ++byte10Count;
                        if (b === 13) ++byte13Count;
                        b += 0x100;
                    }
                    data += String.fromCodePoint(b);
                }
                saveLen.value = data;
                saveLen.select();
                saveLen.setSelectionRange(0, 99999); // For mobile devices
                document.execCommand("copy");
                if (byte10Count || byte13Count) {
                    let message = "problematic byte values:";
                    if (byte10Count) {
                        message += " 10 (x" + byte10Count.toString() + ")";
                    }
                    if (byte13Count) {
                        message += " 13 (x" + byte13Count.toString() + ")";
                    }
                    alert(message);
                }
                this.closeModal();
            },
            closeModal: () => this.closeModal(),
        };
        $("button[data-action]").click(e => actions[e.target.dataset.action]());
        const $machine = $("#machine");
        for (const choice of Object.keys(Choices))
            $("<option>").val(choice).text(labelOf(choice)).appendTo($machine);
        $machine.change(() => this.chooseMachine($machine.val()));

        createVduReference($("#reference")[0]);

        this.setState(initialState);
    }
}
