// The tables of rows recorded from the ROM by record.mjs. Each table is a directory under test/rom, with one file per
// source (the issue or pull request a row was recorded for, as in 1234.json) and unsourced.json for rows without one,
// so that two pull requests that record rows never change the same file.
import fs from "fs";
import path from "path";
import prettier from "prettier";

export const Root = path.resolve(import.meta.dirname, "../..");
export const RowsDirectory = path.join(Root, "test", "rom");
export const Tables = ["verdicts", "verdicts-master", "tokens", "tokens-master"];
export const UnsourcedName = "unsourced";

const SourcePattern = /^#\d+$/;
const FilePattern = /^(unsourced|\d+)\.json$/;

export const rowSource = row => {
    const last = row[row.length - 1];
    return row.length > 2 && SourcePattern.test(last) ? last : null;
};
export const nameForSource = source => (source ? source.slice(1) : UnsourcedName);
const orderOf = name => (name === UnsourcedName ? -1 : Number(name));

export const tableDirectory = table => path.join(RowsDirectory, table);
export const fileFor = (table, name) => path.join(tableDirectory(table), `${name}.json`);

/** The files of a table as names without the extension, in the order its rows are read. */
export const tableNames = table => {
    const directory = tableDirectory(table);
    if (!fs.existsSync(directory)) return [];
    return fs
        .readdirSync(directory)
        .map(file => {
            if (!FilePattern.test(file))
                throw new Error(`${directory}: ${file} is not unsourced.json or NNN.json`);
            return file.slice(0, -".json".length);
        })
        .sort((a, b) => orderOf(a) - orderOf(b));
};

/** The rows of one file of a table. */
export const readFile = (table, name) => JSON.parse(fs.readFileSync(fileFor(table, name), "utf8"));

/** The rows of a table, a Map of file name to rows. */
export const readTable = table =>
    new Map(tableNames(table).map(name => [name, readFile(table, name)]));

/** All the rows of a table in file order. */
export const readRows = table => [...readTable(table).values()].flat();

/** Writes the files of a table from a Map of file name to rows, removing the files of names left empty or absent. */
export async function writeTable(table, files) {
    const directory = tableDirectory(table);
    fs.mkdirSync(directory, {recursive: true});
    for (const name of tableNames(table))
        if (!files.get(name)?.length) fs.rmSync(fileFor(table, name));
    for (const [name, rows] of files) {
        if (!rows.length) continue;
        const file = fileFor(table, name);
        const options = {...(await prettier.resolveConfig(file)), filepath: file};
        fs.writeFileSync(file, await prettier.format(JSON.stringify(rows), options));
    }
}
