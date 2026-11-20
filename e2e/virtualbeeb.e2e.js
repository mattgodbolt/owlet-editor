import {expect, test} from "@playwright/test";

const Program = '10 PRINT "EDIT"';
const link = program => `/#${encodeURIComponent(JSON.stringify({v: 1, program}))}`;

test.describe("3D button", () => {
    test.beforeEach(async ({page, baseURL}) => {
        await page.route(
            url => url.origin !== new URL(baseURL).origin,
            route => route.fulfill({status: 204, body: ""}),
        );
        await page.goto(link(Program));
    });

    test("opens the 3D emulator with the editor's text", async ({page, context}) => {
        const popup = context.waitForEvent("page");
        await page.locator("[data-action=virtualbeeb]").click();
        const url = new URL((await popup).url());
        expect(url.origin).toBe("https://virtual.bbcmic.ro");
        expect(url.searchParams.get("embedBasic")).toContain("EDIT");
    });
});
