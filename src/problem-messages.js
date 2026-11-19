import {keywords} from "./tokens";

// What the ROM's error says is missing, in plain words.
const Needed = {
    "No such variable": "a value",
    "Missing )": "a closing )",
    "Missing ,": "a comma",
    "Missing #": "a #",
    'Missing "': "a closing quote",
    "No TO": "TO",
    "Bad HEX": "a hex digit",
    "Bad Hex": "a hex digit",
};

const neededAfterOn = ({onBranches}) =>
    `${onBranches.slice(0, -1).join(", ")} or ${onBranches.at(-1)}`;

const UnclosedBlock = "Assembler block not closed: there is no ] after this [";

// The keyword a name is the start of, if only one is: BASIC reads FO as a variable, not as FOR. It reads BASIC II's
// table on purpose: BASIC IV adds only EDIT (immediate mode only) and COLOR, which is the same token as COLOUR, so
// COLOUR is the right suggestion for COLO on either.
function keywordStartingWith(name) {
    const upper = name.toUpperCase();
    const found = keywords.filter(
        ({keyword}) => keyword.startsWith(upper) && /^[A-Z]+$/.test(keyword),
    );
    return name.length > 1 && found.length === 1 ? found[0].keyword : null;
}

// The text of a marker for a problem of the recogniser, plain words first and the ROM's own in brackets. `at` is the
// text the marker covers, `previous` the text of the token before it (null if none) and `statementName` true if that
// token is a name that begins the statement.
export function problemMessage(
    {message, explanation, unfinished, hole, missingAfter, unclosed, stricter},
    {at, previous, statementName},
    dialect,
) {
    if (unclosed) return UnclosedBlock;
    if (stricter) return message;
    const rom = message ? ` (BASIC: ${message})` : "";
    if (explanation) return explanation + rom;
    const needed = message === "ON syntax" ? neededAfterOn(dialect) : Needed[message];
    let plain;
    if (hole) {
        plain = needed ? `Expected ${needed} before ${at}` : `Unfinished before ${at}`;
    } else if (needed && missingAfter) {
        plain = `Expected ${needed} after ${at}`;
    } else if (unfinished && !needed) {
        plain = `Unfinished after ${at}`;
    } else if (statementName) {
        const keyword = keywordStartingWith(previous);
        plain = `${previous} is read as a variable, so ${at} is not expected here${keyword ? `; did you mean ${keyword}?` : ""}`;
    } else {
        plain = needed ? `Expected ${needed} here, not ${at}` : `${at} is not expected here`;
    }
    return plain + rom;
}
