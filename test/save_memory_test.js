import {afterEach, describe, expect, it, vi} from "vitest";
import {toClipboard} from "../src/save-memory";

describe("Copying to the clipboard", () => {
    afterEach(() => {
        vi.restoreAllMocks();
        delete document.execCommand;
        delete navigator.clipboard;
    });

    const withClipboard = writeText =>
        Object.defineProperty(navigator, "clipboard", {value: {writeText}, configurable: true});
    const withExecCommand = result => {
        let copied = null;
        document.execCommand = vi.fn(command => {
            copied = document.querySelector("textarea").value;
            return command === "copy" && result;
        });
        return () => copied;
    };

    it("uses the clipboard API where it works", async () => {
        const writeText = vi.fn().mockResolvedValue();
        withClipboard(writeText);
        await toClipboard("abc");
        expect(writeText).toHaveBeenCalledWith("abc");
    });

    it("falls back to copying from a textarea where the clipboard API refuses, or is missing", async () => {
        withClipboard(vi.fn().mockRejectedValue(new Error("denied")));
        const copied = withExecCommand(true);
        await toClipboard("abc");
        expect(copied()).toBe("abc");
        expect(document.querySelector("textarea")).toBeNull();
        delete navigator.clipboard;
        await toClipboard("def");
        expect(copied()).toBe("def");
    });

    it("says so only when the fallback fails too", async () => {
        withClipboard(vi.fn().mockRejectedValue(new Error("denied")));
        withExecCommand(false);
        await expect(toClipboard("abc")).rejects.toThrow("the browser did not allow it");
    });
});
