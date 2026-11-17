import {expect, test} from "@playwright/test";

// A FOR loop that assigns variables and calls a PROC, so that the running statement alternates between lines 30 and 60.
const Program = [
    "10 MODE 7",
    "20 FOR I%=1 TO 1000000",
    '30 X=I%*2:Y$="N"+STR$(X):PROCshow',
    "40 NEXT",
    "50 END",
    '60 DEF PROCshow:PRINT TAB(0,0);I%;" ";Y$:ENDPROC',
].join("\n");
const Statement30 = 'Y$="N"+STR$(X)';
const Statement60 = 'PRINT TAB(0,0);I%;" ";Y$';
// X% is only ever written to the value BASIC starts it with; Z% is never written.
const ResidentProgram = ["10 X%=1:X%=0", "20 Y%=5", "30 PRINT Z%", "40 END"].join("\n");
const ErrorProgram = 'A=1:B$="X"\nPRINT 1/0';
// Stops with an error while drawing in black, which is the colour BASIC then prints its message in, after VDU 5.
const HiddenErrorProgram = [
    "MODE 1",
    "VDU 5",
    "FOR N%=1 TO 12",
    "  GCOL 0,1+N% MOD 3",
    "  MOVE 640,0:DRAW N%*100,FNheight(N%)",
    "  GCOL 0,0",
    "  MOVE 640,0:DRAW N%*100+50,FNheight(N%+0.5)",
    "NEXT",
    "END",
    "DEF FNheight(n)=200+3000/(9.5-n)",
].join("\n");
const HiddenErrorStatus =
    "Division by zero (ERR 18) at line 100. The variables are as the program left them.";
// Stops with an error the first time it runs, and ends at once the next.
const OnceErrorProgram = ["IF A%=0 THEN A%=1:PRINT 1/0", "END"].join("\n");
// Waits a second before it stops with an error, so that a run can be seen before it.
const SlowErrorProgram = ["10 T%=TIME:REPEAT UNTIL TIME>T%+100", "20 X=1:PRINT 1/0:Y=2"].join("\n");
const KeyProgram = ["10 G=GET", "20 INPUT X", "30 END"].join("\n");
// Reads the keyboard many times a frame without waiting for it.
const PollingProgram = "10 REPEAT:K=INKEY(0):UNTIL FALSE";
const VsyncProgram = ["10 REPEAT", "20 *FX19", "30 UNTIL FALSE"].join("\n");

const Machines = [
    {name: "Model B", state: {}},
    {name: "Master 128", state: {model: "Master"}},
];

const link = (program, state) =>
    `/#${encodeURIComponent(JSON.stringify({v: 1, program, ...state}))}`;

/** Opens the built page on a program, and fails the test on any page error or console error. */
async function open(page, baseURL, program, state) {
    const problems = [];
    page.on("pageerror", error => problems.push(`page error: ${error.message}`));
    page.on("console", message => {
        if (message.type() === "error") problems.push(`console error: ${message.text()}`);
    });
    // Nothing outside the page's own origin (analytics, example thumbnails) is needed, or wanted.
    await page.route(
        url => url.origin !== new URL(baseURL).origin,
        route => route.fulfill({status: 204, body: ""}),
    );
    await page.goto(link(program, state));
    await expect(debugButton(page)).toBeVisible();
    return problems;
}

const debugButton = page => page.getByRole("button", {name: "Debug BASIC"});
const panel = page => page.locator("#debugger");
const status = page => panel(page).locator(".debug-status");
const screenHeight = page =>
    page.locator("#screen").evaluate(canvas => canvas.getBoundingClientRect().height);
const editorLine = (page, number) =>
    page.locator(".monaco-editor .view-line").filter({hasText: new RegExp(`^\\s*${number}\\s`)});

/** The panel's variables by name, as shown. */
const variables = page =>
    page
        .locator("#debugger .debug-variable")
        .evaluateAll(items =>
            Object.fromEntries(
                items.map(item => [
                    item.querySelector(".debug-name").textContent,
                    item.querySelector(".debug-value").textContent,
                ]),
            ),
        );

/**
 * The text of the editor line under the running-statement mark, which Monaco draws as an empty box behind the text, so
 * the text is whatever characters lie within the box; empty when nothing is marked.
 */
const readMarkedText = (mark = "running") => {
    const marks = [...document.querySelectorAll(`.debug-${mark}-statement`)];
    if (!marks.length) return "";
    const boxes = marks.map(mark => mark.getBoundingClientRect());
    const left = Math.min(...boxes.map(box => box.left));
    const right = Math.max(...boxes.map(box => box.right));
    const {top, bottom} = boxes[0];
    const middle = (top + bottom) / 2;
    const line = [...document.querySelectorAll(".monaco-editor .view-line")].find(candidate => {
        const rect = candidate.getBoundingClientRect();
        return rect.top <= middle && middle <= rect.bottom;
    });
    if (!line) return "";
    let text = "";
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        for (let i = 0; i < node.length; ++i) {
            const range = document.createRange();
            range.setStart(node, i);
            range.setEnd(node, i + 1);
            const rect = range.getBoundingClientRect();
            const centre = (rect.left + rect.right) / 2;
            if (centre >= left && centre <= right) text += node.data[i];
        }
    }
    return text.replaceAll("\u00a0", " ").trim();
};

const markedText = (page, mark) => page.evaluate(readMarkedText, mark);

/** Starts noting, on every animation frame, each status and marked text the page shows. */
const recordEveryFrame = page =>
    page.evaluate(source => {
        const readMarkedText = new Function(`return (${source})`)();
        const seen = {statuses: new Set(), marks: new Set()};
        window.recorded = seen;
        const tick = () => {
            seen.statuses.add(document.querySelector("#debugger .debug-status").textContent);
            seen.marks.add(readMarkedText());
            requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    }, readMarkedText.toString());

const recorded = page =>
    page.evaluate(() => ({
        statuses: [...window.recorded.statuses],
        marks: [...window.recorded.marks],
    }));

const markedLines = (page, mark = "running") => page.locator(`.debug-${mark}-line`).count();

const runningLine = async page => {
    const match = /^Running line (\d+)$/.exec(await status(page).textContent());
    return match ? Number(match[1]) : null;
};

/** Presses each of `keys` at the emulator, holding it down long enough for the OS to see it. */
async function typeAtEmulator(page, keys) {
    await page.locator("#screen").click();
    for (const key of keys) await page.keyboard.press(key, {delay: 100});
}

/** Lets the emulator get through a good number of animation frames, to show that something has not changed. */
const settle = page =>
    page.evaluate(
        () =>
            new Promise(resolve => {
                let frames = 0;
                const tick = () => (++frames < 40 ? requestAnimationFrame(tick) : resolve());
                requestAnimationFrame(tick);
            }),
    );

const pause = async page => {
    await page.locator("#play-pause").click();
    await settle(page);
};

for (const {name, state} of Machines) {
    test.describe(name, () => {
        test("the Debug button is named, and opens the panel and shrinks the screen", async ({
            page,
            baseURL,
        }) => {
            const problems = await open(page, baseURL, Program, state);
            const button = debugButton(page);
            await expect(button).toHaveAttribute("aria-pressed", "false");
            await expect(panel(page)).toBeHidden();
            // The page has to have laid out before the height means anything.
            await expect.poll(() => screenHeight(page)).toBeGreaterThan(300);
            const full = await screenHeight(page);

            await button.click();

            await expect(button).toHaveAttribute("aria-pressed", "true");
            await expect(panel(page)).toBeVisible();
            await expect.poll(() => screenHeight(page)).toBeLessThan(full);
            expect(problems).toEqual([]);
        });

        test("the variables update while the program runs", async ({page, baseURL}) => {
            const problems = await open(page, baseURL, Program, state);
            await debugButton(page).click();
            await expect.poll(async () => (await variables(page))["I%"]).toBeDefined();
            const first = await variables(page);
            await expect.poll(async () => (await variables(page))["I%"]).not.toBe(first["I%"]);
            const second = await variables(page);
            expect(Number(second["I%"])).toBeGreaterThan(Number(first["I%"]));
            expect(second.X).toMatch(/^\d+$/);
            expect(second["Y$"]).toMatch(/^"N\d+"$/);
            await expect(panel(page).locator(".debug-routines")).toHaveText("PROCshow");
            expect(problems).toEqual([]);
        });

        test("the marked statement moves between the lines the program runs", async ({
            page,
            baseURL,
        }) => {
            const problems = await open(page, baseURL, Program, state);
            await debugButton(page).click();
            await recordEveryFrame(page);
            await expect
                .poll(async () => (await recorded(page)).statuses)
                .toEqual(expect.arrayContaining(["Running line 30", "Running line 60"]));
            await expect
                .poll(async () => (await recorded(page)).marks)
                .toEqual(expect.arrayContaining([Statement30, Statement60]));
            expect(await markedLines(page)).toBeGreaterThan(0);
            expect(problems).toEqual([]);
        });

        test("pausing freezes the variables and the mark", async ({page, baseURL}) => {
            const problems = await open(page, baseURL, Program, state);
            await debugButton(page).click();
            const before = (await variables(page))["I%"];
            await expect.poll(async () => (await variables(page))["I%"]).not.toBe(before);
            await pause(page);
            const frozen = {
                status: await status(page).textContent(),
                variables: await variables(page),
                marked: await markedText(page),
            };
            // Once everything has caught up, the mark is in the line the status names.
            const line = /^Running line (\d+)$/.exec(frozen.status)?.[1];
            expect(Program.split("\n").find(text => text.startsWith(`${line} `))).toContain(
                frozen.marked,
            );
            expect(frozen.marked).not.toBe("");
            await settle(page);
            expect({
                status: await status(page).textContent(),
                variables: await variables(page),
                marked: await markedText(page),
            }).toEqual(frozen);
            expect(problems).toEqual([]);
        });

        test("editing the running line removes the mark, and editing another line leaves it", async ({
            page,
            baseURL,
        }) => {
            const problems = await open(page, baseURL, Program, state);
            await debugButton(page).click();
            await expect.poll(() => runningLine(page)).not.toBeNull();
            await pause(page);
            const running = await runningLine(page);
            const marked = await markedText(page);
            expect(running).not.toBeNull();
            expect(marked).not.toBe("");

            const other = running === 30 ? 60 : 30;
            await editorLine(page, other).click();
            await page.keyboard.press("End");
            await page.keyboard.type(" ");
            await settle(page);
            await expect(status(page)).toHaveText(`Running line ${running}`);
            expect(await markedText(page)).toBe(marked);

            await editorLine(page, running).click();
            await page.keyboard.press("End");
            await page.keyboard.type(" ");
            await expect(status(page)).toHaveText(
                `Running line ${running}, which is not as in the editor`,
            );
            expect(await markedText(page)).toBe("");
            expect(await markedLines(page)).toBe(0);
            expect(problems).toEqual([]);
        });

        test("turning Debug off removes the panel and the mark, and gives the screen its height back", async ({
            page,
            baseURL,
        }) => {
            const problems = await open(page, baseURL, Program, state);
            await expect.poll(() => screenHeight(page)).toBeGreaterThan(300);
            const full = await screenHeight(page);
            await debugButton(page).click();
            await expect.poll(async () => await markedText(page)).not.toBe("");
            await expect.poll(() => screenHeight(page)).toBeLessThan(full);

            await debugButton(page).click();

            await expect(debugButton(page)).toHaveAttribute("aria-pressed", "false");
            await expect(panel(page)).toBeHidden();
            await expect.poll(() => markedText(page)).toBe("");
            expect(await markedLines(page)).toBe(0);
            await expect.poll(() => screenHeight(page)).toBe(full);
            // And it stays off while the program carries on.
            await settle(page);
            expect(await markedLines(page)).toBe(0);
            expect(problems).toEqual([]);
        });

        test("resident integers the program wrote are shown, even at their start value, and those it did not are not", async ({
            page,
            baseURL,
        }) => {
            const problems = await open(page, baseURL, ResidentProgram, state);
            await debugButton(page).click();
            // Run again, now that Debug is watching from the start.
            await page.locator('[data-action="run"]').click();
            await expect.poll(() => variables(page)).toEqual({"X%": "0", "Y%": "5"});
            await expect(status(page)).toHaveText("At BASIC's prompt");

            // A new run starts with nothing written: the first program's X% is gone from the second's.
            await page.locator(".monaco-editor").click();
            await page.keyboard.press("ControlOrMeta+a");
            await page.keyboard.type("Y%=7\nEND");
            await page.locator('[data-action="run"]').click();
            await expect.poll(() => variables(page)).toEqual({"Y%": "7"});
            expect(problems).toEqual([]);
        });

        test("turning Debug on after the program has written shows what is not at its start value", async ({
            page,
            baseURL,
        }) => {
            const problems = await open(page, baseURL, ResidentProgram, state);
            // Wait for the program to finish, with nothing watching it.
            await page.waitForTimeout(3000);
            await debugButton(page).click();
            await expect(status(page)).toHaveText("At BASIC's prompt");
            await expect.poll(() => variables(page)).toEqual({"Y%": "5"});
            expect(problems).toEqual([]);
        });

        test("a program that stops with an error shows it, marks its statement, and keeps its variables", async ({
            page,
            baseURL,
        }) => {
            const problems = await open(page, baseURL, ErrorProgram, state);
            await debugButton(page).click();
            // Run again, now that Debug is watching from the start.
            await page.locator('[data-action="run"]').click();
            await expect(status(page)).toHaveText(
                "Division by zero (ERR 18) at line 20. The variables are as the program left them.",
            );
            await expect(status(page)).toHaveAttribute("data-mark", "error");
            await expect.poll(() => variables(page)).toMatchObject({A: "1", B$: '"X"'});
            await expect.poll(() => markedText(page, "error")).toBe("PRINT 1/0");
            expect(await markedLines(page, "error")).toBe(1);
            expect(await markedLines(page, "running")).toBe(0);
            expect(problems).toEqual([]);
        });

        test("the panel carries an error the screen does not show", async ({page, baseURL}) => {
            const problems = await open(page, baseURL, HiddenErrorProgram, state);
            await debugButton(page).click();
            await page.locator('[data-action="run"]').click();
            await expect(status(page)).toHaveText(HiddenErrorStatus);
            await expect.poll(() => markedText(page, "error")).toBe("=200+3000/(9.5-n)");
            await expect.poll(() => variables(page)).toEqual({"N%": "9", n: "9.5"});
            // It stays while the machine sits at the prompt.
            await settle(page);
            await expect(status(page)).toHaveText(HiddenErrorStatus);
            expect(await markedText(page, "error")).toBe("=200+3000/(9.5-n)");
            expect(problems).toEqual([]);
        });

        test("switched on after the error, Debug shows it and marks its line", async ({
            page,
            baseURL,
        }) => {
            const problems = await open(page, baseURL, ErrorProgram, state);
            // Wait for the program to stop, with nothing watching it.
            await page.waitForTimeout(3000);
            await debugButton(page).click();
            await expect(status(page)).toHaveText(
                "Division by zero (ERR 18) at line 20. The variables are as the program left them.",
            );
            await expect.poll(() => markedText(page, "error")).toBe("PRINT 1/0");
            expect(problems).toEqual([]);
        });

        test("the error mark stays through an edit of another line, and goes on an edit of its own and on a new run", async ({
            page,
            baseURL,
        }) => {
            const problems = await open(page, baseURL, SlowErrorProgram, state);
            await debugButton(page).click();
            await expect(status(page)).toHaveText(/^Division by zero \(ERR 18\) at line 20\./);
            await expect.poll(() => markedText(page, "error")).toBe("PRINT 1/0");

            await editorLine(page, 10).click();
            await page.keyboard.press("End");
            await page.keyboard.type(" ");
            await settle(page);
            expect(await markedText(page, "error")).toBe("PRINT 1/0");

            await editorLine(page, 20).click();
            await page.keyboard.press("End");
            await page.keyboard.press("Shift+Home");
            await page.keyboard.type("20 X=1:Y=2");
            await expect(status(page)).toHaveText(
                "Division by zero (ERR 18) at line 20, which has changed since the error. " +
                    "The variables are as the program left them.",
            );
            expect(await markedLines(page, "error")).toBe(0);

            await page.locator('[data-action="run"]').click();
            await expect(status(page)).toHaveText("Running line 10");
            expect(await markedLines(page, "error")).toBe(0);
            await expect(status(page)).toHaveText("At BASIC's prompt");
            await expect(status(page)).toHaveAttribute("data-mark", "");
            expect(await markedLines(page, "error")).toBe(0);
            expect(problems).toEqual([]);
        });

        test("the error goes when RUN typed at the prompt runs the program, even one that ends at once", async ({
            page,
            baseURL,
        }) => {
            const problems = await open(page, baseURL, OnceErrorProgram, state);
            await debugButton(page).click();
            await page.locator('[data-action="run"]').click();
            await expect(status(page)).toHaveText(/^Division by zero \(ERR 18\) at line 10\./);
            await page.locator("#screen").click();
            for (const key of ["KeyR", "KeyU", "KeyN", "Enter"])
                await page.keyboard.press(key, {delay: 100});
            await expect(status(page)).toHaveText("At BASIC's prompt");
            expect(await markedLines(page, "error")).toBe(0);
            expect(problems).toEqual([]);
        });

        test("STOP in a line numbered 0 is an error at line 0, kept through a command typed at the prompt", async ({
            page,
            baseURL,
        }) => {
            const problems = await open(page, baseURL, "0 X=1:STOP", state);
            await debugButton(page).click();
            await page.locator('[data-action="run"]').click();
            const stopped = "STOP at line 0. The variables are as the program left them.";
            await expect(status(page)).toHaveText(stopped);
            await expect(status(page)).toHaveAttribute("data-mark", "error");
            await expect.poll(() => markedText(page, "error")).toBe("STOP");
            await page.locator("#screen").click();
            for (const key of ["KeyC", "KeyL", "KeyS", "Enter"])
                await page.keyboard.press(key, {delay: 100});
            await settle(page);
            await expect(status(page)).toHaveText(stopped);
            expect(await markedText(page, "error")).toBe("STOP");
            expect(problems).toEqual([]);
        });

        test("a program waiting for a key says so, with the keyword and line, and moves on when one is pressed", async ({
            page,
            baseURL,
        }) => {
            const problems = await open(page, baseURL, KeyProgram, state);
            await debugButton(page).click();
            await page.locator('[data-action="run"]').click();
            await expect(status(page)).toHaveText("Waiting for keyboard input (GET) at line 10");
            await expect.poll(() => markedText(page)).toBe("G=GET");
            await typeAtEmulator(page, ["KeyA"]);
            await expect(status(page)).toHaveText("Waiting for keyboard input (INPUT) at line 20");
            await expect.poll(() => markedText(page)).toBe("INPUT X");
            await typeAtEmulator(page, ["Digit5", "Enter"]);
            await expect(status(page)).toHaveText("At BASIC's prompt");
            await expect.poll(() => variables(page)).toEqual({G: "65", X: "5"});
            expect(problems).toEqual([]);
        });

        test("a program that reads the keyboard without waiting for it says it is running", async ({
            page,
            baseURL,
        }) => {
            const problems = await open(page, baseURL, PollingProgram, state);
            await debugButton(page).click();
            await page.locator('[data-action="run"]').click();
            await expect(status(page)).toHaveText("Running line 10");
            await recordEveryFrame(page);
            await settle(page);
            await settle(page);
            expect((await recorded(page)).statuses).toEqual(["Running line 10"]);
            expect(problems).toEqual([]);
        });

        test("a program that waits for vsync says so in the frames that end in the wait", async ({
            page,
            baseURL,
        }) => {
            const problems = await open(page, baseURL, VsyncProgram, state);
            await debugButton(page).click();
            await page.locator('[data-action="run"]').click();
            await expect(status(page)).toHaveText(/line (20|30)$/);
            await recordEveryFrame(page);
            await settle(page);
            expect((await recorded(page)).statuses).toContain("Waiting for vsync at line 20");
            expect(problems).toEqual([]);
        });
    });
}
