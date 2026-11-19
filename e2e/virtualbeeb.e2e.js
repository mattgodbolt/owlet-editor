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

    test("sits in the toolbar above the editor, beside Share", async ({page}) => {
        const button = page.locator("#emu_toolbar [data-action=virtualbeeb]");
        await expect(button).toBeVisible();
        await expect(button).toHaveAttribute("title", "Open in the 3D virtual BBC Micro");
        await expect(page.locator("#emu_footer [data-action=virtualbeeb]")).toHaveCount(0);
        const shareBox = await page.locator("#emu_toolbar [data-action=share]").boundingBox();
        const buttonBox = await button.boundingBox();
        expect(buttonBox.y).toBe(shareBox.y);
        expect(buttonBox.x).toBeGreaterThan(shareBox.x);
    });

    test("opens the 3D emulator with the editor's text", async ({page, context}) => {
        const popup = context.waitForEvent("page");
        await page.locator("#emu_toolbar [data-action=virtualbeeb]").click();
        const url = new URL((await popup).url());
        expect(url.origin).toBe("https://virtual.bbcmic.ro");
        expect(url.searchParams.get("embedBasic")).toContain("EDIT");
    });
});
