// @vitest-environment node
import {describe, expect, it} from "vitest";
import {MachineSession} from "jsbeeb/machine-session";
import {describeVduState, displayedArea, readVduState} from "../src/vdu-overlay";

const FramebufferWidth = 1024;
const FramebufferHeight = 625;
const FramesToSettle = 20;
// Each test boots a machine and runs BASIC on it, which a busy machine running the suite in parallel can make slow.
const MachineTestTimeout = 120000;

async function session(model) {
    const machine = new MachineSession(model);
    await machine.initialise();
    await machine.runUntilPrompt();
    return machine;
}

async function run(machine, lines) {
    machine.reset(true);
    await machine.runUntilPrompt();
    await machine.loadBasic(`${[...lines, "REPEAT UNTIL FALSE"].join("\n")}\n`);
    await machine.type("RUN");
    await machine.runFrames(FramesToSettle);
}

/** The smallest rectangle of the framebuffer holding everything that is not black. */
function litArea(machine) {
    const pixels = new Uint32Array(machine._completeFb8.buffer);
    let [left, top, right, bottom] = [Infinity, Infinity, -1, -1];
    for (let y = 0; y < FramebufferHeight; y++)
        for (let x = 0; x < FramebufferWidth; x++)
            if (pixels[y * FramebufferWidth + x] & 0xffffff) {
                left = Math.min(left, x);
                right = Math.max(right, x);
                top = Math.min(top, y);
                bottom = Math.max(bottom, y);
            }
    return {x: left, y: top, width: right - left + 1, height: bottom - top + 1};
}

const whiteScreen = mode => [`MODE ${mode}`, "VDU 19,0,7;0;23,1,0;0;0;0;"];
// Teletext has no palette, so each row is given a white background from its first cell.
const whiteTeletext = ["MODE 7", "VDU 23,1,0;0;0;0;", "FOR Y%=0 TO 24:?(&7C00+Y%*40)=157:NEXT"];

describe("displayedArea", () => {
    // Modes 3 and 6 leave the last two lines of each row black, so the last row's are not lit.
    const cases = [
        ...[0, 1, 2, 4, 5].map(mode => [`MODE ${mode}`, whiteScreen(mode), 0]),
        ...[3, 6].map(mode => [`MODE ${mode}`, whiteScreen(mode), 4]),
        ["MODE 7", whiteTeletext, 0],
        ["MODE 1 after *TV 3", ["*TV 3", ...whiteScreen(1)], 0],
        ["MODE 7 after *TV 254", ["*TV 254", ...whiteTeletext], 0],
        ["MODE 1 with the horizontal sync moved", [...whiteScreen(1), "VDU 23,0,2,96;0;0;0;"], 0],
        ["MODE 4 with the vertical sync moved", [...whiteScreen(4), "VDU 23,0,7,33;0;0;0;"], 0],
    ];
    for (const model of ["B-DFS1.2", "Master"]) {
        it(
            `is where ${model}'s picture is drawn`,
            async () => {
                const machine = await session(model);
                for (const [name, lines, unlitRows] of cases) {
                    await run(machine, lines);
                    const area = displayedArea(machine._video);
                    expect({name, ...litArea(machine)}).toEqual({
                        name,
                        ...area,
                        height: area.height - unlitRows,
                    });
                }
            },
            MachineTestTimeout,
        );
    }
});

describe("readVduState", () => {
    it(
        "reads the cursors, origin and windows the VDU commands set",
        async () => {
            const machine = await session("B-DFS1.2");
            await run(machine, [
                "MODE 1",
                "VDU 29,640;512;",
                "VDU 24,-400;-300;400;300;",
                "MOVE 100,50:DRAW -200,100",
                "VDU 28,5,20,30,10",
                "PRINT TAB(3,4);",
            ]);
            const state = readVduState(address => machine._machine.processor.readmem(address));
            expect(state).toMatchObject({
                mode: 1,
                graphicsWindow: {left: 60, bottom: 53, right: 260, top: 203},
                textWindow: {left: 5, bottom: 20, right: 30, top: 10},
                origin: {x: 640, y: 512},
                graphicsCursor: {x: 110, y: 153},
                graphicsCursorUnits: {x: -200, y: 100},
                previous: {x: 185, y: 140},
                textCursor: {x: 8, y: 14},
            });
            expect(describeVduState(state)).toEqual({
                graphicsCursor: "-200,100",
                previous: "100,48",
                origin: "640,512",
                graphicsWindow: "240,212,1043,815",
                textCursor: "8,14",
                textWindow: "5,20,30,10",
            });
        },
        MachineTestTimeout,
    );
});
