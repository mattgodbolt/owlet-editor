// The "Save memory" dialog: the range to copy is given as BASIC expressions, and the bytes and the text that would be
// copied are shown beside the count of those a BASIC line cannot hold.
import {PagedView, peekViewed} from "jsbeeb/src/paging";
import {BasicWatch} from "./basic-watch";
import {evaluate, ExpressionError} from "./memory-expression";
import {basicNames} from "./memory-names";
import {memoryText} from "./memory-text";

const PreviewBytes = 64;
const PreviewTextCharacters = 120;
const AddressSpace = 0x10000;
const LineFeed = 0x0a;
const CarriageReturn = 0x0d;
const Context = 8;

const hex = (value, digits) => value.toString(16).toUpperCase().padStart(digits, "0");
const byId = id => document.getElementById(id);

export class SaveMemory {
    constructor(emulator) {
        this.emulator = emulator;
        this.watch = new BasicWatch();
        this.first = byId("saveStartAddr");
        this.mode = byId("saveMode");
        this.second = byId("saveLen");
        this.summary = byId("saveSummary");
        this.problems = byId("saveProblems");
        this.bytes = byId("savePreview");
        this.text = byId("saveText");
        this.copyButton = byId("saveCopy");
        this.previewStart = 0;
        for (const input of [this.first, this.mode, this.second])
            input.addEventListener("input", () => {
                this.previewStart = null;
                this.refresh();
            });
    }

    /** Opens with the BASIC program as the range, as the dialog always did. */
    open() {
        this.first.value = "PAGE";
        this.mode.value = "end";
        this.second.value = "TOP-1";
        this.previewStart = null;
        this.refresh();
    }

    peek(address) {
        return peekViewed(this.emulator.cpu, PagedView, address);
    }

    resolve() {
        const {cpu} = this.emulator;
        const peek = address => cpu.peekmemAsLanguage(address);
        const names = this.watch.currentLanguage(cpu).basic ? basicNames(peek) : () => undefined;
        const context = {names, peek: address => this.peek(address)};
        const start = evaluate(this.first.value, context);
        const second = evaluate(this.second.value, context);
        const end = this.mode.value === "end" ? second : start + second - 1;
        if (start < 0 || end >= AddressSpace)
            throw new ExpressionError("The range is not inside &0000 to &FFFF");
        if (end < start) throw new ExpressionError("The range is empty or backwards");
        return {start, end};
    }

    refresh() {
        let range = null;
        try {
            range = this.resolve();
        } catch (e) {
            if (!(e instanceof ExpressionError)) throw e;
            this.summary.textContent = e.message;
            this.summary.dataset.state = "error";
        }
        this.range = range;
        this.copyButton.disabled = !range;
        this.bytes.replaceChildren();
        this.problems.replaceChildren();
        this.text.textContent = "";
        if (!range) return;
        const {start, end} = range;
        const data = Uint8Array.from({length: end - start + 1}, (_, i) => this.peek(start + i));
        const {text, counts} = memoryText(data);
        const bad = [];
        data.forEach((b, i) => {
            if (b === LineFeed || b === CarriageReturn) bad.push(start + i);
        });
        this.summary.dataset.state = bad.length ? "problem" : "ok";
        this.summary.textContent = `${data.length} bytes, &${hex(start, 4)} to &${hex(end, 4)}${
            bad.length
                ? `: ${[...counts]
                      .filter(([b]) => b === LineFeed || b === CarriageReturn)
                      .map(([b, n]) => `${n} x &${hex(b, 2)}`)
                      .join(", ")} would break a program line`
                : ": nothing that breaks a program line"
        }`;
        this.listProblems(bad);
        this.showBytes(data, start, bad);
        const shown = [...text].slice(0, PreviewTextCharacters).join("");
        this.text.textContent = text.length > shown.length ? `${shown}...` : shown;
    }

    /** One button per problem byte, each showing the bytes around it. */
    listProblems(bad) {
        for (const address of bad.slice(0, 12)) {
            const button = document.createElement("button");
            button.type = "button";
            button.textContent = `&${hex(address, 4)}`;
            button.title = "Show the bytes around this one";
            button.addEventListener("click", () => {
                this.previewStart = Math.max(this.range.start, address - Context);
                this.refresh();
            });
            this.problems.append(button);
        }
        if (bad.length > 12) this.problems.append(` and ${bad.length - 12} more`);
    }

    showBytes(data, start, bad) {
        const from = this.previewStart ?? start;
        const offset = from - start;
        const cells = [];
        for (let i = offset; i < Math.min(data.length, offset + PreviewBytes); ++i) {
            const cell = document.createElement("span");
            cell.textContent = hex(data[i], 2);
            if (data[i] === LineFeed) cell.className = "lf";
            if (data[i] === CarriageReturn) cell.className = "cr";
            cell.title = `&${hex(start + i, 4)}`;
            cells.push(cell);
        }
        this.bytes.dataset.from = `&${hex(from, 4)}`;
        this.bytes.replaceChildren(...cells);
        void bad;
    }

    async copy() {
        if (!this.range) return false;
        const {start, end} = this.range;
        const data = Uint8Array.from({length: end - start + 1}, (_, i) => this.peek(start + i));
        try {
            await navigator.clipboard.writeText(memoryText(data).text);
            return true;
        } catch (e) {
            this.summary.textContent = `Could not copy: ${e.message}`;
            return false;
        }
    }
}
