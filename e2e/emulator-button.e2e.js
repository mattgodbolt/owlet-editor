import {expect, test} from "@playwright/test";

const link = program => `/#${encodeURIComponent(JSON.stringify({v: 1, program}))}`;

test.describe("the emulator button", () => {
    test("is named for whether the emulator is running, even when it stops itself", async ({
        page,
        baseURL,
    }) => {
        // Sending to beebjit pauses the emulator, and a failed request leaves it paused with the screen still shown.
        await page.route(
            url => url.origin !== new URL(baseURL).origin,
            route => route.abort(),
        );
        await page.goto(link('10 PRINT "HELLO"'));
        const button = running =>
            page.getByRole("button", {
                name: running ? "Pause the emulator" : "Resume the emulator",
            });
        await expect(button(true)).toBeVisible();
        await expect(page.locator("#play-pause")).not.toHaveClass(/play/);

        await page.locator("#rocket").dispatchEvent("click");

        await expect(button(false)).toBeVisible();
        await expect(page.locator("#play-pause")).toHaveClass(/play/);

        await button(false).click();

        await expect(button(true)).toBeVisible();
        await expect(page.locator("#play-pause")).not.toHaveClass(/play/);
    });
});
