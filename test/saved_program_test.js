import {afterEach, describe, expect, it} from "vitest";
import {saveMachine, savedMachine, savedProgram, saveProgram} from "../src/saved-program";

describe("Saved program", () => {
    afterEach(() => {
        localStorage.clear();
        sessionStorage.clear();
    });

    it("is nothing before anything is saved", () => {
        expect(savedProgram()).toBeNull();
    });
    it("comes back as saved", () => {
        saveProgram("PRINT 1");
        expect(savedProgram()).toBe("PRINT 1");
    });
    it("keeps an empty program rather than falling back to another tab's", () => {
        localStorage.setItem("program", "PRINT 2");
        sessionStorage.setItem("program", "");
        expect(savedProgram()).toBe("");
    });
    it("gives a tab its own program back, not the latest edit from another tab", () => {
        saveProgram("PRINT ONE");
        // Another tab saves later: the shared copy moves on, this tab's own does not.
        localStorage.setItem("program", "PRINT TWO");
        expect(savedProgram()).toBe("PRINT ONE");
    });
    it("does not make a tab loading its own program back the latest edit", () => {
        saveProgram("PRINT ONE");
        localStorage.setItem("program", "PRINT TWO");
        saveProgram("PRINT ONE");
        expect(localStorage.getItem("program")).toBe("PRINT TWO");
    });
    it("starts a new tab from the latest edit anywhere", () => {
        localStorage.setItem("program", "PRINT TWO");
        expect(savedProgram()).toBe("PRINT TWO");
    });
    it("keeps the machine per tab like the program, and apart from it", () => {
        saveProgram("PRINT ONE");
        saveMachine("Master");
        localStorage.setItem("machine", "B");
        expect(savedMachine()).toBe("Master");
        expect(savedProgram()).toBe("PRINT ONE");
        sessionStorage.clear();
        expect(savedMachine()).toBe("B");
    });
});
