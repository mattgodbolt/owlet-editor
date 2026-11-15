// Compares the two tokenizers on a corpus of programs and times them, through Monaco as the editor runs them. Not run by
// npm test:
//
//   CORPUS=programs.json npx vitest run --config tools/rom-oracle/vitest.config.mjs tools/rom-oracle/corpus.mjs
//
// programs.json is a list of {id, text}. Every line on which the two give a character a different class is printed,
// grouped: marked invalid only by the new tokenizer (each one a false-invalid unless the ROM rejects it), only by the
// grammar, by both at different places, a line number that only one reads as such, and anything else.
import {registerBbcBasicLanguage, LanguageId} from "../../src/bbcbasic";
import {it} from "vitest";
import fs from "fs";
import {editor} from "monaco-editor/esm/vs/editor/editor.api";

const Classes = [
    ["invalid", "invalid"],
    ["keyword.oscli", "oscli"],
    ["keyword", "keyword"],
    ["constant.linenum", "linenum"],
    ["number", "number"],
    ["string", "string"],
    ["comment", "comment"],
    ["variable", "name"],
    ["type.identifier", "name"],
    ["white", "white"],
];
const classOf = type => Classes.find(([prefix]) => type.startsWith(prefix))?.[1] ?? "punct";

// The class of each character of each line.
function classes(text) {
    const lines = text.split("\n");
    return editor.tokenize(text, LanguageId).map((tokens, l) =>
        tokens.flatMap((token, i) => {
            const end = i + 1 < tokens.length ? tokens[i + 1].offset : lines[l].length;
            return Array(end - token.offset).fill(classOf(token.type));
        }),
    );
}

function median(run) {
    const times = [];
    for (let i = 0; i < 9; i++) {
        const start = performance.now();
        run();
        times.push(performance.now() - start);
    }
    return times.sort((a, b) => a - b)[4].toFixed(1);
}

function tokenizeAll(programs) {
    for (const {text} of programs) editor.tokenize(text, LanguageId);
}

it("compares the tokenizers on the corpus", () => {
    const programs = JSON.parse(fs.readFileSync(process.env.CORPUS, "utf8"));
    const longLine = "FORI=1TO9:PRINT A+B*(C-D);LEFT$(A$,2):NEXT:".repeat(160);
    const results = {};
    for (const parser of ["monarch", "new"]) {
        registerBbcBasicLanguage(parser);
        results[parser] = {
            classes: programs.map(({text}) => classes(text)),
            ms: {
                corpus: median(() => tokenizeAll(programs)),
                longLine: median(() => editor.tokenize(longLine, LanguageId)),
            },
        };
    }
    const groups = {
        "only new": [],
        "only grammar": [],
        "both, elsewhere": [],
        "line number": [],
        other: [],
    };
    let lines = 0;
    programs.forEach(({id, text}, p) => {
        text.split("\n").forEach((line, l) => {
            lines++;
            const before = results.monarch.classes[p][l];
            const after = results.new.classes[p][l];
            const at = before.findIndex((c, i) => c !== after[i]);
            if (at < 0) return;
            const flagged = [before.includes("invalid"), after.includes("invalid")];
            const group =
                flagged[1] && !flagged[0]
                    ? "only new"
                    : flagged[0] && !flagged[1]
                      ? "only grammar"
                      : flagged[0]
                        ? "both, elsewhere"
                        : [before[at], after[at]].includes("linenum")
                          ? "line number"
                          : "other";
            groups[group].push(
                `${id}:${l + 1} @${at} ${before[at]}->${after[at]}  ${JSON.stringify(line)}`,
            );
        });
    });
    console.log(`${programs.length} programs, ${lines} lines`);
    for (const [group, rows] of Object.entries(groups))
        console.log(`\n${group}: ${rows.length}\n${rows.join("\n")}`);
    console.log("\nmedian ms, grammar:", results.monarch.ms, "new:", results.new.ms);
    // Lines built to be slow, each about 7,000 characters, and doubled: the time should double too.
    const adversarial = {
        brackets: `X=${"(".repeat(3500)}1${")".repeat(3500)}`,
        nots: `X=${"NOT".repeat(2300)}1`,
        queries: `X=${"?".repeat(7000)}1`,
        ifs: "IF1".repeat(2300),
        repeats: "REPEAT".repeat(1100),
        signs: `X=1${"-1".repeat(3500)}`,
        strs: `X=${"STR$".repeat(1700)}1`,
        colons: ":".repeat(7000),
        prints: "P.".repeat(3500),
        elses: `IF1${"ELSE".repeat(1700)}`,
        asm: `[${"LDA #1:".repeat(1000)}`,
        comments: `[${"NOP ;x:".repeat(1000)}`,
    };
    for (const parser of ["monarch", "new"]) {
        registerBbcBasicLanguage(parser);
        for (const [name, line] of Object.entries(adversarial)) {
            const once = median(() => editor.tokenize(line, LanguageId));
            const twice = median(() => editor.tokenize(line + line, LanguageId));
            console.log(`${parser.padEnd(8)} ${name.padEnd(9)} ${once} ms, doubled ${twice} ms`);
        }
    }
});
