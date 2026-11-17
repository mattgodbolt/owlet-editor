import {editor as monacoEditor, Range} from "monaco-editor/editor/editor.api";
import ResizeObserver from "resize-observer-polyfill";
import {BasicWatch} from "./basic-watch";
import {programStatements, statementAt} from "./statement-map";

// The classes and scroll bar colour of each kind of mark: the statement running, the one an error stopped the program
// in, and the one it stopped in by Escape or STOP, which people do on purpose.
const Marks = {
    running: {line: "debug-running-line", statement: "debug-running-statement", colour: "#5e8040"},
    error: {line: "debug-error-line", statement: "debug-error-statement", colour: "#b03a3a"},
    quiet: {line: "debug-quiet-line", statement: "debug-quiet-statement", colour: "#a08440"},
};
const EscapeError = 17;

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

const isStop = ({number, message}) => number === 0 && message === "STOP";

const markFor = error => (error.number === EscapeError || isStop(error) ? "quiet" : "error");

function describeError(error, range) {
    const what = isStop(error) ? "STOP" : `${error.message} (ERR ${error.number})`;
    if (!error.line) return `${what} in a command typed at the prompt`;
    const where = `at line ${error.line.number}${range ? "" : ", which has changed since the error"}`;
    return `${what} ${where}. The variables are as the program left them.`;
}

function describe(state, range) {
    if (!state.basic) return `Not BASIC: the language is ${state.title || "an unnamed ROM"}`;
    if (state.error) return describeError(state.error, range);
    if (!state.line) return "At BASIC's prompt";
    if (!range) return `Running line ${state.line.number}, which is not as in the editor`;
    return `Running line ${state.line.number}`;
}

/**
 * Shows what BASIC is doing as the emulator runs: its variables in a panel under the screen, and the statement it is
 * running, or the one an error stopped the program in, marked in the editor. Nothing is read from the machine while it
 * is off.
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
        this.shown = {status: null, mark: null, variables: null, range: null};
        emulator.onProgramStart = () => this.watch.restart();
        new ResizeObserver(() => this.reserveScreen()).observe(this.panel);
    }

    toggle() {
        this.on = !this.on;
        this.button.setAttribute("aria-pressed", String(this.on));
        this.emulator.onFrame = this.on ? () => this.update() : null;
        if (!this.on) this.watch.untrack();
        this.shown = {status: null, mark: null, variables: null, range: null};
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
        const line = state.line ?? state.error?.line;
        const range = state.basic && line ? statementAt(this.statements(), line) : null;
        const mark = state.error ? markFor(state.error) : "running";
        this.showRange(range, mark);
        this.showStatus(describe(state, range), state.error ? mark : null);
        this.showVariables(state.basic ? state : {residents: [], variables: [], routines: []});
    }

    showRange(range, mark) {
        const shown = range && JSON.stringify([range, mark]);
        if (shown === this.shown.range) return;
        this.shown.range = shown;
        if (!range) return void this.decorations.clear();
        const {lineNumber, startColumn, endColumn} = range;
        const {line, statement, colour} = Marks[mark];
        this.decorations.set([
            {
                range: new Range(lineNumber, 1, lineNumber, 1),
                options: {
                    isWholeLine: true,
                    className: line,
                    overviewRuler: {color: colour, position: monacoEditor.OverviewRulerLane.Full},
                },
            },
            {
                range: new Range(lineNumber, startColumn, lineNumber, endColumn),
                options: {className: statement},
            },
        ]);
    }

    /** Shows `text` as the status, in the colour of the error `mark` it is about, if it is about one. */
    showStatus(text, mark) {
        if (text === this.shown.status && mark === this.shown.mark) return;
        this.shown.status = text;
        this.shown.mark = mark;
        this.status.textContent = text;
        this.status.dataset.mark = mark ?? "";
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
