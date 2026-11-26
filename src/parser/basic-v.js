// BASIC V statements that BASIC II and IV stop at, each with the statements that do the same there (Olly Betts's list in
// mattgodbolt/owlet-editor#348). The replacements are written with the form's own argument names (X, Y, X2, Y2, R).
import {lexLine} from "./lexer.js";

export const BasicVFixCode = "basic-v-fix";

// A form comes before any that starts with its words (POINT BY before POINT).
// [form, replacement, what the form does, whether it needs the circle plotting of the Master or the GXR]
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
].map(([form, replacement, means, needsGxr = false]) => {
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
        needsGxr,
    };
});

const isStatementEnd = token =>
    token.kind === "end" ||
    (token.kind === "punct" && token.text === ":") ||
    token.kw?.keyword === "ELSE";

// The arguments of a statement whose words end at `leadEnd`, split at the commas outside brackets, and where it ends; or
// null if it has arguments that cannot be told apart.
function readArguments(text, source, leadEnd, dialect) {
    const args = [];
    let argumentStart = leadEnd;
    let end = leadEnd;
    let depth = 0;
    for (const token of lexLine(text, dialect)) {
        if (token.start < leadEnd || token.kind === "white") continue;
        if (isStatementEnd(token)) break;
        const isOpener = token.text === "(" || token.kw?.keyword.endsWith("(");
        if (token.kind === "punct" && token.text === "," && depth === 0) {
            args.push(source.slice(argumentStart, end).trim());
            argumentStart = token.end;
        }
        if (isOpener) depth++;
        if (token.kind === "punct" && token.text === ")") depth--;
        end = token.end;
    }
    if (end > leadEnd || args.length > 0) args.push(source.slice(argumentStart, end).trim());
    return depth === 0 ? {args, end} : null;
}

/**
 * The quick fix for the BASIC V statement that starts at `start` in `text`, which BASIC II or IV stops at:
 * {start, end, text, title, explanation}, where `text` takes the place of the statement's text from `start` to `end`.
 * It is null if the statement is not one of BASIC V's, its arguments cannot be told apart, or `isValid(candidate,
 * from)` says the line with the replacement made still has an error. `text` is the line as the lexer reads it, for
 * matching; `source` is the line as typed (the same length), which the edit copies from.
 */
export function basicVFix(text, start, dialect, isValid, source = text) {
    const rest = text.slice(start);
    const statement = Statements.find(
        ({pattern, needsGxr}) => pattern.test(rest) && (dialect.gxr || !needsGxr),
    );
    if (!statement) return null;
    const {form, names, means} = statement;
    const leadEnd = start + rest.match(statement.pattern)[0].length;
    const parsed = readArguments(text, source, leadEnd, dialect);
    if (!parsed || parsed.args.length !== names.length || parsed.args.includes("")) return null;
    const given = new Map(names.map((name, i) => [name, parsed.args[i]]));
    const replacement = statement.replacement.replace(/\b[XYR]2?\b/g, name => given.get(name));
    const candidate = source.slice(0, start) + replacement + source.slice(parsed.end);
    if (!isValid(candidate, start + replacement.length)) return null;
    const written = source.slice(start, parsed.end);
    return {
        start,
        end: parsed.end,
        text: replacement,
        title: `Replace ${written} with ${replacement}`,
        explanation: `BASIC V accepts ${form}, which ${means}; BASIC II and IV have no such statement, but ${statement.replacement} does the same`,
    };
}

// BASIC V's operators that BASIC II and IV stop at (mattgodbolt/owlet-editor#364), with what each does. Why += and -=
// have no fix is in docs/rom-deviations.md.
const Operators = {
    "<<": "shifts left",
    ">>": "shifts right, keeping the sign",
    ">>>": "shifts right, filling with zeros",
    "+=": "adds to the variable",
    "-=": "subtracts from the variable",
};

// On a string, BASIC V's += appends and its -= stops with Type mismatch (BASIC V 1.05, run by Olly Betts on #365).
const StringOperators = {"+=": "appends to the string"};

export function basicVOperator(operator, string = false) {
    const does = (string ? StringOperators : Operators)[operator];
    return does
        ? `BASIC V accepts ${operator}, which ${does}; BASIC II and IV have no such operator`
        : `BASIC V accepts ${operator} only for a number, and stops with Type mismatch on a string; BASIC II and IV have no such operator`;
}

// Keywords whose statement may set any name it has.
const BindingKeywords = new Set(["LOCAL", "INPUT", "READ", "DIM", "DEF"]);
const Boundaries = new Set(["THEN", "ELSE", "REPEAT"]);
const SetsAfterName = /\s*=/y;

// Whether the line may give the numeric variable BY a value: a `BY=` anywhere, whatever comes
// before it, since a statement can start after `ON ERROR` or an `IF` condition with no `THEN`, among other places (so
// a comparison `IF BY=1` counts too, as do `LET BY=1` and `FOR BY=1TO3`); a declaration or an input (`LOCAL`, `INPUT`,
// `READ`, `DIM`, a `DEF` parameter) naming it; or an assembler label `.BY`. It says yes where it cannot tell: a missed warning is better than
// a false one. An array `BY(`, `BY%` and `BY$` are other variables.
export function mayAssignBy(text, tokens) {
    let binding = false;
    for (const token of tokens) {
        if (token.kind === "white") continue;
        const word = token.kind === "keyword" ? token.kw.keyword : null;
        if (token.kind === "punct" && token.text === ":") binding = false;
        else if (word && Boundaries.has(word)) binding = false;
        if (word && BindingKeywords.has(word)) binding = true;
        if (token.kind === "label" && token.text === ".BY") return true;
        if (token.kind === "name" && token.text === "BY" && text[token.end] !== "(") {
            if (binding) return true;
            SetsAfterName.lastIndex = token.end;
            if (SetsAfterName.test(text) && text[SetsAfterName.lastIndex] !== "=") return true;
        }
    }
    return false;
}

// The warnings for the MOVE BY-x,y and DRAW BY-x,y statements of a program, {line, start, end, message, code, fix} for
// each: `lines` is each line's reading (the recogniser, with the moves it noted). BASIC II and IV read BY as a variable
// there, so the ROM accepts the statement, but it stops with No such variable unless the program sets BY somewhere,
// which the program is searched for once, and only if a move is there.
export function relativeMoveWarnings(lines) {
    let assigned = null;
    return lines.flatMap(({relativeMoves}, i) => {
        if (!relativeMoves.length) return [];
        if (assigned === null)
            assigned = lines.some(line => mayAssignBy(line.lexer.text, line.tokens));
        if (assigned) return [];
        return relativeMoves.map(({word, fix}) => {
            const {means} = Statements.find(({form}) => form === `${word} BY X,Y`);
            return {
                line: i + 1,
                start: fix.start,
                end: fix.end,
                code: BasicVFixCode,
                fix,
                message: `BASIC II and IV have no ${word} BY (BASIC V's ${word} BY ${means}), so BY is read as a variable, which nothing in this program sets, and BASIC will stop with No such variable; ${fix.text} does the same`,
            };
        });
    });
}
