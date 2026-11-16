import * as master from "jsbeeb/src/basic-tokenise";
import {isBasicIV, setBasicIV} from "./parser/dialect";
import {lexLine, romBytes} from "./parser/lexer";

const MaxTokenisedLength = 251;

// jsbeeb's tokeniser runs the Master's BASIC IV ROM, so a Model B's program is tokenised by the parser's BASIC II
// lexer, which lexfuzz checks against the B's own ROM.
export function tokeniseBasicII(text) {
    const wasBasicIV = isBasicIV();
    setBasicIV(false);
    try {
        let result = "";
        text.split("\n").forEach((line, i) => {
            if (!line) return;
            const [, number, rest] = line.match(/^([0-9]+)?(.*)/);
            const lineNumber = number ? parseInt(number) : 10 + i * 10;
            const tokens = String.fromCharCode(...romBytes(lexLine(rest)));
            if (tokens.length > MaxTokenisedLength)
                throw new Error(
                    `Line ${lineNumber} tokenised length ${tokens.length} > ${MaxTokenisedLength} bytes`,
                );
            result += `\r${String.fromCharCode(lineNumber >>> 8, lineNumber & 0xff, tokens.length + 4)}${tokens}`;
        });
        return `${result}\r\xff`;
    } finally {
        setBasicIV(wasBasicIV);
    }
}

/** Both machines' tokenisers, to choose between with `tokeniserFor`; only the Master's needs to load ROMs. */
export async function createTokenisers() {
    return {master: await master.create(), b: {tokenise: tokeniseBasicII}};
}

/** The tokeniser of the BASIC that the model runs. */
export const tokeniserFor = (tokenisers, model) =>
    model.isMaster ? tokenisers.master : tokenisers.b;
