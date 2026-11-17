// Compares src/parser/lexer.js with BBC BASIC II's own tokeniser on random lines made of lexical pieces (keywords
// whole, abbreviated and cut short, numbers, names, punctuation, strings), and prints the lines where the bytes
// differ. Not run by npm test.
//
//   node tools/rom-oracle/lexfuzz.mjs [--seed N] [--count N] [--examples N] [--master]
import {BasicIVDialect, ModelBDialect} from "../../src/parser/dialect.js";
import {lexLine, romBytes} from "../../src/parser/lexer.js";
import {lexicalLines} from "./lexical-lines.mjs";
import {createRom} from "./rom.mjs";

function option(name, fallback) {
    const index = process.argv.indexOf(`--${name}`);
    return index < 0 ? fallback : Number(process.argv[index + 1]);
}

const master = process.argv.includes("--master");
const dialect = master ? BasicIVDialect : ModelBDialect;

const hex = bytes => bytes.map(b => b.toString(16).padStart(2, "0")).join(" ");

async function main() {
    const lines = lexicalLines(option("seed", 1), option("count", 5000), dialect);
    const rom = await createRom(master ? "Master" : undefined);
    const different = [];
    for (const line of lines) {
        // BASIC IV drops the spaces at the end of a line as it stores it.
        const stored = bytes => (master ? hex(bytes).replace(/( 20)+$/, "") : hex(bytes));
        const theirs = stored(await rom.tokenise(line));
        const ours = stored(romBytes(lexLine(line, dialect)));
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
