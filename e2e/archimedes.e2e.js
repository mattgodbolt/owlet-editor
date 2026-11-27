import {expect, test} from "@playwright/test";

const Program = ['PRINT "A&B"', "GOTO 11", '11 PRINT "X Y"'].join("\n");
const link = program => `/#${encodeURIComponent(JSON.stringify({v: 1, program}))}`;

test.describe("Share to Archimedes (#338)", () => {
    test("opens archi.medes.live with the editor's text, URL encoded", async ({
        page,
        context,
        baseURL,
    }) => {
        const fetched = [];
        await context.route(
            url => url.origin !== new URL(baseURL).origin,
            route => {
                fetched.push(route.request().url());
                return route.fulfill({
                    status: 200,
                    contentType: "text/html",
                    body: "<title>stub</title>",
                });
            },
        );
        await page.goto(link(Program));
        // The buttons only work once the emulator has started, so retry until the dialog opens.
        await expect(async () => {
            await page.getByRole("button", {name: "Share your code"}).click();
            await expect(page.locator("#share")).toBeVisible({timeout: 1000});
        }).toPass();
        const popup = context.waitForEvent("page");
        await page.getByRole("button", {name: "Archimedes"}).click();
        const opened = await popup;
        expect(opened.url()).toBe(`https://archi.medes.live/#basic=${encodeURIComponent(Program)}`);
        await expect(page.locator("#share")).toBeHidden();
        expect(fetched.filter(url => url.startsWith("https://archi.medes.live/"))).toHaveLength(1);
    });
});
