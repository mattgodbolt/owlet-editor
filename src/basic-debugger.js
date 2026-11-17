import {editor as monacoEditor, Range} from "monaco-editor/editor/editor.api";
import ResizeObserver from "resize-observer-polyfill";
import {BasicWatch} from "./basic-watch";
import {programStatements, statementAt} from "./statement-map";

const RunningColour = "#5e8040";

function element(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    node.textContent = text;
    return node;
}

function variable({name, value}) {
    const item = element("div", "debug-variable", "");
    item.title = `${name} = ${value}`;
    item.append(element("span", "debug-name", name), element("span", "debug-value", value));
    return item;
}

function describe(state, range) {
    if (!state.basic) return `Not BASIC: the language is ${state.title || "an unnamed ROM"}`;
    if (!state.line) return "At BASIC's prompt";
    if (!range) return `Running line ${state.line.number}, which is not as in the editor`;
    return `Running line ${state.line.number}`;
}

/**
 * Shows what BASIC is doing as the emulator runs: its variables in a panel under the screen, and the statement it is
 * running marked in the editor. Nothing is read from the machine while it is off.
 */
export class BasicDebugger {
    constructor(editor, emulator, dialect) {
        this.editor = editor;
        this.emulator = emulator;
        this.dialect = dialect;
        this.watch = new BasicWatch();
        this.decorations = editor.createDecorationsCollection();
        this.panel = document.getElementById("debugger");
        this.status = this.panel.querySelector(".debug-status");
        this.variables = this.panel.querySelector(".debug-variables");
        this.routines = this.panel.querySelector(".debug-routines");
        this.button = document.getElementById("debug");
        this.on = false;
        this.screenShown = true;
        this.program = null;
        this.shown = {status: null, variables: null, range: null};
        emulator.onProgramStart = () => this.watch.restart();
        new ResizeObserver(() => this.reserveScreen()).observe(this.panel);
    }

    toggle() {
        this.on = !this.on;
        this.button.setAttribute("aria-pressed", String(this.on));
        this.emulator.onFrame = this.on ? () => this.update() : null;
        if (!this.on) this.watch.untrack();
        this.shown = {status: null, variables: null, range: null};
        if (this.on) this.update();
        else this.decorations.clear();
        this.showPanel();
    }

    /** Whether the emulator's screen is the view shown, which the panel goes under. */
    setScreenShown(shown) {
        this.screenShown = shown;
        this.showPanel();
    }

    showPanel() {
        this.panel.hidden = !(this.on && this.screenShown);
        this.reserveScreen();
    }

    reserveScreen() {
        this.emulator.reserveBelowScreen(this.panel.hidden ? 0 : this.panel.offsetHeight);
    }

    /** The program's statements as the editor has it now, worked out again only after an edit or a change of BASIC. */
    statements() {
        const model = this.editor.getModel();
        const key = {version: model.getVersionId(), dialect: this.dialect()};
        if (this.program?.version !== key.version || this.program.dialect !== key.dialect)
            this.program = {...key, map: programStatements(model.getLinesContent(), key.dialect)};
        return this.program.map;
    }

    update() {
        const {cpu} = this.emulator;
        if (!cpu || this.emulator.rebuilding) return;
        const state = this.watch.read(cpu);
        const range = state.basic && state.line ? statementAt(this.statements(), state.line) : null;
        this.showRange(range);
        this.showStatus(describe(state, range));
        this.showVariables(state.basic ? state : {residents: [], variables: [], routines: []});
    }

    showRange(range) {
        const shown = range && JSON.stringify(range);
        if (shown === this.shown.range) return;
        this.shown.range = shown;
        if (!range) return void this.decorations.clear();
        const {lineNumber, startColumn, endColumn} = range;
        this.decorations.set([
            {
                range: new Range(lineNumber, 1, lineNumber, 1),
                options: {
                    isWholeLine: true,
                    className: "debug-running-line",
                    overviewRuler: {
                        color: RunningColour,
                        position: monacoEditor.OverviewRulerLane.Full,
                    },
                },
            },
            {
                range: new Range(lineNumber, startColumn, lineNumber, endColumn),
                options: {className: "debug-running-statement"},
            },
        ]);
    }

    showStatus(text) {
        if (text === this.shown.status) return;
        this.shown.status = text;
        this.status.textContent = text;
    }

    showVariables({residents, variables, routines}) {
        const all = [...residents, ...variables];
        const shown = JSON.stringify([all, routines]);
        if (shown === this.shown.variables) return;
        this.shown.variables = shown;
        this.variables.replaceChildren(...all.map(variable));
        this.routines.textContent = routines.join(" ");
    }
}
