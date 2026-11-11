// A differential test of the highlighter against BBC BASIC II: generated statements are run on the real ROM (in
// jsbeeb, from the jsbeeb dependency's ROMs) and highlighted by src/bbcbasic.js, and the statements where the two
// disagree about whether there is a syntax error are reported, grouped by the shape of statement they came from.
//
//   node tools/rom-oracle/oracle.mjs [--seed N] [--count N] [--examples N] [--summary] [--input extra.json]
//
// --count is the number of random statements on top of the fixed set (every keyword at the start of a statement,
// abbreviated, misspelt...). --input adds statements from a JSON list of {shape, text}. --summary prints only the
// counts. Results go to .cache/rom-oracle/: the ROM's verdicts are cached there by statement, so a rerun after a
// grammar change only runs the highlighter (delete the directory after changing rom.mjs); results.json has every
// statement's verdicts.
//
// FALSE-VALID: the ROM reports a syntax error and nothing is highlighted as invalid. FALSE-INVALID: the ROM runs the
// statement without error and something is highlighted as invalid. A statement that stops with any other error (or
// runs too long) is inconclusive, since BASIC reads a statement only as far as it runs it. The ROM cannot judge
// what it skips (the rest of a line after REM, DATA, DEF or a false IF), so the generator leaves those out, along
// with * commands and the assembler. A disagreement is per statement: it does not say where the error is.
// Not run by npm test.
import {spawnSync} from "child_process";
import fs from "fs";
import path from "path";
import {fileURLToPath} from "url";
import {generate} from "./generate.mjs";
import {createRom, SyntaxErrors} from "./rom.mjs";

const Root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OutDir = path.join(Root, ".cache/rom-oracle");

function option(name, fallback) {
    const index = process.argv.indexOf(`--${name}`);
    if (index < 0) return fallback;
    return typeof fallback === "boolean" ? true : process.argv[index + 1];
}

function readJson(file, fallback) {
    try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (e) {
        return fallback;
    }
}

async function romVerdicts(texts) {
    const cacheFile = path.join(OutDir, "rom.json");
    const cache = readJson(cacheFile, {});
    const missing = [...new Set(texts.filter(text => !(text in cache)))];
    if (missing.length) {
        const rom = await createRom();
        const start = Date.now();
        for (const text of missing) cache[text] = await rom.run(text);
        rom.destroy();
        const seconds = (Date.now() - start) / 1000;
        console.log(
            `ROM: ${missing.length} statements in ${seconds.toFixed(1)}s (${Math.round(missing.length / seconds)}/s)`,
        );
        fs.writeFileSync(cacheFile, JSON.stringify(cache));
    }
    return texts.map(text => cache[text]);
}

function highlighterVerdicts(texts) {
    const input = path.join(OutDir, "highlight.in.json");
    const output = path.join(OutDir, "highlight.out.json");
    fs.writeFileSync(input, JSON.stringify(texts));
    const vitest = path.join(Root, "node_modules/vitest/vitest.mjs");
    const config = path.join(Root, "tools/rom-oracle/vitest.config.mjs");
    const result = spawnSync(process.execPath, [vitest, "run", "--config", config], {
        cwd: Root,
        env: {...process.env, ORACLE_IN: input, ORACLE_OUT: output},
        encoding: "utf8",
    });
    if (result.status !== 0)
        throw new Error(`Highlighting failed:\n${result.stdout}${result.stderr}`);
    return JSON.parse(fs.readFileSync(output, "utf8"));
}

function romClass(verdict) {
    if (verdict.timeout || (verdict.error !== null && !SyntaxErrors.has(verdict.error)))
        return "inconclusive";
    return verdict.error === null ? "valid" : "syntax error";
}

function report(results, examples) {
    const count = filter => results.filter(filter).length;
    const conclusive = results.filter(r => r.rom !== "inconclusive");
    const agree = count(
        r => r.rom !== "inconclusive" && (r.rom === "valid") === (r.invalid === null),
    );
    console.log(
        `${results.length} statements: ${conclusive.length} conclusive on the ROM ` +
            `(${count(r => r.rom === "valid")} valid, ${count(r => r.rom === "syntax error")} syntax errors), ` +
            `${count(r => r.rom === "inconclusive")} inconclusive`,
    );
    console.log(
        `Agreement on conclusive statements: ${agree}/${conclusive.length} ` +
            `(${((100 * agree) / conclusive.length).toFixed(1)}%)`,
    );
    const kinds = [
        [
            "FALSE-VALID (the ROM rejects it, nothing highlighted invalid)",
            r => r.rom === "syntax error" && !r.invalid,
        ],
        [
            "FALSE-INVALID (the ROM accepts it, highlighted invalid)",
            r => r.rom === "valid" && r.invalid,
        ],
    ];
    for (const [title, test] of kinds) {
        const wrong = results.filter(test);
        console.log(`\n${title}: ${wrong.length}`);
        const byShape = new Map();
        for (const r of wrong) byShape.set(r.shape, [...(byShape.get(r.shape) || []), r]);
        for (const [shape, rs] of [...byShape].sort((a, b) => b[1].length - a[1].length)) {
            const total = count(r => r.shape === shape && r.rom !== "inconclusive");
            console.log(
                `  ${String(rs.length).padStart(5)} of ${String(total).padEnd(5)} ${shape}`,
            );
            for (const r of rs.slice(0, examples)) {
                const why = r.invalid ? `invalid: ${JSON.stringify(r.invalid)}` : r.message;
                console.log(`          ${r.text.padEnd(32)} ${why}`);
            }
        }
    }
}

async function main() {
    fs.mkdirSync(OutDir, {recursive: true});
    const statements = generate({
        seed: Number(option("seed", 1)),
        count: Number(option("count", 3000)),
    });
    const extra = option("input", null);
    if (extra) statements.push(...readJson(extra, []));
    const texts = statements.map(s => s.text);
    const rom = await romVerdicts(texts);
    const highlighted = highlighterVerdicts(texts);
    const results = statements.map((s, i) => ({
        ...s,
        rom: romClass(rom[i]),
        message: rom[i].timeout ? "(timeout)" : rom[i].message || null,
        invalid: highlighted[i],
    }));
    fs.writeFileSync(path.join(OutDir, "results.json"), JSON.stringify(results, null, 1));
    report(results, option("summary", false) ? 0 : Number(option("examples", 3)));
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
