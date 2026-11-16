import * as master from "jsbeeb/src/basic-tokenise";
import {ModelBDialect} from "./parser/dialect";
import {romBytes} from "./parser/lexer";
import {tokenise} from "./parser/recogniser";

const MaxTokenisedLength = 251;

// jsbeeb's tokeniser runs the Master's BASIC IV ROM, so a Model B's program is tokenised by the parser's BASIC II
// lexer, which lexfuzz checks against the B's own ROM, and the highlighter's reading of COLOR.
export function tokeniseBasicII(text) {
    let result = "";
    text.split("\n").forEach((line, i) => {
        if (!line) return;
        const [, number, rest] = line.match(/^([0-9]+)?(.*)/);
        const lineNumber = number ? parseInt(number) : 10 + i * 10;
        const tokens = String.fromCharCode(...romBytes(tokenise(rest, ModelBDialect)));
        if (tokens.length > MaxTokenisedLength)
            throw new Error(
                `Line ${lineNumber} tokenised length ${tokens.length} > ${MaxTokenisedLength} bytes`,
            );
        result += `\r${String.fromCharCode(lineNumber >>> 8, lineNumber & 0xff, tokens.length + 4)}${tokens}`;
    });
    return `${result}\r\xff`;
}

/** Both machines' tokenisers, to choose between with `tokeniserFor`; only the Master's needs to load ROMs. */
export async function createTokenisers() {
    return {master: await master.create(), b: {tokenise: tokeniseBasicII}};
}

/** The tokeniser of the BASIC that the model runs. */
export const tokeniserFor = (tokenisers, model) =>
    model.isMaster ? tokenisers.master : tokenisers.b;
