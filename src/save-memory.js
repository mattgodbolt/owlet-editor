// The Save memory dialog: copies a range of the emulator's memory to the clipboard as text for a program line,
// showing first the bytes and the text it would copy, with the bytes a program line cannot hold picked out.
import {ShadowView} from "jsbeeb/src/paging";
import {BasicWatch} from "./basic-watch";
import {ExpressionError} from "./memory-expression";
import {
    basicNames,
    breaksLine,
    clipboardText,
    hex,
    memoryViews,
    ProgramView,
    readRange,
    resolveRange,
    screenIsShadow,
} from "./memory-range";

const PreviewMostBytes = 4096;
const PreviewTextCharacters = 256;
const ProblemsListed = 12;
const WideRowBytes = 16;
const NarrowRowBytes = 8;
const Portrait = "(orientation: portrait)";

const byId = id => document.getElementById(id);
const noNames = () => undefined;
const plural = (count, one) => `${count} ${one}${count === 1 ? "" : "s"}`;

function element(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    node.textContent = text;
    return node;
}

/** Puts `text` on the clipboard, by the older way where the page may not use the newer. */
async function toClipboard(text) {
    if (navigator.clipboard) {
        await navigator.clipboard.writeText(text);
        return;
    }
    const area = document.createElement("textarea");
    area.value = text;
    document.body.append(area);
    area.select();
    const copied = document.execCommand("copy");
    area.remove();
    if (!copied) throw new Error("the browser did not allow it");
}

export class SaveMemory {
    constructor(emulator) {
        this.emulator = emulator;
        this.watch = new BasicWatch();
        this.modal = byId("save");
        this.first = byId("saveStartAddr");
        this.mode = byId("saveMode");
        this.second = byId("saveLen");
        this.view = byId("saveView");
        this.summary = byId("saveSummary");
        this.shadowNote = byId("saveShadow");
        this.problems = byId("saveProblems");
        this.bytes = byId("savePreview");
        this.text = byId("saveText");
        this.copyButton = byId("saveCopy");
        this.isOpen = false;
        this.resume = false;
        this.range = null;
        // The BASIC program, as the dialog has always started; after that, the range last given.
        this.first.value = "PAGE";
        this.mode.value = "length";
        this.second.value = "TOP-PAGE";
        for (const input of [this.first, this.mode, this.second, this.view])
            input.addEventListener("input", () => this.refresh());
        for (const input of [this.first, this.second])
            input.addEventListener("keydown", event => {
                if (event.key === "Enter") this.copy();
            });
        document.addEventListener("keydown", event => {
            if (this.isOpen && event.key === "Escape") this.close();
        });
    }

    /** Pauses the emulator, so that what is shown is what is copied, until the dialog closes. */
    open() {
        if (!this.emulator.cpu || this.isOpen) return;
        this.isOpen = true;
        this.resume = this.emulator.running;
        this.emulator.pause();
        this.listViews();
        this.modal.style.display = "block";
        this.refresh();
    }

    close() {
        if (!this.isOpen) return;
        this.isOpen = false;
        this.modal.style.display = "none";
        if (this.resume) this.emulator.start();
    }

    /** Offers the machine's views, keeping the one chosen where this machine has it. */
    listViews() {
        const chosen = this.view.value;
        const views = memoryViews(this.emulator.cpu);
        this.view.replaceChildren(...views.map(({view, label}) => new Option(label, view)));
        this.view.value = views.some(({view}) => view === chosen) ? chosen : ProgramView;
    }

    refresh() {
        const {cpu} = this.emulator;
        const peek = address => cpu.peekmemAsLanguage(address);
        const names = this.watch.currentLanguage(cpu).basic ? basicNames(peek) : noNames;
        const given = {
            first: this.first.value,
            second: this.second.value,
            byLength: this.mode.value === "length",
        };
        try {
            this.range = resolveRange(given, {names, peek});
        } catch (e) {
            if (!(e instanceof ExpressionError)) throw e;
            this.range = null;
            this.showSummary(e.message, "error");
        }
        this.copyButton.disabled = !this.range;
        this.shadowNote.hidden =
            !this.range || this.view.value === ShadowView || !screenIsShadow(cpu, this.range);
        if (!this.range) {
            this.problems.replaceChildren();
            this.bytes.replaceChildren();
            this.text.textContent = "";
            return;
        }
        const {start, end} = this.range;
        const shown = {start, end: Math.min(end, start + PreviewMostBytes - 1)};
        const bytes = readRange(cpu, this.view.value, this.range);
        const problems = [];
        bytes.forEach((byte, i) => {
            if (breaksLine(byte)) problems.push(start + i);
        });
        this.describe(bytes, shown);
        this.listProblems(problems, shown);
        this.showBytes(bytes.subarray(0, shown.end - start + 1), start);
        const text = clipboardText(bytes.subarray(0, PreviewTextCharacters));
        this.text.textContent = bytes.length > PreviewTextCharacters ? `${text}...` : text;
    }

    showSummary(text, state) {
        this.summary.textContent = text;
        this.summary.dataset.state = state;
    }

    describe(bytes, shown) {
        const {start, end} = this.range;
        const counts = [0x0a, 0x0d]
            .map(problem => ({problem, count: bytes.filter(byte => byte === problem).length}))
            .filter(({count}) => count > 0);
        const range = `${plural(bytes.length, "byte")}, ${hex(start)} to ${hex(end)}`;
        const preview = shown.end < end ? ` (the first ${PreviewMostBytes} shown)` : "";
        if (!counts.length) return this.showSummary(`${range}${preview}: no &0A or &0D`, "ok");
        const listed = counts.map(({problem, count}) => `${count} x ${hex(problem, 2)}`);
        this.showSummary(
            `${range}${preview}: ${listed.join(" and ")}, which can break a program line`,
            "problem",
        );
    }

    /** A button for each byte that can break a line, which brings it into view in the bytes shown. */
    listProblems(problems, shown) {
        const buttons = problems.slice(0, ProblemsListed).map(address => {
            const button = element("button", "", hex(address));
            button.type = "button";
            button.title = "Show this byte";
            button.disabled = address > shown.end;
            button.addEventListener("click", () => this.showByte(address));
            return button;
        });
        const more = problems.length - buttons.length;
        this.problems.replaceChildren(...buttons, more > 0 ? ` and ${more} more` : "");
    }

    showByte(address) {
        for (const found of this.bytes.querySelectorAll(".found")) found.classList.remove("found");
        const cell = this.bytes.querySelector(`[data-address="${address}"]`);
        cell.classList.add("found");
        cell.scrollIntoView({block: "nearest"});
    }

    showBytes(bytes, start) {
        const perRow = window.matchMedia(Portrait).matches ? NarrowRowBytes : WideRowBytes;
        const rows = [];
        for (let offset = 0; offset < bytes.length; offset += perRow) {
            const row = element("div", "save-row", "");
            row.append(element("span", "save-address", hex(start + offset)));
            for (const [i, byte] of bytes.subarray(offset, offset + perRow).entries()) {
                const cell = element("span", "save-byte", hex(byte, 2).slice(1));
                cell.dataset.address = start + offset + i;
                if (breaksLine(byte)) cell.dataset.byte = hex(byte, 2).slice(1);
                row.append(cell);
            }
            rows.push(row);
        }
        this.bytes.replaceChildren(...rows);
    }

    async copy() {
        if (!this.range) return;
        const text = clipboardText(readRange(this.emulator.cpu, this.view.value, this.range));
        try {
            await toClipboard(text);
            this.close();
        } catch (e) {
            this.showSummary(`Could not copy to the clipboard: ${e.message}`, "error");
        }
    }
}
