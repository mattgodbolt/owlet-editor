import {describe, expect, it} from "vitest";
import {evaluate, ExpressionError} from "../src/memory-expression";
import {memoryText} from "../src/memory-text";

const memory = new Uint8Array(0x10000);
memory.set([0x34, 0x12, 0, 0], 0x70);
memory[0x1003] = 0x42;
const variables = {"D%": 0x1900, "P%": 0x1907, PAGE: 0x1900, X: 2.5};
const context = {names: name => variables[name], peek: address => memory[address]};
const run = text => evaluate(text, context);

describe("Memory expressions", () => {
    it.each([
        ["123", 123],
        ["&1F00", 0x1f00],
        ["$1f00", 0x1f00],
        ["D%", 0x1900],
        ["P%-D%", 7],
        ["P%-1", 0x1906],
        ["PAGE+&100", 0x1a00],
        ["2+3*4", 14],
        ["(2+3)*4", 20],
        ["7 DIV 2", 3],
        ["7 MOD 4", 3],
        ["10/4", 2],
        ["&FFFF AND P%", 0x1907],
        ["1 OR 2 AND 3", 3],
        ["-3+5", 2],
        ["?&1003", 0x42],
        ["!&70", 0x1234],
        ["&1000?3", 0x42],
        ["&70!0", 0x1234],
        ["X*2", 5],
    ])("%s is %i", (text, expected) => expect(run(text)).toBe(expected));

    it.each([
        ["Q%", "No such variable: Q%"],
        ["A$", "Type mismatch: A$ is text"],
        ["1/0", "Division by zero"],
        ["1+", "Missing number"],
        ["(1+2", "Missing )"],
        ["1 2", 'Syntax error at "2"'],
        ["", "Missing number"],
    ])("%s is rejected as %s", (text, message) =>
        expect(() => run(text)).toThrow(new ExpressionError(message)),
    );
});

describe("Memory text", () => {
    it("shows control codes and 127 to 160 as the characters 256 higher, and counts the bytes BASIC lines cannot hold", () => {
        const {text, counts} = memoryText([0x41, 0x0a, 0x0d, 0x7f, 0xa0, 0xa1, 0xff]);
        expect([...text].map(c => c.codePointAt(0))).toEqual([
            0x41, 0x10a, 0x10d, 0x17f, 0x1a0, 0xa1, 0xff,
        ]);
        expect(counts.get(0x0a)).toBe(1);
        expect(counts.get(0x0d)).toBe(1);
    });
});
