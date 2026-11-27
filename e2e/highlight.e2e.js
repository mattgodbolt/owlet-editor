import {expect, test} from "@playwright/test";

const Program = '10 P."HELLO":F.I=1TO9:P.I:N.';

const link = program => `/#${encodeURIComponent(JSON.stringify({v: 1, program}))}`;

const line = (page, text) => page.locator(".monaco-editor .view-line").filter({hasText: text});

/** The number of different colours Monaco has used on the line. */
const coloursOn = locator =>
    locator.evaluate(
        element => new Set([...element.querySelectorAll("span span")].map(s => s.className)).size,
    );

test.describe("Syntax colouring", () => {
    test.beforeEach(async ({page, baseURL}) => {
        await page.route(
            url => url.origin !== new URL(baseURL).origin,
            route => route.fulfill({status: 204, body: ""}),
        );
        await page.goto(link(Program));
        await expect(line(page, "HELLO")).toBeVisible();
    });

    for (const [button, text] of [
        ["Decode", /PRINT"HELLO"/],
        ["Shrink", /ñ"HELLO"/],
    ]) {
        test(`is there after ${button} while the program runs, however busy the page is`, async ({
            page,
        }) => {
            // Monaco colours a replaced text in idle time, which a busy page does not give it.
            const client = await page.context().newCDPSession(page);
            await page.locator("[data-action=run]").click();
            await client.send("Emulation.setCPUThrottlingRate", {rate: 6});
            if (button === "Shrink") await page.locator("[data-action=expand]").click();
            await page.locator(`.footer button`, {hasText: button}).click();
            await expect(line(page, "HELLO")).toHaveText(text);
            await expect.poll(() => coloursOn(line(page, "HELLO"))).toBeGreaterThan(1);
        });
    }
});

// vs-dark's colour for the "invalid" token type.
const Red = "rgb(244, 71, 71)";

/** The text of each part of the line that Monaco shows in red. */
const redOn = locator =>
    locator.evaluate(
        (element, red) =>
            [...element.querySelectorAll("span span")]
                .filter(span => getComputedStyle(span).color === red)
                .map(span => span.textContent),
        Red,
    );

test.describe("A line being typed", () => {
    test.beforeEach(async ({page, baseURL}) => {
        await page.route(
            url => url.origin !== new URL(baseURL).origin,
            route => route.fulfill({status: 204, body: ""}),
        );
        await page.goto(link(":PRINT I:NEXT\nPRINT"));
        await expect(line(page, "NEXT")).toBeVisible();
    });

    test("is not red in front of a colon, or before a closing bracket the editor added, until the cursor leaves it", async ({
        page,
    }) => {
        const typed = line(page, "NEXT");
        await typed.click();
        await page.keyboard.press("Home");
        for (const key of "FOR I=1 TO") {
            await page.keyboard.type(key);
            // Monaco colours an edited line again shortly after showing it.
            await page.waitForTimeout(200);
            expect(await redOn(typed)).toEqual([]);
        }
        await page.keyboard.press("ArrowDown");
        await expect.poll(() => redOn(typed)).toEqual(["TO"]);

        await page.keyboard.press("End");
        await page.keyboard.press("Enter");
        // A ( typed within a few milliseconds of the Enter is not closed, which no one typing can do.
        await page.waitForTimeout(200);
        await page.keyboard.type("IF (");
        await expect(line(page, "IF ()")).toBeVisible();
        await page.keyboard.type("X A");
        const opened = line(page, "IF (X A)");
        await expect(opened).toBeVisible();
        await page.waitForTimeout(200);
        expect(await redOn(opened)).toEqual([]);
        await page.keyboard.press("ArrowUp");
        await expect.poll(() => redOn(opened)).not.toEqual([]);
    });
});
