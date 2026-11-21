// The tables of rows recorded from the ROM by record.mjs. Each table is a directory under test/rom, with one file per
// source and unsourced.json for rows without one, so that two pull requests that record rows never change the same
// file. A source is a topic slug such as else-without-if (its file is else-without-if.json) or the issue or pull
// request a row was recorded for, such as #319. A file named for a topic and an issue, such as else-without-if-319.json,
// takes the rows whose source is #319, in every table that has one; without one, #319 goes in 319.json.
import fs from "fs";
import path from "path";
import prettier from "prettier";

export const Root = path.resolve(import.meta.dirname, "../..");
export const RowsDirectory = path.join(Root, "test", "rom");
export const Tables = ["verdicts", "verdicts-master", "tokens", "tokens-master"];
export const UnsourcedName = "unsourced";

const SlugPattern = /^[a-z][a-z0-9]*(-[a-z0-9]+)+$/;
const IssuePattern = /^#\d+$/;
const FilePattern = /^(unsourced|\d+|[a-z][a-z0-9]*(-[a-z0-9]+)+)\.json$/;

export const isSource = text => IssuePattern.test(text) || SlugPattern.test(text);

export const rowSource = row => {
    const last = row[row.length - 1];
    return row.length > 2 && isSource(last) ? last : null;
};

/** The file name, in any table, that rows with this source go in, given the names of the files that exist. */
export const nameForSource = (source, names) => {
    if (!source) return UnsourcedName;
    if (!IssuePattern.test(source)) return source;
    const issue = source.slice(1);
    return names.find(name => name === issue || name.endsWith(`-${issue}`)) ?? issue;
};

// The issue number a file name ends with orders the files, so that a file keeps its place when it is named for its topic.
const orderOf = name => (name === UnsourcedName ? -1 : Number(/\d+$/.exec(name)?.[0] ?? Infinity));

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
                throw new Error(
                    `${directory}: ${file} is not unsourced.json, NNN.json or a lowercase kebab-case topic name`,
                );
            return file.slice(0, -".json".length);
        })
        .sort((a, b) => orderOf(a) - orderOf(b) || (a < b ? -1 : a > b ? 1 : 0));
};

/** The file names of all the tables together, which is where a source with an issue number finds its file. */
export const allNames = () => [...new Set(Tables.flatMap(tableNames))];

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
