import {editor as monacoEditor, Range} from "monaco-editor/editor/editor.api";
import ResizeObserver from "resize-observer-polyfill";
import {BasicWatch} from "./basic-watch";
import {programStatements, statementAt} from "./statement-map";

// The classes and scroll bar colour of each kind of mark: the statement running, the one an error stopped the program
// in, and the one Escape stopped it in, which people press on purpose.
const Marks = {
    running: {line: "debug-running-line", statement: "debug-running-statement", colour: "#5e8040"},
    error: {line: "debug-error-line", statement: "debug-error-statement", colour: "#b03a3a"},
    quiet: {line: "debug-quiet-line", statement: "debug-quiet-statement", colour: "#a08440"},
};
const EscapeError = 17;
const ShowBeamKey = "showBeam";
// The latest error an ON ERROR handler took is marked strongly for about a second of the program running on.
const FreshFrames = 50;
const HandledColour = "#e06060";
const WaitedFor = {
    keyboard: "keyboard input",
    vsync: "vsync",
    "filing system": "the filing system",
    sound: "room in the sound queue",
};

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

const markFor = error => (error.number === EscapeError ? "quiet" : "error");

function describeError(error, range) {
    const what = isStop(error) ? "STOP" : `${error.message} (ERR ${error.number})`;
    if (!error.line) return `${what} in a command typed at the prompt`;
    const where = `at line ${error.line.number}${range ? "" : ", which has changed since the error"}`;
    return `${what} ${where}. The variables are as the program left them.`;
}

function describeHandled(error, range) {
    const where = error.line
        ? ` at line ${error.line.number}${range ? "" : " (since changed)"}`
        : "";
    const times = error.count > 1 ? `, ${error.count} times` : "";
    const handler = error.handler === null ? "" : ` at line ${error.handler}`;
    return `${error.message} (ERR ${error.number})${where}${times}, taken by the ON ERROR${handler}`;
}

const handledTitle = total =>
    `${total} ${total === 1 ? "error" : "errors"} taken by ON ERROR, the latest first:`;

function describeWait({kind, keyword}, number) {
    return `Waiting for ${WaitedFor[kind]}${keyword ? ` (${keyword})` : ""} at line ${number}`;
}

function describe(state, range) {
    if (!state.basic) return `Not BASIC: the language is ${state.title || "an unnamed ROM"}`;
    if (state.error) return describeError(state.error, range);
    if (!state.line) return "At BASIC's prompt";
    const {number} = state.line;
    const doing = state.wait ? describeWait(state.wait, number) : `Running line ${number}`;
    return range ? doing : `${doing}, which is not as in the editor`;
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
        this.handled = this.panel.querySelector(".debug-handled");
        this.handledMark = editor.createDecorationsCollection();
        this.variables = this.panel.querySelector(".debug-variables");
        this.routines = this.panel.querySelector(".debug-routines");
        this.button = document.getElementById("debug");
        this.beamButton = document.getElementById("show-beam");
        this.beamWanted = localStorage.getItem(ShowBeamKey) === "true";
        this.beamButton.setAttribute("aria-pressed", String(this.beamWanted));
        this.on = false;
        this.screenShown = true;
        this.program = null;
        this.frame = 0;
        this.latestHandled = {total: 0, frame: 0};
        this.forgetShown();
        emulator.onProgramStart = () => this.watch.restart();
        new ResizeObserver(() => this.reserveScreen()).observe(this.panel);
    }

    toggle() {
        this.on = !this.on;
        this.button.setAttribute("aria-pressed", String(this.on));
        this.emulator.onFrame = this.on ? () => this.update() : null;
        if (!this.on) this.watch.untrack();
        this.forgetShown();
        this.showBeam();
        if (this.on) this.update();
        else {
            this.decorations.clear();
            this.handledMark.clear();
        }
        this.showPanel();
    }

    toggleBeam() {
        this.beamWanted = !this.beamWanted;
        localStorage.setItem(ShowBeamKey, String(this.beamWanted));
        this.beamButton.setAttribute("aria-pressed", String(this.beamWanted));
        this.showBeam();
    }

    showBeam() {
        this.emulator.showBeam(this.on && this.beamWanted);
    }

    forgetShown() {
        this.shown = {
            status: null,
            mark: null,
            variables: null,
            range: null,
            handled: null,
            handledRange: null,
        };
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
        this.showHandled(state.basic ? state.handled : {total: 0, errors: []});
        this.showVariables(state.basic ? state : {residents: [], variables: [], routines: []});
    }

    /**
     * Lists the errors ON ERROR handlers took, and marks the latest one's statement: dashed, so as not to be taken for
     * the error the program stopped with, and fainter once the program has run on for a while without another.
     */
    showHandled({total, errors}) {
        ++this.frame;
        if (total !== this.latestHandled.total) this.latestHandled = {total, frame: this.frame};
        const ranges = errors.map(
            error => error.line && statementAt(this.statements(), error.line),
        );
        const rows = errors.map((error, i) => ({
            text: describeHandled(error, ranges[i]),
            mark: markFor(error),
        }));
        const shown = JSON.stringify([total, rows]);
        if (shown !== this.shown.handled) {
            this.shown.handled = shown;
            this.listHandled(total, rows);
        }
        const fresh = this.frame - this.latestHandled.frame < FreshFrames;
        this.markHandled(ranges[0] ?? null, errors[0] && markFor(errors[0]), fresh);
    }

    /** Shows the list, changing only the text of rows already there, as it can change every frame. */
    listHandled(total, rows) {
        this.handled.hidden = total === 0;
        if (this.handled.children.length !== rows.length + 1)
            this.handled.replaceChildren(
                element("div", "debug-handled-title", ""),
                ...rows.map(() => element("div", "debug-handled-error", "")),
            );
        const [title, ...items] = this.handled.children;
        title.textContent = handledTitle(total);
        rows.forEach(({text, mark}, i) => {
            items[i].textContent = text;
            items[i].dataset.mark = mark;
        });
    }

    markHandled(range, mark, fresh) {
        const shown = range && JSON.stringify([range, mark, fresh]);
        if (shown === this.shown.handledRange) return;
        this.shown.handledRange = shown;
        if (!range) return void this.handledMark.clear();
        const {lineNumber, startColumn, endColumn} = range;
        const classes = ["debug-handled-statement"];
        if (mark === "quiet") classes.push("debug-handled-quiet");
        if (!fresh) classes.push("debug-handled-faded");
        this.handledMark.set([
            {
                range: new Range(lineNumber, startColumn, lineNumber, endColumn),
                options: {
                    className: classes.join(" "),
                    overviewRuler: {
                        color: mark === "quiet" ? Marks.quiet.colour : HandledColour,
                        position: monacoEditor.OverviewRulerLane.Left,
                    },
                },
            },
        ]);
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
