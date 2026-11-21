// Records what BBC BASIC II does with each statement given, as rows added to a table the tests read, so that no
// expected value is typed by hand. A table is a directory under test/rom with a file per --source, so that pull
// requests recording different rows change different files (see tables.mjs).
//
//   node tools/rom-oracle/record.mjs [--tokens] [--hex] [--master] [--source '#123'] [--file statements.txt] [statement ...]
//
// --master runs them on the Master's BASIC IV and keeps the rows in test/rom/verdicts-master and
// test/rom/tokens-master, the tables for the parser's BASIC IV rules.
//
// By default each row is [text, verdict] in test/rom/verdicts, where the verdict is the name of the syntax error
// the ROM stops with (as in rom.mjs) or "ok". A statement in [ ] is run as assembler after DIM P% 100:Q%=P%: and its
// row also has the bytes it assembled. A statement that stops with any other error, or runs too long, says nothing
// about syntax and is not recorded, nor is one that starts with a digit (BASIC would store it as a line). With
// --hex gives each statement (and each --file line) as the hex bytes BASIC is to read, such as '53 54 8d 20 39', for
// bytes of 0x80 and above, which the shell would turn into U+FFFD; the row's text is those bytes as Owlet shows them
// (U+0100 plus the byte for a control, DEL or token byte below 0xA0), which the ROM reads back as the same bytes. With
// --tokens each row is [text, bytes] in test/rom/tokens: the ROM's tokenisation of the text as a line of a
// program, in hex. --file reads one statement per line. --source ends each row with where it comes from and keeps it
// in the file of that name, so that a report seen again is found as a row and rows from different pull requests do
// not conflict; give one. It is a topic in lowercase words joined by hyphens, such as --source else-without-if, which
// keeps the rows in else-without-if.json (name the issue too, as else-without-if-319, to find its history), or an issue
// or pull request such as '#319', which keeps them in the file of the topic ending -319 if there is one, else in
// 319.json. A row already in the table keeps its verdict, and gets the source if it has none.
import fs from "fs";
import {createRom, SyntaxErrors} from "./rom.mjs";
import {allNames, isSource, nameForSource, readTable, rowSource, writeTable} from "./tables.mjs";

const hex = bytes => bytes.map(b => b.toString(16).padStart(2, "0")).join(" ");
const owletRawByte = b => (b < 0x20 || (b >= 0x7f && b < 0xa0) ? b + 0x100 : b);
const fromHex = text => {
    const digits = text.trim().split(/\s+/);
    if (!digits.every(digit => /^[0-9a-f]{2}$/i.test(digit)))
        throw new Error(`Not two-digit hex bytes: ${text}`);
    return String.fromCharCode(...digits.map(digit => owletRawByte(parseInt(digit, 16))));
};

const args = process.argv.slice(2);
const tokens = args.includes("--tokens");
const master = args.includes("--master");
const asHex = args.includes("--hex");
const fileIndex = args.indexOf("--file");
const sourceIndex = args.indexOf("--source");
const source = sourceIndex < 0 ? null : args[sourceIndex + 1];
if (source !== null && !isSource(source))
    throw new Error(
        `--source is a topic such as 'else-without-if' (lowercase words joined by hyphens) or an issue or pull request such as '#123': ${source}`,
    );
const isOptionValue = i => [fileIndex, sourceIndex].some(index => index >= 0 && i === index + 1);
const texts = args.filter((arg, i) => !arg.startsWith("--") && !isOptionValue(i));
if (fileIndex >= 0)
    texts.push(
        ...fs
            .readFileSync(args[fileIndex + 1], "utf8")
            .split("\n")
            .filter(Boolean),
    );
if (asHex) texts.forEach((text, i) => (texts[i] = fromHex(text)));
const table = `${tokens ? "tokens" : "verdicts"}${master ? "-master" : ""}`;

async function record(rom, text) {
    if (tokens) return [text, hex(await rom.tokenise(text))];
    if (/^\s*\d/.test(text)) return null;
    const verdict = await (text.startsWith("[") ? rom.assemble(text) : rom.run(text));
    if (verdict.timeout) return null;
    if (verdict.error === null)
        return verdict.bytes === undefined ? [text, "ok"] : [text, "ok", hex(verdict.bytes)];
    if (!SyntaxErrors.has(verdict.error)) return null;
    return [text, master ? verdict.message : SyntaxErrors.get(verdict.error)];
}

async function main() {
    const files = readTable(table);
    const known = new Map(
        [...files].flatMap(([name, rows]) => rows.map(row => [row[0], {name, row}])),
    );
    const names = allNames();
    const rom = await createRom(master ? "Master" : undefined);
    const add = (name, row) => files.set(name, [...(files.get(name) ?? []), row]);
    for (const text of texts) {
        if (known.has(text)) {
            const {name, row} = known.get(text);
            if (source && !rowSource(row)) {
                files.set(
                    name,
                    files.get(name).filter(other => other !== row),
                );
                row.push(source);
                add(nameForSource(source, names), row);
            }
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
        const name = nameForSource(source, names);
        add(name, row);
        known.set(text, {name, row});
    }
    rom.destroy();
    await writeTable(table, files);
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
