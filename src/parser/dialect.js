// Which BASIC the parser follows: BASIC II (the Model B's) or BASIC IV (the Master's). Each of the lexer, recogniser and
// assembler takes a dialect to read a line by; without one they use the editor's, which `setBasicIV` changes, so a
// change shows in the next line read.
import {Flags, immediateCommands, keywords} from "../tokens.js";

// BASIC IV's keyword table is BASIC II's with COLOR (the same token as COLOUR, which BASIC reads first) and EDIT
// added, each straight after the entry it follows in the ROM's table, since the first entry that matches is the one used.
const EditToken = 0xce;
const basicIVKeywords = keywords.flatMap(kw => [
    kw,
    ...(kw.keyword === "COUNT" ? [{keyword: "COLOR", token: 251, flags: Flags.Middle}] : []),
    ...(kw.keyword === "EXT" ? [{keyword: "EDIT", token: EditToken, flags: Flags.LineNumber}] : []),
]);

export const BasicIIDialect = Object.freeze({
    basicIV: false,
    keywords,
    immediateCommands,
});
export const BasicIVDialect = Object.freeze({
    basicIV: true,
    keywords: basicIVKeywords,
    immediateCommands: [...immediateCommands, "EDIT"],
});

let current = BasicIIDialect;

export const currentDialect = () => current;
export const isBasicIV = () => current.basicIV;
export const currentKeywords = () => current.keywords;
export const currentImmediateCommands = () => current.immediateCommands;

export function setBasicIV(enabled) {
    current = enabled ? BasicIVDialect : BasicIIDialect;
}
