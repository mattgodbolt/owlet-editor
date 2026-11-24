// A browser for the emulated machine's memory in the debugger's panel: a hex dump with the bytes a BASIC line cannot
// hold marked, and the range to copy named by BASIC expressions.
import {
    AndyView,
    bankName,
    MainView,
    PagedView,
    peekViewed,
    ShadowView,
    viewedBank,
    viewsFor,
} from "jsbeeb/src/paging";
import {evaluate, ExpressionError} from "./memory-expression";
import {basicNames} from "./memory-names";
import {memoryText} from "./memory-text";

const RowCount = 12;
const WideRowBytes = 16;
const NarrowRowBytes = 8;
const WideRowWidth = 560;
const AddressSpace = 0x10000;
const LineFeed = 0x0a;
const CarriageReturn = 0x0d;
const ViewLabels = {
    [PagedView]: "as the CPU sees it",
    [AndyView]: "ANDY",
    [MainView]: "main RAM",
    [ShadowView]: "shadow RAM",
};

const hex = (value, digits) => value.toString(16).toUpperCase().padStart(digits, "0");
const viewLabel = view =>
    viewedBank(view) === undefined
        ? ViewLabels[view]
        : `sideways bank ${bankName(viewedBank(view))}`;

function element(tag, className, text = "") {
    const node = document.createElement(tag);
    node.className = className;
    node.textContent = text;
    return node;
}

function field(label, value, className) {
    const input = element("input", `mem-field ${className}`);
    input.value = value;
    input.spellcheck = false;
    input.autocomplete = "off";
    input.setAttribute("aria-label", label);
    return input;
}

export class MemoryPanel {
    constructor(root) {
        this.root = root;
        this.cpu = null;
        this.basic = false;
        this.view = PagedView;
        this.scrolled = 0;
        this.perRow = WideRowBytes;
        this.range = null;
        this.problems = [];
        this.build();
        new ResizeObserver(() => this.fit()).observe(root);
    }

    build() {
        this.from = field("First address to copy", "D%", "mem-from");
        this.mode = element("select", "mem-mode");
        this.mode.setAttribute(
            "aria-label",
            "Whether the second box is the last address or a length",
        );
        for (const [value, label] of [
            ["end", "to"],
            ["length", "length"],
        ])
            this.mode.append(new Option(label, value));
        this.to = field("Last address, or length", "P%-1", "mem-to");
        this.views = element("select", "mem-view");
        this.views.setAttribute("aria-label", "Which memory to show");
        this.views.hidden = true;
        this.copyButton = element("button", "mem-copy", "Copy");
        this.copyButton.title =
            "Copy the range to the clipboard as text, to paste into a REM or DATA line";
        this.saveButton = element("button", "mem-save", "Save .bin");
        this.saveButton.title = "Download the range as a file";
        this.firstProblem = element("button", "mem-problem", "next problem");
        this.firstProblem.title = "Scroll to the next &0A or &0D in the range";
        const controls = element("div", "mem-controls");
        controls.append(
            element("span", "mem-label", "Copy"),
            this.from,
            this.mode,
            this.to,
            this.copyButton,
            this.saveButton,
            this.views,
        );
        this.summary = element("div", "mem-summary");
        this.error = element("div", "mem-error");
        this.dump = element("div", "mem-dump");
        this.dump.tabIndex = 0;
        this.rows = Array.from({length: RowCount}, () => element("div", "mem-row"));
        this.dump.append(...this.rows);
        this.root.append(controls, this.summary, this.error, this.dump);
        this.summary.after(this.firstProblem);

        for (const input of [this.from, this.to, this.mode])
            input.addEventListener("input", () => {
                this.scrolled = 0;
                this.refresh();
            });
        this.views.addEventListener("change", () => {
            this.view = this.views.value;
            this.refresh();
        });
        this.dump.addEventListener("wheel", event => {
            this.scroll(Math.sign(event.deltaY));
            event.preventDefault();
        });
        this.dump.addEventListener("keydown", event => {
            const step = {ArrowDown: 1, ArrowUp: -1, PageDown: RowCount, PageUp: -RowCount}[
                event.key
            ];
            if (!step) return;
            this.scroll(step);
            event.preventDefault();
        });
        this.copyButton.addEventListener("click", () => this.copy());
        this.saveButton.addEventListener("click", () => this.save());
        this.firstProblem.addEventListener("click", () => this.jumpToProblem());
    }

    fit() {
        const width = this.root.clientWidth;
        if (!width) return;
        this.perRow = width >= WideRowWidth ? WideRowBytes : NarrowRowBytes;
        this.root.dataset.perRow = String(this.perRow);
        this.refresh();
    }

    scroll(rows) {
        this.scrolled += rows;
        this.refresh();
    }

    /** Called each frame while the panel is showing, with the machine and whether BASIC is the language. */
    update(cpu, basic) {
        if (cpu !== this.cpu) this.useMachine(cpu);
        this.basic = basic;
        this.refresh();
    }

    useMachine(cpu) {
        this.cpu = cpu;
        this.view = PagedView;
        const views = viewsFor(cpu.model);
        this.views.replaceChildren(...views.map(view => new Option(viewLabel(view), view)));
        this.views.hidden = views.length === 1;
    }

    peek(address) {
        return peekViewed(this.cpu, this.view, address & 0xffff);
    }

    /** The first and last addresses the two boxes name, or an error message. */
    resolveRange() {
        const names = this.basic
            ? basicNames(address => this.cpu.peekmemAsLanguage(address))
            : () => undefined;
        const context = {names, peek: address => this.peek(address)};
        const start = evaluate(this.from.value, context);
        const second = evaluate(this.to.value, context);
        const end = this.mode.value === "end" ? second : start + second - 1;
        if (start < 0 || start >= AddressSpace)
            throw new ExpressionError("The first address is not in memory");
        if (end >= AddressSpace) throw new ExpressionError("The range runs past &FFFF");
        return {start, end};
    }

    refresh() {
        if (!this.cpu) return;
        let message = "";
        this.range = null;
        try {
            this.range = this.resolveRange();
        } catch (e) {
            if (!(e instanceof ExpressionError)) throw e;
            message = e.message;
        }
        const {range} = this;
        if (range && range.end < range.start) {
            message = `The range is ${range.start - range.end - 1} bytes backwards`;
            this.range = null;
        }
        this.error.textContent = message;
        this.error.hidden = !message;
        this.showSummary();
        this.showDump();
        for (const button of [this.copyButton, this.saveButton]) button.disabled = !this.range;
    }

    rangeBytes() {
        const {start, end} = this.range;
        return Uint8Array.from({length: end - start + 1}, (_, i) => this.peek(start + i));
    }

    showSummary() {
        this.problems = [];
        if (!this.range) {
            this.summary.textContent = "";
            this.firstProblem.hidden = true;
            return;
        }
        const {start, end} = this.range;
        const bytes = this.rangeBytes();
        const counts = new Map();
        bytes.forEach((b, i) => {
            if (b !== LineFeed && b !== CarriageReturn) return;
            counts.set(b, (counts.get(b) ?? 0) + 1);
            this.problems.push(start + i);
        });
        const size = `${bytes.length} ${bytes.length === 1 ? "byte" : "bytes"}, &${hex(start, 4)} to &${hex(end, 4)}`;
        const marked = [LineFeed, CarriageReturn]
            .filter(b => counts.has(b))
            .map(b => `${counts.get(b)} x &${hex(b, 2)}`);
        this.summary.textContent = marked.length
            ? `${size}; problem bytes: ${marked.join(", ")}`
            : `${size}; no problem bytes`;
        this.summary.dataset.problems = marked.length ? "yes" : "no";
        this.firstProblem.hidden = !marked.length;
    }

    jumpToProblem() {
        if (!this.problems.length) return;
        const shownEnd = this.firstRowAddress() + RowCount * this.perRow;
        const next = this.problems.find(address => address >= shownEnd) ?? this.problems[0];
        this.scrolled += Math.floor((next - this.firstRowAddress()) / this.perRow) - 1;
        this.refresh();
    }

    firstRowAddress() {
        const anchor = this.range ? this.range.start : 0;
        const first = anchor - (anchor % this.perRow) + this.scrolled * this.perRow;
        return Math.max(0, Math.min(first, AddressSpace - RowCount * this.perRow));
    }

    showDump() {
        const first = this.firstRowAddress();
        const {range} = this;
        this.rows.forEach((row, r) => {
            const base = first + r * this.perRow;
            const cells = [element("span", "mem-addr", hex(base, 4))];
            const text = element("span", "mem-text");
            for (let i = 0; i < this.perRow; ++i) {
                const address = base + i;
                const b = this.peek(address);
                const cell = element("span", "mem-byte", hex(b, 2));
                const character = element(
                    "span",
                    "",
                    b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ".",
                );
                for (const node of [cell, character]) {
                    if (range && address >= range.start && address <= range.end)
                        node.classList.add("in-range");
                    if (b === LineFeed) node.classList.add("lf");
                    if (b === CarriageReturn) node.classList.add("cr");
                    if (b === 0) node.classList.add("zero");
                }
                cell.title = `&${hex(address, 4)} = ${b} (&${hex(b, 2)})`;
                cells.push(cell);
                text.append(character);
            }
            row.replaceChildren(...cells, text);
        });
    }

    async copy() {
        if (!this.range) return;
        const {text} = memoryText(this.rangeBytes());
        try {
            await navigator.clipboard.writeText(text);
            this.error.textContent = "";
            this.summary.dataset.copied = "yes";
            setTimeout(() => delete this.summary.dataset.copied, 1500);
        } catch (e) {
            this.error.textContent = `Could not copy: ${e.message}`;
            this.error.hidden = false;
        }
    }

    save() {
        if (!this.range) return;
        const {start, end} = this.range;
        const link = document.createElement("a");
        link.href = URL.createObjectURL(new Blob([this.rangeBytes()]));
        link.download = `memory-${hex(start, 4)}-${hex(end, 4)}.bin`;
        link.click();
        URL.revokeObjectURL(link.href);
    }
}
