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
