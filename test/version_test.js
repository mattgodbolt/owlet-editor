import {describe, expect, it} from "vitest";
import {describeBuild} from "../src/version";

describe("describeBuild", () => {
    const sha = "0123456789abcdef0123456789abcdef01234567";

    it("links the short sha to the full commit", () => {
        expect(describeBuild(sha, "2026-11-15")).toEqual({
            label: "0123456, built 2026-11-15",
            url: `https://github.com/mattgodbolt/owlet-editor/commit/${sha}`,
        });
    });

    it("falls back to a plain label when the sha is unknown", () => {
        expect(describeBuild(undefined, undefined)).toEqual({label: "dev build", url: null});
        expect(describeBuild("", "2026-11-15")).toEqual({label: "dev build", url: null});
    });
});
