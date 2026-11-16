import {describe, expect, it} from "vitest";
import {oneAtATime} from "../src/one-at-a-time";

describe("One at a time", () => {
    it("starts each call after the one before has settled, failed or not", async () => {
        const log = [];
        const slow = oneAtATime(async (name, ms, fail) => {
            log.push(`start ${name}`);
            await new Promise(resolve => setTimeout(resolve, ms));
            log.push(`end ${name}`);
            if (fail) throw new Error(name);
            return name;
        });
        const results = await Promise.allSettled([
            slow("a", 30, true),
            slow("b", 1),
            slow("c", 10),
        ]);
        expect(log).toEqual(["start a", "end a", "start b", "end b", "start c", "end c"]);
        expect(results.map(r => r.value ?? r.reason.message)).toEqual(["a", "b", "c"]);
        expect(results[0].status).toBe("rejected");
    });
});
