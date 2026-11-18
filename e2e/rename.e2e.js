import {expect, test} from "@playwright/test";

const Program = ["10 DIM S(360)", "20 FOR I=0 TO 360:S(I)=SIN(RAD(I)):NEXT"].join("\n");
const Message = ".monaco-editor .monaco-editor-overlaymessage";
const Loop = "20 FOR I=0 TO 360:S(I)=SIN(RAD(I)):NEXT";
const OtherLoop = "20 FOR J=0 TO 360:S(J)=SIN(RAD(J)):NEXT";
const IntegerLoop = "20 FOR I%=0 TO 360:S(I%)=SIN(RAD(I%)):NEXT";

const link = program => `/#${encodeURIComponent(JSON.stringify({v: 1, program}))}`;

const loopLine = page => page.locator(".monaco-editor .view-line").filter({hasText: /^\s*20\s/});

/** Renames the I of the FOR in line 20, as a user does: the cursor on it, F2, the new name and Return. */
async function renameLoopVariable(page, newName) {
    await loopLine(page).click();
    await page.keyboard.press("Home");
    // Past the line number and "FOR ", so that the cursor is just before the I.
    for (let i = 0; i < "20 FOR ".length; ++i) await page.keyboard.press("ArrowRight");
    await page.keyboard.press("F2");
    const input = page.locator(".rename-box .rename-input");
    await expect(input).toBeFocused();
    await input.fill(newName);
    await page.keyboard.press("Enter");
}

test.describe("Rename", () => {
    test.beforeEach(async ({page, baseURL}) => {
        await page.route(
            url => url.origin !== new URL(baseURL).origin,
            route => route.fulfill({status: 204, body: ""}),
        );
        await page.goto(link(Program));
        await expect(loopLine(page)).toHaveText(Loop);
    });

    test("tells the user what a change from real to integer does, and Ctrl+Z undoes it", async ({
        page,
    }) => {
        await renameLoopVariable(page, "I%");
        await expect(loopLine(page)).toHaveText(IntegerLoop);
        await expect(page.locator(Message)).toContainText(
            "Renamed I to I%: it now holds whole numbers only",
        );
        await expect(page.locator(Message)).toContainText("I% is a resident integer");

        await page.keyboard.press("Control+Z");
        await expect(loopLine(page)).toHaveText(Loop);
    });

    test("says why it refuses a change to a string, and says nothing about a rename that keeps the type", async ({
        page,
    }) => {
        await renameLoopVariable(page, "I$");
        await expect(page.locator(Message)).toHaveText("Renaming I to I$ would change its type");
        await expect(loopLine(page)).toHaveText(Loop);

        await page.keyboard.press("Escape");
        await expect(page.locator(Message)).toHaveCount(0);
        await renameLoopVariable(page, "J");
        await expect(loopLine(page)).toHaveText(OtherLoop);
        // A message is shown once the edit is applied, a frame or so after the line shows it.
        await page.waitForTimeout(500);
        await expect(page.locator(Message)).toHaveCount(0);
    });
});
