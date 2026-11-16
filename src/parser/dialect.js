// Which BASIC the parser follows: BASIC II (the Model B's) or BASIC IV (the Master's). The lexer and recogniser read it
// as each line is made, so a change shows in the next line read.
import {Flags, immediateCommands, keywords} from "../tokens.js";

let basicIV = false;

export const isBasicIV = () => basicIV;

export function setBasicIV(enabled) {
    basicIV = Boolean(enabled);
}

// BASIC IV's keyword table is BASIC II's with COLOR (the same token as COLOUR, which BASIC reads first) and EDIT
// added, each straight after the entry it follows in the ROM's table, since the first entry that matches is the one used.
const EditToken = 0xce;
const basicIVKeywords = keywords.flatMap(kw => [
    kw,
    ...(kw.keyword === "COUNT" ? [{keyword: "COLOR", token: 251, flags: Flags.Middle}] : []),
    ...(kw.keyword === "EXT" ? [{keyword: "EDIT", token: EditToken, flags: Flags.LineNumber}] : []),
]);

export const currentKeywords = () => (basicIV ? basicIVKeywords : keywords);
export const currentImmediateCommands = () =>
    basicIV ? [...immediateCommands, "EDIT"] : immediateCommands;
