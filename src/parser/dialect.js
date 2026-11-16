// Which BASIC the parser follows: BASIC II (the Model B's) or BASIC IV (the Master's). Each of the lexer, recogniser and
// assembler takes the dialect to read a line by, and the editor passes that of the machine it is on; the default where
// one is optional is the Model B's, and nothing here changes with the editor's machine.
import {Flags, immediateCommands, keywords} from "../tokens.js";

// BASIC IV's keyword table is BASIC II's with COLOR (the same token as COLOUR, which BASIC reads first) and EDIT
// added, each straight after the entry it follows in the ROM's table, since the first entry that matches is the one used.
const EditToken = 0xce;
export const ColorKeyword = {keyword: "COLOR", token: 251, flags: Flags.Middle};
const basicIVKeywords = keywords.flatMap(kw => [
    kw,
    ...(kw.keyword === "COUNT" ? [ColorKeyword] : []),
    ...(kw.keyword === "EXT" ? [{keyword: "EDIT", token: EditToken, flags: Flags.LineNumber}] : []),
]);

// What BASIC II's ROM does, which the recorded ROM rows and the oracle are checked against.
export const BasicIIDialect = Object.freeze({
    basicIV: false,
    keywords,
    immediateCommands,
    usColor: false,
});
// The editor's Model B: BASIC II, and a COLOR that starts a statement and can only be COLOUR is COLOUR (the recogniser
// decides which), as it is on the Master. The ROM says Mistake to that, so this is lenient on purpose (see the README).
export const ModelBDialect = Object.freeze({...BasicIIDialect, usColor: true});
export const BasicIVDialect = Object.freeze({
    basicIV: true,
    keywords: basicIVKeywords,
    immediateCommands: [...immediateCommands, "EDIT"],
    usColor: false,
});

/** The dialect of the BASIC that the model runs. */
export const dialectFor = model => (model.isMaster ? BasicIVDialect : ModelBDialect);
