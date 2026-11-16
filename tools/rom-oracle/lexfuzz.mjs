// Compares src/parser/lexer.js with BBC BASIC II's own tokeniser on random lines made of lexical pieces (keywords
// whole, abbreviated and cut short, numbers, names, punctuation, strings), and prints the lines where the bytes
// differ. Not run by npm test.
//
//   node tools/rom-oracle/lexfuzz.mjs [--seed N] [--count N] [--examples N]
import {keywords} from "../../src/tokens.js";
import {lexLine, romBytes} from "../../src/parser/lexer.js";
import {mulberry32} from "./generate.mjs";
import {createRom, MaxLineLength} from "./rom.mjs";

function option(name, fallback) {
    const index = process.argv.indexOf(`--${name}`);
    return index < 0 ? fallback : Number(process.argv[index + 1]);
}

const names = [...new Set(keywords.map(kw => kw.keyword))];

export function lexicalLines(seed, count) {
    const random = mulberry32(seed);
    const pick = list => list[Math.floor(random() * list.length)];
    const cut = (word, extra) =>
        word.slice(0, 1 + Math.floor(random() * (word.length - 1 + extra)));
    const pieces = [
        () => pick(names),
        () => pick(names),
        () => `${cut(pick(names), 0)}.`,
        () => cut(pick(names), 1),
        () => pick(["1", "2.5", ".", "10", "1E", "1E5", "2E-3", ".5E", "&FF", "&", "&G", "1.2.3"]),
        () => pick(["A", "X", "E", "x", "foo", "_", "A1", "Z9", "@%", "P", "a$", "B%"]),
        () => pick([..."%$()=,:;+*<>~#?'[]!-.\\"]),
        () => pick([" ", " ", "  "]),
        () => pick(['"s"', '"', "TO", "THEN", "ELSE", "E", "P", "FN", "PROC", "REM", "D.", "*"]),
    ];
    const lines = [];
    while (lines.length < count) {
        let line = "";
        for (let n = 2 + Math.floor(random() * 6); n > 0; --n) line += pick(pieces)();
        // A line that starts with a number has its own line number, which BASIC does not keep in the line.
        if (!/^\s*\d/.test(line) && line.length < MaxLineLength) lines.push(line);
    }
    return lines;
}

const hex = bytes => bytes.map(b => b.toString(16).padStart(2, "0")).join(" ");

async function main() {
    const lines = lexicalLines(option("seed", 1), option("count", 5000));
    const rom = await createRom();
    const different = [];
    for (const line of lines) {
        const theirs = hex(await rom.tokenise(line));
        const ours = hex(romBytes(lexLine(line)));
        if (theirs !== ours) different.push({line, theirs, ours});
    }
    rom.destroy();
    console.log(`${lines.length} lines, ${different.length} tokenised differently`);
    for (const {line, theirs, ours} of different.slice(0, option("examples", 20)))
        console.log(`${JSON.stringify(line)}\n    ROM:   ${theirs}\n    lexer: ${ours}`);
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
