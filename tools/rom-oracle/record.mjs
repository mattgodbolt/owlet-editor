// Records what BBC BASIC II does with each statement given, as rows appended to a table the tests read, so that no
// expected value is typed by hand.
//
//   node tools/rom-oracle/record.mjs [--tokens] [--source '#123'] [--file statements.txt] [statement ...]
//
// By default each row is [text, verdict] in test/rom-verdicts.json, where the verdict is the name of the syntax error
// the ROM stops with (as in rom.mjs) or "ok". A statement in [ ] is run as assembler after DIM P% 100:Q%=P%: and its
// row also has the bytes it assembled. A statement that stops with any other error, or runs too long, says nothing
// about syntax and is not recorded, nor is one that starts with a digit (BASIC would store it as a line). With
// --tokens each row is [text, bytes] in test/rom-tokens.json: the ROM's tokenisation of the text as a line of a
// program, in hex. --file reads one statement per line. --source ends each row with the issue or pull request it comes
// from, so that a report seen again is found as a row; a row already in the table keeps its verdict, and gets the
// source if it has none.
import fs from "fs";
import path from "path";
import {fileURLToPath} from "url";
import prettier from "prettier";
import {createRom, SyntaxErrors} from "./rom.mjs";

const hex = bytes => bytes.map(b => b.toString(16).padStart(2, "0")).join(" ");

const Root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const tokens = args.includes("--tokens");
const fileIndex = args.indexOf("--file");
const sourceIndex = args.indexOf("--source");
const source = sourceIndex < 0 ? null : args[sourceIndex + 1];
const isOptionValue = i => [fileIndex, sourceIndex].some(index => index >= 0 && i === index + 1);
const texts = args.filter((arg, i) => !arg.startsWith("--") && !isOptionValue(i));
if (fileIndex >= 0)
    texts.push(
        ...fs
            .readFileSync(args[fileIndex + 1], "utf8")
            .split("\n")
            .filter(Boolean),
    );
const tableFile = path.join(Root, "test", tokens ? "rom-tokens.json" : "rom-verdicts.json");

async function record(rom, text) {
    if (tokens) return [text, hex(await rom.tokenise(text))];
    if (/^\s*\d/.test(text)) return null;
    const verdict = await (text.startsWith("[") ? rom.assemble(text) : rom.run(text));
    if (verdict.timeout) return null;
    if (verdict.error === null)
        return verdict.bytes === undefined ? [text, "ok"] : [text, "ok", hex(verdict.bytes)];
    return SyntaxErrors.has(verdict.error) ? [text, SyntaxErrors.get(verdict.error)] : null;
}

async function main() {
    const table = fs.existsSync(tableFile) ? JSON.parse(fs.readFileSync(tableFile, "utf8")) : [];
    const known = new Map(table.map(row => [row[0], row]));
    const rom = await createRom();
    for (const text of texts) {
        if (known.has(text)) {
            const row = known.get(text);
            if (source && !row.slice(1).some(cell => cell.startsWith("#"))) row.push(source);
            console.log(`already recorded: ${JSON.stringify(row)}`);
            continue;
        }
        const row = await record(rom, text);
        if (!row) {
            console.log(`not recorded, the ROM gave no verdict on its syntax: ${text}`);
            continue;
        }
        if (source) row.push(source);
        console.log(JSON.stringify(row));
        table.push(row);
        known.set(text, row);
    }
    rom.destroy();
    const options = {...(await prettier.resolveConfig(tableFile)), filepath: tableFile};
    fs.writeFileSync(tableFile, await prettier.format(JSON.stringify(table), options));
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
