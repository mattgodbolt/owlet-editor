import {
    AsciiChars,
    PlotColumns,
    PlotExtendedGroups,
    PlotGroups,
    TeletextCodes,
    VduCodes,
    decodePlot,
    hex,
} from "./vdu-data";

const Tabs = [
    {id: "vdu", label: "VDU"},
    {id: "ascii", label: "ASCII"},
    {id: "mode7", label: "MODE 7"},
    {id: "plot", label: "PLOT"},
];

const GroupSize = PlotColumns.length;

/** The number a search means, as decimal or BBC BASIC hex (&41), or null if it is not one. */
export function parseNumber(query) {
    const text = query.trim();
    if (/^\d+$/.test(text)) return Number(text);
    if (/^&[0-9a-f]+$/i.test(text)) return parseInt(text.slice(1), 16);
    return null;
}

function matches(query, ...fields) {
    const lower = query.trim().toLowerCase();
    return lower === "" || fields.some(field => String(field).toLowerCase().includes(lower));
}

// A code is found by its decimal or hex (&41) value, or by its text.
function matchesCode(query, code, ...text) {
    const number = parseNumber(query);
    return number === null ? matches(query, ...text) : number === code;
}

function el(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
}

function codeColumn(code) {
    const column = el("span", "vdu-num", code);
    column.append(el("span", "vdu-hex", hex(code)));
    return column;
}

function vduRows(query) {
    return VduCodes.filter(c =>
        matchesCode(query, c.code, c.syntax, c.name, c.example?.join(" ") ?? ""),
    ).map(c => {
        const row = el("div", "vdu-row");
        const text = el("div", "vdu-text");
        text.append(el("code", "vdu-syntax", c.syntax), el("span", "vdu-name", c.name));
        if (c.example) {
            const example = el("span", "vdu-example", "e.g. ");
            example.append(el("code", "", c.example[0]), ` ${c.example[1]}`);
            text.append(example);
        }
        row.append(codeColumn(c.code), text);
        return row;
    });
}

function charRow(code, label, name) {
    const row = el("div", "vdu-row");
    const text = el("div", "vdu-text vdu-line");
    if (label !== null) text.append(el("span", "vdu-char", label));
    text.append(el("code", "vdu-syntax", `CHR$(${code})`));
    if (name) text.append(el("span", "vdu-name", name));
    row.append(codeColumn(code), text);
    return row;
}

function asciiRows(query) {
    const typed = query.trim().toLowerCase();
    return AsciiChars.filter(
        c => matchesCode(query, c.code, "") || typed === c.char.toLowerCase(),
    ).map(c => charRow(c.code, c.char, ""));
}

function teletextRows(query) {
    return TeletextCodes.filter(c => matchesCode(query, c.code, c.name, "teletext mode 7")).map(c =>
        charRow(c.code, null, c.name),
    );
}

export function describePlot(k) {
    const decoded = decodePlot(k);
    if (!decoded) return null;
    if (!decoded.column) {
        return `PLOT ${k} = ${decoded.group} (GXR / Master; the columns are not labelled here)`;
    }
    const column = decoded.column.endsWith("move")
        ? `${decoded.column} (nothing is drawn)`
        : decoded.column;
    return `PLOT ${k} = ${decoded.group}, ${column}`;
}

function plotGroupRow(group, extended, highlight) {
    const row = el("div", "plot-group");
    const title = el("div", "plot-title");
    title.append(
        el("span", "vdu-num", `${group.base}-${group.base + GroupSize - 1}`),
        el("span", "vdu-name", group.name),
    );
    if (extended) title.append(el("span", "vdu-hint", "GXR / Master"));
    row.append(title);
    const cells = el("div", "plot-cells");
    for (const column of PlotColumns) {
        const k = group.base + column.offset;
        const cell = el("span", k === highlight ? "plot-cell match" : "plot-cell", k);
        cell.title = extended
            ? `PLOT ${k}: ${group.name}`
            : `PLOT ${k}: ${group.name}, ${column.position}, ${column.action}`;
        cells.append(cell);
    }
    row.append(cells);
    return row;
}

function plotRows(query) {
    const number = parseNumber(query);
    const decoded = number === null ? null : describePlot(number);
    const hasNumber = group =>
        number !== null && number >= group.base && number < group.base + GroupSize;
    const columnText = column => `${column.position} ${column.action}`;
    const wanted = group =>
        matches(query, group.name) ||
        hasNumber(group) ||
        PlotColumns.some(column => matches(query, columnText(column)));
    const wantedExtended = group => matches(query, group.name) || hasNumber(group);
    const rows = [
        ...PlotGroups.filter(wanted).map(g => plotGroupRow(g, false, number)),
        ...PlotExtendedGroups.filter(wantedExtended).map(g => plotGroupRow(g, true, number)),
    ];
    if (!rows.length) return [];
    const intro = [];
    if (decoded)
        intro.push(
            el("div", "plot-decode", decoded),
            el("div", "vdu-hint", `Use it as PLOT ${number},x,y`),
        );
    intro.push(
        el(
            "div",
            "vdu-hint",
            "Codes 0-127: +0 to +3 are relative (move, foreground, inverse, background colour), +4 to +7 the same but absolute. 128 and up (GXR / Master): see its manual for the columns.",
        ),
    );
    return [...intro, ...rows];
}

const Sections = {
    vdu: {
        title: "VDU control codes",
        note: "A name followed by ; is a 16-bit value sent as two bytes (low, then high): VDU 25,4,640;512; moves to 640,512.",
        rows: vduRows,
    },
    ascii: {
        title: "ASCII 32-126, decimal and hex",
        note: "Search by number, &hex or the character.",
        rows: asciiRows,
    },
    mode7: {
        title: "MODE 7 teletext control codes",
        note: "Print them with CHR$ or VDU in MODE 7.",
        rows: teletextRows,
    },
    plot: {title: "PLOT k,x,y codes", rows: plotRows},
};

/**
 * Builds the reference panel in `container`: tabs for the VDU codes, ASCII, MODE 7 and PLOT, and a search that looks in
 * all of them.
 */
export function createVduReference(container) {
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
    search.placeholder = "Search number, &hex or name";
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
            const rows = section.rows(query);
            if (!rows.length) continue;
            body.append(el("h4", "vdu-heading", section.title));
            if (section.note && !searching) body.append(el("div", "vdu-hint", section.note));
            body.append(...rows);
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
    render();
}
