// The MOS's VDU variables, which the BBC Micro and the Master both keep in main RAM.
const GraphicsWindow = 0x300;
const TextWindow = 0x308;
const GraphicsOrigin = 0x30c;
const GraphicsCursorUnits = 0x310;
const PreviousGraphicsCursor = 0x314;
const TextCursor = 0x318;
const GraphicsCursor = 0x324;
const ScreenMode = 0x355;
const VduStatus = 0xd0;
const VduStatusPrintAtGraphicsCursor = 0x20;

// The modes' character cells, and pixels across a line, 0 for a mode without graphics.
const Columns = [80, 40, 20, 80, 40, 20, 40, 40];
const Rows = [32, 32, 32, 25, 32, 32, 25, 25];
const PixelsAcross = [640, 320, 160, 0, 320, 160, 0, 0];
const PixelsDown = 256;
const UnitsAcross = 1280;
const UnitsPerPixelDown = 4;

// jsbeeb draws teletext three 1MHz characters after where the 6845's timing puts it.
const TeletextDelayPixels = 48;
const PixelsPerCharacter = {fast: 8, slow: 16};

export const Markers = [
    {key: "graphicsCursor", label: "Graphics cursor", colour: "#ff4040"},
    {key: "previous", label: "Previous point", colour: "#ffa000"},
    {key: "origin", label: "Graphics origin", colour: "#40c0ff"},
    {key: "graphicsWindow", label: "Graphics window", colour: "#40ff60"},
    {key: "textCursor", label: "Text cursor", colour: "#ff40ff"},
    {key: "textWindow", label: "Text window", colour: "#ffff40"},
];
const colour = Object.fromEntries(Markers.map(marker => [marker.key, marker.colour]));

function signed16(readmem, address) {
    const value = readmem(address) | (readmem(address + 1) << 8);
    return value & 0x8000 ? value - 0x10000 : value;
}

const points = (readmem, address, count) =>
    Array.from({length: count}, (_, i) => signed16(readmem, address + 2 * i));

/**
 * Where the VDU driver's cursors and windows are, from its variables: graphics positions in the mode's pixels from the
 * screen's bottom left (as the MOS keeps them), the origin in OS units, and text positions in character cells from the
 * top left of the screen.
 */
export function readVduState(readmem) {
    const mode = readmem(ScreenMode) & 7;
    const [left, bottom, right, top] = points(readmem, GraphicsWindow, 4);
    const [textLeft, textBottom, textRight, textTop] = [0, 1, 2, 3].map(i =>
        readmem(TextWindow + i),
    );
    const [graphicsX, graphicsY] = points(readmem, GraphicsCursor, 2);
    const [previousX, previousY] = points(readmem, PreviousGraphicsCursor, 2);
    const [originX, originY] = points(readmem, GraphicsOrigin, 2);
    const [unitsX, unitsY] = points(readmem, GraphicsCursorUnits, 2);
    return {
        mode,
        columns: Columns[mode],
        rows: Rows[mode],
        pixelsAcross: PixelsAcross[mode],
        graphicsWindow: {left, bottom, right, top},
        textWindow: {left: textLeft, bottom: textBottom, right: textRight, top: textTop},
        graphicsCursor: {x: graphicsX, y: graphicsY},
        graphicsCursorUnits: {x: unitsX, y: unitsY},
        previous: {x: previousX, y: previousY},
        origin: {x: originX, y: originY},
        textCursor: {x: readmem(TextCursor), y: readmem(TextCursor + 1)},
        printAtGraphicsCursor: !!(readmem(VduStatus) & VduStatusPrintAtGraphicsCursor),
    };
}

const isWholeTextScreen = ({textWindow, columns, rows}) =>
    textWindow.left === 0 &&
    textWindow.top === 0 &&
    textWindow.right === columns - 1 &&
    textWindow.bottom === rows - 1;

const isWholeGraphicsScreen = ({graphicsWindow, pixelsAcross}) =>
    graphicsWindow.left === 0 &&
    graphicsWindow.bottom === 0 &&
    graphicsWindow.right === pixelsAcross - 1 &&
    graphicsWindow.top === PixelsDown - 1;

/**
 * The values the overlay marks, by marker: graphics positions in OS units from the origin, as BASIC gives them (the
 * previous point only to the pixel, which is all the MOS keeps of it), the origin and the graphics window in OS units
 * from the screen's bottom left, and the text cursor and window in character cells, as VDU 31 and VDU 28 take them.
 */
export function describeVduState(state) {
    const textWindow = state.textWindow;
    const text = {
        textCursor: `${state.textCursor.x},${state.textCursor.y}${state.printAtGraphicsCursor ? " (VDU 5)" : ""}`,
        textWindow: isWholeTextScreen(state)
            ? "whole screen"
            : `${textWindow.left},${textWindow.bottom},${textWindow.right},${textWindow.top}`,
    };
    if (!state.pixelsAcross) {
        const none = `none in MODE ${state.mode}`;
        return {...text, graphicsCursor: none, previous: none, origin: none, graphicsWindow: none};
    }
    const unitsPerPixel = UnitsAcross / state.pixelsAcross;
    const {origin, previous, graphicsCursorUnits, graphicsWindow} = state;
    return {
        ...text,
        graphicsCursor: `${graphicsCursorUnits.x},${graphicsCursorUnits.y}`,
        previous: `${previous.x * unitsPerPixel - origin.x},${previous.y * UnitsPerPixelDown - origin.y}`,
        origin: `${origin.x},${origin.y}`,
        graphicsWindow: isWholeGraphicsScreen(state)
            ? "whole screen"
            : [
                  graphicsWindow.left * unitsPerPixel,
                  graphicsWindow.bottom * UnitsPerPixelDown,
                  (graphicsWindow.right + 1) * unitsPerPixel - 1,
                  (graphicsWindow.top + 1) * UnitsPerPixelDown - 1,
              ].join(","),
    };
}

/**
 * Where the 6845's displayed area lands in jsbeeb's framebuffer, worked out from its registers the way jsbeeb's video
 * moves the beam: across from the middle of the horizontal sync, down from the start of the vertical sync.
 */
export function displayedArea(video) {
    const regs = video.regs;
    const pixelsPerCharacter = video.halfClock ? PixelsPerCharacter.slow : PixelsPerCharacter.fast;
    const hsyncWidth = regs[3] & 0x0f;
    let x = (regs[0] + 1 - regs[2] - (hsyncWidth >> 1)) * pixelsPerCharacter - 8;
    if (hsyncWidth & 1) x -= 4;
    if (video.teletextMode) x += TeletextDelayPixels;
    const interlacedVideo = (regs[8] & 3) === 3;
    const linesPerRow = interlacedVideo ? (regs[9] >> 1) + 1 : regs[9] + 1;
    const y = 2 * ((regs[4] + 1 - regs[7]) * linesPerRow + (regs[5] & 0x1f));
    return {x, y, width: regs[1] * pixelsPerCharacter, height: regs[6] * linesPerRow * 2};
}

/** Draws the VDU state on a transparent canvas laid over the emulator's screen. */
export class VduOverlay {
    constructor(screen, overlay) {
        this.screen = screen;
        this.canvas = overlay;
        this.ctx = overlay.getContext("2d");
        this.shown = null;
    }

    clear() {
        this.canvas.hidden = true;
        this.shown = null;
    }

    /** `shownArea` is the part of the framebuffer the screen's canvas shows, edge to edge. */
    draw(state, area, shownArea) {
        this.canvas.hidden = false;
        const {offsetLeft, offsetTop, offsetWidth, offsetHeight} = this.screen;
        const ratio = window.devicePixelRatio || 1;
        const key = JSON.stringify([
            state,
            area,
            shownArea,
            offsetLeft,
            offsetTop,
            offsetWidth,
            offsetHeight,
            ratio,
        ]);
        if (key === this.shown) return;
        this.shown = key;
        Object.assign(this.canvas.style, {
            left: `${offsetLeft}px`,
            top: `${offsetTop}px`,
            width: `${offsetWidth}px`,
            height: `${offsetHeight}px`,
        });
        this.canvas.width = Math.round(offsetWidth * ratio);
        this.canvas.height = Math.round(offsetHeight * ratio);
        const scaleX = this.canvas.width / (shownArea.right - shownArea.left);
        const scaleY = this.canvas.height / (shownArea.bottom - shownArea.top);
        // From framebuffer pixels to the overlay's.
        const toX = fbX => (fbX - shownArea.left) * scaleX;
        const toY = fbY => (fbY - shownArea.top) * scaleY;
        const ctx = this.ctx;
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        ctx.lineWidth = Math.max(1.5, 1.5 * ratio);

        const cellWidth = area.width / state.columns;
        const cellHeight = area.height / state.rows;
        const cellRect = (left, top, right, bottom) => [
            toX(area.x + left * cellWidth),
            toY(area.y + top * cellHeight),
            toX(area.x + (right + 1) * cellWidth),
            toY(area.y + (bottom + 1) * cellHeight),
        ];
        const textWindow = state.textWindow;
        if (!isWholeTextScreen(state))
            this.rect(
                cellRect(textWindow.left, textWindow.top, textWindow.right, textWindow.bottom),
                colour.textWindow,
                [6, 3],
            );
        if (!state.printAtGraphicsCursor) {
            const {x, y} = state.textCursor;
            this.rect(cellRect(x, y, x, y), colour.textCursor, []);
        }

        if (!state.pixelsAcross) return;
        const pixelWidth = area.width / state.pixelsAcross;
        const pixelHeight = area.height / PixelsDown;
        // A pixel's left edge, and its top edge, counting pixel rows up from the bottom as the MOS does.
        const pixelX = x => toX(area.x + x * pixelWidth);
        const pixelY = y => toY(area.y + (PixelsDown - 1 - y) * pixelHeight);
        const pixelCentre = ({x, y}) => [
            pixelX(x) + (pixelX(x + 1) - pixelX(x)) / 2,
            pixelY(y) + (pixelY(y - 1) - pixelY(y)) / 2,
        ];
        const {graphicsWindow} = state;
        if (!isWholeGraphicsScreen(state))
            this.rect(
                [
                    pixelX(graphicsWindow.left),
                    pixelY(graphicsWindow.top),
                    pixelX(graphicsWindow.right + 1),
                    pixelY(graphicsWindow.bottom - 1),
                ],
                colour.graphicsWindow,
                [6, 3],
            );
        const unitsPerPixel = UnitsAcross / state.pixelsAcross;
        const originPixel = {
            x: Math.floor(state.origin.x / unitsPerPixel),
            y: Math.floor(state.origin.y / UnitsPerPixelDown),
        };
        this.axes(pixelCentre(originPixel), colour.origin, 10 * ratio);
        this.cross(pixelCentre(state.previous), colour.previous, 6 * ratio, true);
        this.cross(pixelCentre(state.graphicsCursor), colour.graphicsCursor, 8 * ratio, false);
    }

    /** Strokes the path `trace` makes in `strokeStyle` over a black edge, so it shows on any colour. */
    stroke(strokeStyle, dash, trace) {
        const ctx = this.ctx;
        const width = ctx.lineWidth;
        ctx.save();
        ctx.beginPath();
        trace(ctx);
        ctx.strokeStyle = "black";
        ctx.lineWidth = 3 * width;
        ctx.stroke();
        ctx.strokeStyle = strokeStyle;
        ctx.lineWidth = width;
        ctx.setLineDash(dash.map(length => length * width));
        ctx.stroke();
        ctx.restore();
    }

    rect([left, top, right, bottom], strokeStyle, dash) {
        const inset = this.ctx.lineWidth / 2;
        this.stroke(strokeStyle, dash, ctx =>
            ctx.rect(left + inset, top + inset, right - left - 2 * inset, bottom - top - 2 * inset),
        );
    }

    cross([x, y], strokeStyle, size, diagonal) {
        this.stroke(strokeStyle, [], ctx => {
            if (diagonal) {
                ctx.moveTo(x - size, y - size);
                ctx.lineTo(x + size, y + size);
                ctx.moveTo(x - size, y + size);
                ctx.lineTo(x + size, y - size);
            } else {
                ctx.moveTo(x - size, y);
                ctx.lineTo(x + size, y);
                ctx.moveTo(x, y - size);
                ctx.lineTo(x, y + size);
            }
        });
    }

    /** An L of the x and y axes, pointing right and up from the origin, with a ring on it. */
    axes([x, y], strokeStyle, size) {
        this.stroke(strokeStyle, [], ctx => {
            ctx.moveTo(x + 2 * size, y);
            ctx.lineTo(x, y);
            ctx.lineTo(x, y - 2 * size);
            ctx.moveTo(x + size / 3, y);
            ctx.arc(x, y, size / 3, 0, 2 * Math.PI);
        });
    }
}
