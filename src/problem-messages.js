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
    "ON syntax": "GOTO, GOSUB or PROC",
    Index: "an array index",
};

const UnclosedBlock = "Assembler block not closed: there is no ] after this [";

// The keyword a name is the start of, if only one is: BASIC reads FO as a variable, not as FOR.
function keywordStartingWith(name) {
    const upper = name.toUpperCase();
    const found = keywords.filter(
        ({keyword}) => keyword.startsWith(upper) && /^[A-Z]+$/.test(keyword),
    );
    return name.length > 1 && found.length === 1 ? found[0].keyword : null;
}

// The text of a marker for a problem of the recogniser, plain words first and the ROM's own in brackets. `at` is the
// text the marker covers, `previous` the text of the token before it (null if none) and `statementName` true if that
// token is a name that begins the statement; `atEnd` is true if the statement ends straight after it.
export function problemMessage(
    {message, unfinished, hole, unclosed, stricter},
    {at, previous, atEnd, statementName},
) {
    if (unclosed) return UnclosedBlock;
    if (stricter) return message;
    const rom = message ? ` (BASIC: ${message})` : "";
    const needed = Needed[message];
    let plain;
    if (unfinished && !hole) {
        plain = needed ? `Expected ${needed} after ${at}` : `Unfinished after ${at}`;
    } else if (hole) {
        plain = needed ? `Expected ${needed} before ${at}` : `Unfinished before ${at}`;
    } else if (needed && atEnd && at !== ")") {
        plain = `Expected ${needed} after ${at}`;
    } else if (message === "Missing )" && at === ")") {
        plain = "Too many arguments before )";
    } else if (statementName) {
        const keyword = keywordStartingWith(previous);
        plain = `${previous} is read as a variable, so ${at} is not expected here${keyword ? `; did you mean ${keyword}?` : ""}`;
    } else {
        plain = needed ? `Expected ${needed} here, not ${at}` : `${at} is not expected here`;
    }
    return plain + rom;
}
