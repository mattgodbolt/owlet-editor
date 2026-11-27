import {describe, expect, it} from "vitest";
import {evaluate, ExpressionError} from "../src/memory-expression";

const memory = new Uint8Array(0x10000);
memory.set([0x34, 0x12, 0, 0], 0x70);
memory.set([0xff, 0xff, 0xff, 0xff], 0x80);
memory[0x1003] = 0x42;
memory[0xffff] = 0x99;
memory[0x0000] = 0x11;
const variables = {"D%": 0x1900, "P%": 0x1907, PAGE: 0x1900, X: 2.5, buf: 0x2000};
const context = {names: name => variables[name], peek: address => memory[address]};
const run = text => evaluate(text, context);

describe("Memory expressions", () => {
    it.each([
        ["123", 123],
        ["&1F00", 0x1f00],
        ["&1f00", 0x1f00],
        ["$1F00", 0x1f00],
        ["0x1F00", 0x1f00],
        ["0X1f00", 0x1f00],
        ["&FFFFFFFF", -1],
        ["D%", 0x1900],
        ["P%-D%", 7],
        ["P%-1", 0x1906],
        [" PAGE + &100 ", 0x1a00],
        ["buf", 0x2000],
        ["2+3*4", 14],
        ["(2+3)*4", 20],
        ["7 DIV 2", 3],
        ["-7 DIV 2", -3],
        ["7.9 DIV 2", 3],
        ["7 MOD 4", 3],
        ["-7 MOD 4", -3],
        ["10/4", 2],
        ["&FFFF AND P%", 0x1907],
        ["D%AND&FF00", 0x1900],
        ["1 OR 2 AND 3", 3],
        ["5 EOR 1", 4],
        ["-3+5", 2],
        ["--3", 3],
        ["X*2", 5],
        ["1.5E2", 150],
        ["?&1003", 0x42],
        ["!&70", 0x1234],
        ["!&80", -1],
        ["&1000?3", 0x42],
        ["&70!0", 0x1234],
        ["?&70+1", 0x35],
        ["?(&FFFF+1)", 0x11],
        ["?-1", 0x99],
    ])("%s is %i", (text, expected) => expect(run(text)).toBe(expected));

    it.each([
        ["Q%", "No such variable: Q%"],
        ["A$", "Type mismatch: A$ is a string"],
        ["$D%", 'Syntax error at "$"'],
        ["1/0", "Division by zero"],
        ["1 DIV 0.5", "Division by zero"],
        ["1+", "Missing number"],
        ["(1+2", "Missing )"],
        ["1 2", 'Syntax error at "2"'],
        ["1=1", 'Syntax error at "="'],
        ["", "Missing number"],
    ])("%s is refused: %s", (text, message) =>
        expect(() => run(text)).toThrow(new ExpressionError(message)),
    );
});
