// Which BASIC the parser follows: BASIC II (the Model B's) or BASIC IV (the Master's). Each of the lexer, recogniser and
// assembler takes the dialect to read a line by, and the editor passes that of the machine it is on; the default where
// one is optional is the Model B's, and nothing here changes with the editor's machine.
import {Flags, isStatementKeyword, keywords, LastCommandToken} from "../tokens.js";

// BASIC IV's keyword table is BASIC II's with COLOR (the same token as COLOUR, which BASIC reads first) and EDIT
// added, each straight after the entry it follows in the ROM's table, since the first entry that matches is the one used.
const EditToken = 0xce;
export const ColorKeyword = {keyword: "COLOR", token: 251, flags: Flags.Middle};
const basicIVKeywords = keywords.flatMap(kw => [
    kw,
    ...(kw.keyword === "COUNT" ? [ColorKeyword] : []),
    ...(kw.keyword === "EXT" ? [{keyword: "EDIT", token: EditToken, flags: Flags.LineNumber}] : []),
]);

// The keywords BASIC takes as commands at its prompt, which are the tokens from AUTO up to the last command.
const commandsIn = (table, lastToken) =>
    table.filter(kw => isStatementKeyword(kw) && kw.token <= lastToken).map(kw => kw.keyword);
// The number after TRACE is a limit, not a line.
export const LimitKeyword = "TRACE";
// The keywords whose line number BASIC looks up when it runs them: those the ROM flags as taking one, but for the
// commands (the numbers they take need not be lines) and TRACE.
const lookedUpIn = (table, commands) =>
    new Set(
        table
            .filter(
                kw =>
                    kw.flags & Flags.LineNumber &&
                    kw.keyword !== LimitKeyword &&
                    !commands.includes(kw.keyword),
            )
            .map(kw => kw.keyword),
    );

const basicIICommands = commandsIn(keywords, LastCommandToken);
const basicIVCommands = commandsIn(basicIVKeywords, EditToken);

// What BASIC II's ROM does, which the recorded ROM rows and the oracle are checked against.
export const BasicIIDialect = Object.freeze({
    basicIV: false,
    keywords,
    immediateCommands: basicIICommands,
    lineNumberLookups: lookedUpIn(keywords, basicIICommands),
    onBranches: ["GOTO", "GOSUB"],
    usColor: false,
    gxr: false,
});
// The editor's Model B: BASIC II, and a COLOR that starts a statement and can only be COLOUR is COLOUR (the recogniser
// decides which), as it is on the Master. The ROM says Mistake to that, so this is lenient on purpose (see
// docs/rom-deviations.md).
// It has the GXR fitted, as the editor's Model B does unless the machine menu says otherwise, which gives it the circle
// plotting of PLOT; ModelBNoGxrDialect is the Model B without it.
export const ModelBDialect = Object.freeze({...BasicIIDialect, usColor: true, gxr: true});
export const ModelBNoGxrDialect = Object.freeze({...ModelBDialect, gxr: false});
export const BasicIVDialect = Object.freeze({
    basicIV: true,
    keywords: basicIVKeywords,
    immediateCommands: basicIVCommands,
    lineNumberLookups: lookedUpIn(basicIVKeywords, basicIVCommands),
    onBranches: ["GOTO", "GOSUB", "PROC"],
    usColor: false,
    gxr: true,
});

// Whether a statement can start with the keyword: a token from &C6 up, ELSE (which skips the rest of the line), or on
// BASIC IV EXT#, which sets the length of a file.
export const canStartStatement = (dialect, kw) =>
    isStatementKeyword(kw) || kw.keyword === "ELSE" || (dialect.basicIV && kw.keyword === "EXT");

/** The dialect of the BASIC that the model runs, and for a Model B whether it has the GXR ROM (the Master's is built in). */
export const dialectFor = (model, gxr = true) =>
    model.isMaster ? BasicIVDialect : gxr ? ModelBDialect : ModelBNoGxrDialect;
