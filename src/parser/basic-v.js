// BASIC V statements that BASIC II and IV stop at, each with the statements that do the same there (Olly Betts's list in
// mattgodbolt/owlet-editor#348). The replacements are written with the form's own argument names (X, Y, X2, Y2, R).
import {lexLine} from "./lexer.js";

export const BasicVFixCode = "basic-v-fix";

// A form comes before any that starts with its words (POINT BY before POINT).
// [form, replacement, what the form does, whether it needs the Master's (or GXR's) circle plotting]
const Statements = [
    ["OFF", "VDU 23,1,0;0;0;0;", "turns the cursor off"],
    ["ON", "VDU 23,1,1;0;0;0;", "turns the cursor on"],
    ["MOVE BY X,Y", "PLOT0,X,Y", "moves the graphics cursor relative to where it is"],
    ["DRAW BY X,Y", "PLOT1,X,Y", "draws a line relative to the graphics cursor"],
    ["POINT BY X,Y", "PLOT&61,X,Y", "plots a point relative to the graphics cursor"],
    ["POINT X,Y", "PLOT&65,X,Y", "plots a point"],
    ["ORIGIN X,Y", "VDU29,X;Y;", "sets the graphics origin"],
    ["LINE X,Y,X2,Y2", "MOVE X,Y:DRAW X2,Y2", "draws a line between two points"],
    ["CIRCLE FILL X,Y,R", "MOVE X,Y:PLOT&99,R,0", "draws a filled circle", true],
    ["CIRCLE X,Y,R", "MOVE X,Y:PLOT&91,R,0", "draws a circle", true],
].map(([form, replacement, means, needsBasicIV = false]) => {
    // The argument names are the last word of a form that has a comma.
    const words = form.split(" ");
    const names = words.at(-1).includes(",") ? words.pop().split(",") : [];
    // The lead must not run into a name or number, as in MOVE BY1,2 (a variable) or ORIGIN2.
    return {
        form,
        pattern: new RegExp(`^${words.join("\\s+")}(?![\\w$%\`])`),
        names,
        replacement,
        means,
        needsBasicIV,
    };
});

const isStatementEnd = token =>
    token.kind === "end" ||
    (token.kind === "punct" && token.text === ":") ||
    token.kw?.keyword === "ELSE";

// The arguments of a statement whose words end at `leadEnd`, split at the commas outside brackets, and where it ends; or
// null if it has arguments that cannot be told apart.
function readArguments(text, leadEnd, dialect) {
    const args = [];
    let argumentStart = leadEnd;
    let end = leadEnd;
    let depth = 0;
    for (const token of lexLine(text, dialect)) {
        if (token.start < leadEnd || token.kind === "white") continue;
        if (isStatementEnd(token)) break;
        const isOpener = token.text === "(" || token.kw?.keyword.endsWith("(");
        if (token.kind === "punct" && token.text === "," && depth === 0) {
            args.push(text.slice(argumentStart, end).trim());
            argumentStart = token.end;
        }
        if (isOpener) depth++;
        if (token.kind === "punct" && token.text === ")") depth--;
        end = token.end;
    }
    if (end > leadEnd || args.length > 0) args.push(text.slice(argumentStart, end).trim());
    return depth === 0 ? {args, end} : null;
}

/**
 * The quick fix for the BASIC V statement that starts at `start` in `text`, which BASIC II or IV stops at:
 * {start, end, text, title, explanation}, where `text` takes the place of the statement's text from `start` to `end`.
 * It is null if the statement is not one of BASIC V's, its arguments cannot be told apart, or `isValid(candidate,
 * from)` says the line with the replacement made still has an error.
 */
export function basicVFix(text, start, dialect, isValid) {
    const rest = text.slice(start);
    const statement = Statements.find(
        ({pattern, needsBasicIV}) => pattern.test(rest) && (dialect.basicIV || !needsBasicIV),
    );
    if (!statement) return null;
    const {form, names, means} = statement;
    const leadEnd = start + rest.match(statement.pattern)[0].length;
    const parsed = readArguments(text, leadEnd, dialect);
    if (!parsed || parsed.args.length !== names.length || parsed.args.includes("")) return null;
    const given = new Map(names.map((name, i) => [name, parsed.args[i]]));
    const replacement = statement.replacement.replace(/\b[XYR]2?\b/g, name => given.get(name));
    const candidate = text.slice(0, start) + replacement + text.slice(parsed.end);
    if (!isValid(candidate, start + replacement.length)) return null;
    const written = text.slice(start, parsed.end);
    return {
        start,
        end: parsed.end,
        text: replacement,
        title: `Replace ${written} with ${replacement}`,
        explanation: `BASIC V accepts ${form}, which ${means}; BASIC II and IV have no such statement, but ${statement.replacement} does the same`,
    };
}
