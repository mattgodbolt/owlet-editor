import {Selection} from "monaco-editor/esm/vs/editor/editor.api";
import {
    AsciiChars,
    PlotColumns,
    PlotExtendedGroups,
    PlotGroups,
    TeletextCodes,
    VduCodes,
} from "./vdu-data";

const InsertSource = "vdu-reference";

export function vduInsertText({code, params}) {
    return params ? `VDU ${code},` : `VDU ${code}`;
}

export const charInsertText = ({code}) => `CHR$(${code})`;

export const plotInsertText = k => `PLOT ${k},`;

// The cursor ends up after the inserted text, and each click is its own undo step.
export function insertAtCursor(editor, text) {
    editor.pushUndoStop();
    editor.executeEdits(
        InsertSource,
        editor.getSelections().map(range => ({range, text, forceMoveMarkers: true})),
        inverseOps => inverseOps.map(op => Selection.fromPositions(op.range.getEndPosition())),
    );
    editor.pushUndoStop();
    editor.focus();
}

const Tabs = [
    {id: "vdu", label: "VDU"},
    {id: "ascii", label: "ASCII"},
    {id: "mode7", label: "MODE 7"},
    {id: "plot", label: "PLOT"},
];

const plotGroupHasNumber = (group, number) =>
    number >= group.base && number < group.base + PlotColumns.length;

function matches(query, ...fields) {
    const lower = query.trim().toLowerCase();
    return lower === "" || fields.some(field => String(field).toLowerCase().includes(lower));
}

function el(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
}

function entry(insert, columns) {
    const button = el("button", "vdu-entry");
    button.type = "button";
    button.dataset.insert = insert;
    button.title = `Insert ${insert}`;
    for (const [className, text] of columns) button.append(el("span", className, text));
    return button;
}

function vduEntries(query) {
    return VduCodes.filter(c => matches(query, c.code, c.name, c.args ?? "", `vdu ${c.code}`)).map(
        c =>
            entry(vduInsertText(c), [
                ["vdu-num", c.code],
                ["vdu-name", c.name],
                ["vdu-args", c.params ? `${c.params}: ${c.args}` : "no params"],
            ]),
    );
}

function asciiEntries(query) {
    return AsciiChars.filter(c => matches(query, c.code, c.char, `chr$ ${c.code}`)).map(c =>
        entry(charInsertText(c), [
            ["vdu-num", c.code],
            ["vdu-char", c.char],
            ["vdu-name", charInsertText(c)],
        ]),
    );
}

function teletextEntries(query) {
    return TeletextCodes.filter(c => matches(query, c.code, c.name, "teletext mode 7")).map(c =>
        entry(charInsertText(c), [
            ["vdu-num", c.code],
            ["vdu-name", c.name],
            ["vdu-args", charInsertText(c)],
        ]),
    );
}

function plotGroupRow(group, extended) {
    const row = el("div", "plot-group");
    const title = el("div", "plot-title");
    title.append(
        el("span", "vdu-num", `${group.base}-${group.base + PlotColumns.length - 1}`),
        el("span", "vdu-name", group.name),
    );
    if (extended) title.append(el("span", "vdu-args", "GXR / Master"));
    row.append(title);
    const cells = el("div", "plot-cells");
    for (const column of PlotColumns) {
        const k = group.base + column.offset;
        const cell = entry(plotInsertText(k), [["vdu-num", k]]);
        cell.title = extended
            ? `PLOT ${k}: ${group.name}`
            : `PLOT ${k}: ${group.name}, ${column.name.toLowerCase()}`;
        cells.append(cell);
    }
    row.append(cells);
    return row;
}

function plotEntries(query) {
    const number = Number(query);
    const hasNumber = group =>
        query.trim() !== "" && Number.isInteger(number) && plotGroupHasNumber(group, number);
    const wanted = group =>
        matches(query, group.name) ||
        hasNumber(group) ||
        PlotColumns.some(column => matches(query, column.name));
    const wantedExtended = group => matches(query, group.name) || hasNumber(group);
    const header = el("div", "plot-legend");
    header.append(
        el(
            "span",
            "",
            "Codes 0-127: +0 to +3 relative (move, fg, inverse, bg), +4 to +7 the same, absolute. 128 and up (GXR / Master): see its manual for the columns.",
        ),
    );
    const rows = [
        ...PlotGroups.filter(wanted).map(g => plotGroupRow(g, false)),
        ...PlotExtendedGroups.filter(wantedExtended).map(g => plotGroupRow(g, true)),
    ];
    return rows.length ? [header, ...rows] : [];
}

const Sections = {
    vdu: {title: "VDU control codes: VDU n, ... (bytes after the code)", entries: vduEntries},
    ascii: {title: "ASCII 32-126 (as CHR$)", entries: asciiEntries},
    mode7: {title: "MODE 7 teletext control codes (as CHR$)", entries: teletextEntries},
    plot: {title: "PLOT k,x,y codes", entries: plotEntries},
};

/**
 * Builds the reference panel in `container`; `onInsert(text)` is called with the text for a clicked entry.
 */
export function createVduReference(container, onInsert) {
    let activeTab = "vdu";
    let query = "";

    const root = el("div", "vdu-ref");
    const bar = el("div", "vdu-bar");
    const tabButtons = new Map();
    for (const tab of Tabs) {
        const button = el("button", "vdu-tab", tab.label);
        button.type = "button";
        button.dataset.tab = tab.id;
        tabButtons.set(tab.id, button);
        bar.append(button);
    }
    const search = el("input", "vdu-search");
    search.type = "search";
    search.placeholder = "Search code or name";
    search.setAttribute("aria-label", "Search VDU, ASCII, MODE 7 and PLOT codes");
    bar.append(search);
    const body = el("div", "vdu-body");
    root.append(bar, body);
    container.append(root);

    function render() {
        body.replaceChildren();
        const searching = query.trim() !== "";
        for (const tab of Tabs) {
            tabButtons.get(tab.id).classList.toggle("active", !searching && tab.id === activeTab);
            if (!searching && tab.id !== activeTab) continue;
            const section = Sections[tab.id];
            const items = section.entries(query);
            if (!items.length) continue;
            body.append(el("h4", "vdu-heading", section.title), ...items);
        }
        if (!body.children.length) body.append(el("p", "vdu-empty", "No matching codes"));
        body.scrollTop = 0;
    }

    bar.addEventListener("click", event => {
        const tab = event.target.closest("[data-tab]");
        if (!tab) return;
        activeTab = tab.dataset.tab;
        search.value = query = "";
        render();
    });
    search.addEventListener("input", () => {
        query = search.value;
        render();
    });
    // Keep the caret in the editor: pressing an entry must not take focus away from it.
    body.addEventListener("mousedown", event => event.preventDefault());
    body.addEventListener("click", event => {
        const target = event.target.closest("[data-insert]");
        if (target) onInsert(target.dataset.insert);
    });
    render();
}
