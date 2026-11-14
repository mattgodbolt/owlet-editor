// Generates BBC BASIC statements for the oracle, each tagged with the shape it was built from. Every name a
// statement uses is defined by rom.mjs's prelude, so a ROM error means the statement, not a missing variable.
import {Flags, keywords} from "../../src/tokens.js";
import {MaxLineLength} from "./rom.mjs";

const Names = [...new Set(keywords.map(kw => kw.keyword))];
// Statements the ROM cannot judge in immediate mode, or that leave nothing to compare: REM and DATA skip the line,
// DEF is skipped when executed, ELSE at the start skips the rest of the line, and the * commands and assembler are outside the highlighter's BASIC grammar.
const Unjudged = new Set("REM|DATA|DEF|ELSE|AUTO|LIST|RENUMBER|DELETE|LOAD|SAVE|CHAIN".split("|"));
const NumVars = ["X", "Y", "Z", "X%", "A%", "X(1)", "X%(1)", "@%"];
const StrVars = ["X$", "A$", "X$(1)"];
const Numbers = ["7", ".7", "7.", ".", "7.5", "&FF", "&", "%101", "1E5", "1E", ".5E2", "7E-1"];
// Split on | and the white space around it, since some contain spaces.
const Functions =
    `ABS X | ABS(X) | SQR 4 | INT X | RND(1) | PI | TRUE | FNf | FNg(2) | LEN X$ | ASC X$
    | INSTR(X$,"a") | POS | VPOS | TIME | PAGE | SGN-1 | NOT X | -X | +X | ?D | D?1 | !D | EVAL"1"
    | VAL"2" | COUNT | ERL | ERR | INKEY0 | ADVAL0 | GET | USR&FFF4`.split(/\s*\|\s*/);
const StrFunctions =
    `STR$X | STR$~X | CHR$65 | MID$(X$,1) | LEFT$(X$,1) | RIGHT$(X$,1) | STRING$(2,X$) | GET$ | $D
    | "s" | """"`.split(/\s*\|\s*/);
const Arithmetic = ["+", "-", "*", "/", "^", " DIV ", " MOD "];
// BASIC compares only two values at a time: X<Y<Z is a syntax error, X<Y AND Y<Z is not.
const Relations = ["=", "<>", "<", ">", "<=", ">="];
const Logical = [" AND ", " OR ", " EOR "];
// What can follow a value directly: another value, or something that is not one. Merges are the pairs that would
// run together into one value without a space (7 and .7 are 7.7, X and (1) are X(1)).
const Glue = [".", ".7", "7.", "7", "X", '"s"', "(1)"];
const Merges = [
    [/[\d.]$/, /^[\d.]/],
    [/[\w%$]$/, /^[\w(]/],
    [/"$/, /^"/],
];

const ExprKeywords = new Set(keywords.filter(kw => kw.flags & Flags.Expr).map(kw => kw.keyword));
const kind = keyword =>
    ExprKeywords.has(keyword) ? "function or operator keyword" : "other keyword";

function mulberry32(seed) {
    return () => {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function* exhaustive() {
    for (const kw of Names.filter(name => !Unjudged.has(name))) {
        for (const tail of ["", "1", " X", "(1)", " X,1", "=1", "X=1", " TO 1"]) {
            yield {shape: `${kind(kw)} at statement start`, text: kw + tail};
        }
        for (const lead of ["X=", "PRINT ", "X=1+", "IF "]) {
            yield {
                shape: `keyword after ${lead.trim()}`,
                text: `${lead}${kw}${kw.endsWith("(") ? "1)" : ""}`,
            };
        }
        for (let i = 1; i < kw.length; ++i) {
            yield {shape: "abbreviation at statement start", text: `${kw.slice(0, i)}. X`};
            yield {shape: "abbreviation at statement start", text: `${kw.slice(0, i)}.`};
        }
        for (let i = 1; i < kw.length - 1; ++i) {
            const misspelt = kw.slice(0, i) + kw.slice(i + 1);
            yield {shape: "misspelt keyword", text: misspelt};
            yield {shape: "misspelt keyword", text: `${misspelt}.`};
        }
    }
    for (const name of ["X", "Z", "XY", "X%", "X$", "Q"]) {
        for (const tail of [".", ".7", ". ", ".X", " .", "=1.", "=X."]) {
            yield {shape: "name then dot at statement start", text: name + tail};
        }
    }
    for (const lead of ["PRINT ", "P.", "PRINT X;", 'PRINT "a"', "A$=", "A$=A$+"]) {
        for (const tilde of [
            "~",
            "~~",
            "~~~",
            "~ ~",
            "STR$~",
            "STR$~~",
            "STR$ ~~",
            "STR$~ ~",
            "STR.~~",
        ]) {
            yield {shape: "~ (hex) runs", text: `${lead}${tilde}42`};
        }
    }
    for (const n of Numbers) {
        yield {shape: "number form", text: `X=${n}`};
        yield {shape: "number form", text: `PRINT ${n}`};
    }
}

export function generate({seed = 1, count = 3000} = {}) {
    const random = mulberry32(seed);
    const pick = list => list[Math.floor(random() * list.length)];
    // At most one value directly followed by another per statement, so each disagreement has one cause.
    let adjacent = null;
    const operand = depth => {
        const r = random();
        if (r < 0.3) return pick(Numbers.filter(n => n !== "&" && n !== "%101"));
        if (r < 0.55) return pick(NumVars);
        if (r < 0.8 || depth > 1) return pick(Functions);
        return `(${expression(depth + 1)})`;
    };
    const glued = text => {
        if (adjacent || random() > 0.15) return text;
        adjacent = pick(Glue);
        const merges = Merges.some(([end, start]) => end.test(text) && start.test(adjacent));
        return text + (merges ? " " : "") + adjacent;
    };
    const sum = depth => {
        let text = glued(operand(depth));
        while (random() < 0.3) text += pick(Arithmetic) + glued(operand(depth));
        return text;
    };
    const relation = depth => sum(depth) + (random() < 0.2 ? pick(Relations) + sum(depth) : "");
    const expression = (depth = 0) => {
        let text = relation(depth);
        while (random() < 0.15) text += pick(Logical) + relation(depth);
        return text;
    };
    const stringExpression = () =>
        glued(pick(StrFunctions)) + (random() < 0.3 ? `+${pick(StrFunctions)}` : "");
    const printItem = () => (random() < 0.3 ? stringExpression() : expression());
    const printList = () => {
        let text = printItem();
        while (random() < 0.6) text += pick([";", ",", "'"]) + printItem();
        return text;
    };
    const templates = {
        assignment: () => `${pick(NumVars)}=${expression()}`,
        "string assignment": () => `${pick(StrVars)}=${stringExpression()}`,
        PRINT: () => `${pick(["PRINT ", "P.", "PRINT", "PRINT~"])}${printList()}`,
        VDU: () => `${pick(["VDU ", "V."])}${[expression(), expression()].join(pick([",", ";"]))}`,
        "statement with arguments": () => {
            const [keyword, arity] = pick([
                ["COLOUR", 1],
                ["MODE", 1],
                ["WIDTH", 1],
                ["GCOL", 2],
                ["MOVE", 2],
                ["DRAW", 2],
                ["PLOT", 3],
            ]);
            return `${keyword} ${Array.from({length: arity}, () => expression()).join(",")}`;
        },
        FOR: () =>
            `FOR I=${expression()} TO ${expression()}${random() < 0.3 ? ` STEP ${expression()}` : ""}`,
        "IF THEN": () => `IF ${pick(["1", "X", "TRUE"])} THEN ${pick(["", " "])}${statement()}`,
        "IF without THEN": () => `IF ${pick(["1", "X", "TRUE"])} ${statement()}`,
        // Only the line chosen is read, so there is just one.
        "ON GOTO": () =>
            `ON ${pick(["1", "X"])} ${pick(["GOTO", "GOSUB"])} ${pick(["10", "(10)", "10.", "X*10"])}`,
        "two statements": () => `${statement()}:${statement()}`,
        "memory assignment": () => `${pick(["?D", "!D", "D?1", "D!1", "$D"])}=${expression()}`,
        "procedure call": () => (random() < 0.2 ? "PROCp" : `PROCq(${expression()})`),
        "INPUT/READ": () =>
            `${pick(["INPUT ", "READ ", 'INPUT"?"', "INPUT LINE "])}${pick([...NumVars, ...StrVars])}`,
        "unterminated string": () => pick(['PRINT "abc', 'X$="abc', 'PRINT "a";"b', 'X$="a""b']),
    };
    const simple = [
        "assignment",
        "string assignment",
        "PRINT",
        "VDU",
        "statement with arguments",
        "memory assignment",
        "procedure call",
    ];
    const statement = () => templates[pick(simple)]();
    const out = [...exhaustive()];
    const names = Object.keys(templates);
    for (let i = 0; i < count; ++i) {
        let shape, text;
        do {
            adjacent = null;
            shape = pick(names);
            text = templates[shape]();
        } while (text.length > MaxLineLength);
        out.push({shape: adjacent ? `${shape}, one value directly after another` : shape, text});
    }
    return out;
}
