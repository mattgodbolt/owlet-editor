import {expect, test} from "@playwright/test";

// Assembles bytes that include &0A and &0D, the two a program line cannot hold, between D% and P%.
const Assembler = [
    "10 MODE 7",
    "20 DIM D% 99:P%=D%",
    "30 [OPT 0",
    "40 LDA #&0A:LDX #&0D:STA &70:STX &71",
    '50 .msg EQUS "Hello, owl!":EQUB 13:EQUB 0:EQUB &0A',
    "60 RTS",
    "70 ]",
    "80 END",
].join("\n");
const Assembled = "A9 0A A2 0D 85 70 86 71 48 65 6C 6C 6F 2C 20 6F 77 6C 21 0D 00 0A 60";
// The bytes as text, with the control codes as the characters 256 higher.
const AssembledText = "©Ċ¢čƅpƆqHello, owl!čĀĊ`";
// The screen is in shadow RAM, and what BASIC writes at the same addresses goes to main RAM.
const Shadow = ['10 MODE 135:PRINT "HELLO";', "20 ?&7C00=&11:?&7C01=&22", "30 END"].join("\n");

const link = (program, state) =>
    `/#${encodeURIComponent(JSON.stringify({v: 1, program, ...state}))}`;

/** Opens the built page on a program, and fails the test on any page error or console error. */
async function open(page, context, baseURL, program, state = {}) {
    const problems = [];
    page.on("pageerror", error => problems.push(`page error: ${error.message}`));
    page.on("console", message => {
        if (message.type() === "error") problems.push(`console error: ${message.text()}`);
    });
    await page.route(
        url => url.origin !== new URL(baseURL).origin,
        route => route.fulfill({status: 204, body: ""}),
    );
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto(link(program, state));
    await expect(saveButton(page)).toBeVisible();
    return problems;
}

const saveButton = page => page.getByRole("button", {name: "Save memory from the emulator"});
const summary = page => page.locator("#saveSummary");
const previewBytes = page =>
    page
        .locator("#savePreview .save-byte")
        .evaluateAll(cells => cells.map(cell => cell.textContent).join(" "));
const running = page => page.evaluate(() => window.theEmulator.running);

async function setRange(page, first, mode, second) {
    await page.getByLabel("Start address").fill(first);
    await page.locator("#saveMode").selectOption(mode);
    await page.getByLabel("End address, or length").fill(second);
}

/** Waits for the program to end, as the Debug panel shows, then opens the dialog on a range. */
async function openOn(page, range) {
    // The buttons do nothing until the page has set up, so the click is tried until it takes.
    const debug = page.getByRole("button", {name: "Debug BASIC"});
    await expect(async () => {
        await debug.click();
        await expect(debug).toHaveAttribute("aria-pressed", "true", {timeout: 1000});
    }).toPass();
    await expect(page.locator("#debugger .debug-status")).toHaveText("At BASIC's prompt", {
        timeout: 20000,
    });
    await saveButton(page).click();
    await setRange(page, ...range);
}

test.describe("Save memory", () => {
    test("shows, then copies, what a program assembled from D% to P%-1, pausing the emulator meanwhile", async ({
        page,
        context,
        baseURL,
    }) => {
        const problems = await open(page, context, baseURL, Assembler);
        await openOn(page, ["D%", "end", "P%-1"]);
        await expect(summary(page)).toHaveText(
            /^23 bytes, &\w{4} to &\w{4}: 2 x &0A and 2 x &0D, which can break a program line$/,
        );
        expect(await running(page)).toBe(false);
        expect(await previewBytes(page)).toBe(Assembled);
        await expect(page.locator("#saveText")).toHaveText(AssembledText);
        await expect(page.locator("#saveProblems button")).toHaveCount(4);
        await expect(page.locator('#savePreview [data-byte="0D"]')).toHaveCount(2);

        await setRange(page, "D%", "length", "P%-D%");
        expect(await previewBytes(page)).toBe(Assembled);
        await setRange(page, "&FFF0", "length", "&11");
        await expect(summary(page)).toHaveText("The range runs past &FFFF, to &10000");
        await expect(page.locator("#saveCopy")).toBeDisabled();
        await setRange(page, "msg", "length", "&B");
        await expect(page.locator("#saveText")).toHaveText("Hello, owl!");

        await setRange(page, "D%", "end", "P%-1");
        await page.locator("#saveCopy").click();
        await expect(page.locator("#save")).toBeHidden();
        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(AssembledText);
        expect(await running(page)).toBe(true);
        expect(problems).toEqual([]);
    });

    test("reads the Master's shadow screen when Shadow RAM is chosen, and main RAM as the program does", async ({
        page,
        context,
        baseURL,
    }) => {
        const problems = await open(page, context, baseURL, Shadow, {model: "Master"});
        await openOn(page, ["&7C00", "length", "5"]);
        expect(await previewBytes(page)).toBe("11 22 20 20 20");
        await expect(page.locator("#saveShadow")).toBeVisible();
        await page
            .getByLabel("Which memory to read")
            .selectOption({label: "Shadow RAM (the screen in a shadow mode), &3000 to &7FFF"});
        expect(await previewBytes(page)).toBe("48 45 4C 4C 4F");
        await expect(page.locator("#saveShadow")).toBeHidden();
        await page.locator("#saveCopy").click();
        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("HELLO");
        expect(problems).toEqual([]);
    });
});
