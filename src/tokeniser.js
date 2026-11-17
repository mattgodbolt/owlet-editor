import * as master from "jsbeeb/src/basic-tokenise";
import {ModelBDialect} from "./parser/dialect";
import {romBytes} from "./parser/lexer";
import {tokeniseLines} from "./parser/highlight";

const MaxTokenisedLength = 251;
/** The step between the numbers the tokenisers give lines that have none, each the line's place in the text times it. */
export const ImplicitLineNumberStep = 10;

// jsbeeb's tokeniser runs the Master's BASIC IV ROM, so a Model B's program is tokenised by the parser's BASIC II
// lexer, which lexfuzz checks against the B's own ROM, and the highlighter's reading of COLOR.
export function tokeniseBasicII(text) {
    let result = "";
    const lines = text.split("\n").map(line => line.match(/^([0-9]+)?(.*)/));
    const lineTokens = tokeniseLines(
        lines.map(([, , rest]) => rest),
        ModelBDialect,
    );
    lines.forEach(([line, number], i) => {
        if (!line) return;
        const lineNumber = number ? parseInt(number) : ImplicitLineNumberStep * (i + 1);
        const tokens = String.fromCharCode(...romBytes(lineTokens[i]));
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
