import {lexLine, romBytes} from "../src/parser/lexer";
import {describe, it} from "vitest";
import assert from "assert";
import RomTokens from "./rom-tokens.json";

const hex = bytes => bytes.map(b => b.toString(16).padStart(2, "0")).join(" ");

// The rows of a recorded table on which the function's answer differs from the recorded one, with both answers.
const disagreements = (rows, answer) =>
    rows.flatMap(([text, recorded]) => {
        const ours = answer(text);
        return ours === recorded ? [] : [{text, recorded, ours}];
    });

describe("Lexer", () => {
    it("should tokenise each line as BASIC II does", () => {
        assert.deepStrictEqual(
            disagreements(RomTokens, text => hex(romBytes(lexLine(text)))),
            [],
        );
    });
});
