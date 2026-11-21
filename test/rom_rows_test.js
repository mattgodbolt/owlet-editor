import fs from "fs";
import prettier from "prettier";
import {describe, expect, it} from "vitest";
import {
    Tables,
    allNames,
    fileFor,
    nameForSource,
    readFile,
    rowSource,
    tableDirectory,
    tableNames,
} from "../tools/rom-oracle/tables.mjs";

// The recorded rows are one file per source so that two pull requests recording rows never change the same lines;
// record.mjs writes this layout, and this checks that nobody has put a row anywhere else or written a file by hand.
describe("recorded ROM rows", () => {
    describe.each(Tables)("%s", table => {
        const names = tableNames(table);
        const sourceNames = allNames();

        it("has only files named for a source or a topic, or unsourced", () => {
            expect(fs.readdirSync(tableDirectory(table)).length).toBe(names.length);
            expect(names.length).toBeGreaterThan(0);
        });

        it.each(names)("keeps each row of %s in the file for its source", name => {
            const rows = readFile(table, name);
            expect(rows.length).toBeGreaterThan(0);
            expect(rows.filter(row => nameForSource(rowSource(row), sourceNames) !== name)).toEqual(
                [],
            );
        });

        it("has no statement twice", () => {
            const texts = names.flatMap(name => readFile(table, name).map(row => row[0]));
            expect(texts.filter((text, i) => texts.indexOf(text) !== i)).toEqual([]);
        });

        it("has its files as record.mjs writes them", async () => {
            const stale = [];
            for (const name of names) {
                const file = fileFor(table, name);
                const options = {...(await prettier.resolveConfig(file)), filepath: file};
                const canonical = await prettier.format(
                    JSON.stringify(readFile(table, name)),
                    options,
                );
                if (fs.readFileSync(file, "utf8") !== canonical) stale.push(name);
            }
            expect(stale).toEqual([]);
        });
    });
});
