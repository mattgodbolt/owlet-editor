import {registerBbcBasicLanguage, wordPatternFor} from "../src/bbcbasic";
import {BasicIVDialect, ModelBDialect} from "../src/parser/dialect";
import {lexLine} from "../src/parser/lexer";
import Examples from "../src/examples.yaml";
import {generate} from "../tools/rom-oracle/generate.mjs";
import {generateBasicIV} from "../tools/rom-oracle/generate-iv.mjs";
import {lexicalLines} from "../tools/rom-oracle/lexical-lines.mjs";
import {afterEach, describe, expect, it} from "vitest";
import {editor} from "monaco-editor/editor/editor.api";

const wordsOf = (text, dialect) => [...text.matchAll(wordPatternFor(dialect))].map(m => m[0]);

const isAbbreviation = token =>
    (token.kind === "keyword" && token.text !== token.kw.keyword) ||
    (token.kind === "name" && token.abbreviation);

// The offsets where the lexer reads a keyword in full, and where the word pattern finds one, outside the text that the
// pattern has no way to know about: a string, REM, DATA or * command, and an abbreviation with the name an abbreviated
// FN or PROC takes after it (a word never has a "." in it).
function keywordSpans(line, dialect) {
    const tokens = lexLine(line, dialect);
    const unknown = tokens.filter(
        (token, i) =>
            ["string", "comment", "data", "oscli"].includes(token.kind) ||
            isAbbreviation(token) ||
            (token.kind === "fnname" && isAbbreviation(tokens[i - 1])),
    );
    const lexer = tokens
        .filter(token => token.kind === "keyword" && token.text === token.kw.keyword)
        .map(({start, end}) => [start, end]);
    const pattern = [...line.matchAll(wordPatternFor(dialect))]
        .filter(
            match =>
                match.groups.keyword !== undefined &&
                !unknown.some(({start, end}) => match.index >= start && match.index < end),
        )
        .map(match => [match.index, match.index + match[0].length]);
    return {lexer, pattern};
}

const isPlainAscii = line => /^[ -~]*$/.test(line);

// Lines of our own, as the completions test takes them: the bundled examples, and the ROM oracle's generators (their
// exhaustive probes too, which are the most keyword-dense) with a fixed seed, and random lexical pieces.
const corpusFor = (dialect, generators) =>
    [
        ...Examples.examples.map(({basic}) => basic).filter(Boolean),
        ...generators.flatMap(generator => generator({seed: 1, count: 1500}).map(({text}) => text)),
    ]
        .flatMap(program => program.split("\n"))
        .concat(lexicalLines(1, 10000, dialect))
        .filter(isPlainAscii);

describe("The word pattern", () => {
    describe.each([
        ["BASIC II", ModelBDialect, [generate]],
        ["BASIC IV", BasicIVDialect, [generate, generateBasicIV]],
    ])("on %s", (_, dialect, generators) => {
        it("should find keywords where the lexer reads them", () => {
            const lines = corpusFor(dialect, generators);
            const differ = lines
                .map(line => ({line, ...keywordSpans(line, dialect)}))
                .filter(({lexer, pattern}) => JSON.stringify(lexer) !== JSON.stringify(pattern));
            expect(differ).toEqual([]);
            expect(lines.length).toBeGreaterThan(10000);
        });
    });

    it.each([
        ["10PRINT", ["10", "PRINT"]],
        ["PRINTLN12", ["PRINT", "LN", "12"]],
        ["PRINTA$", ["PRINT", "A$"]],
        // A name that BASIC reads in full after FN or PROC, or a keyword that is a name when a name character follows.
        ["PROCPRINTSCORE(1)", ["PROC", "PRINTSCORE", "1"]],
        ["X=FNEND+1", ["X", "FN", "END", "1"]],
        ["PROCa@b(1)", ["PROC", "a@b", "1"]],
        ["TIMER=ENDING", ["TIMER", "ENDING"]],
        // A "$" ends a name, and what follows "&" is hex digits.
        ["IFA$THEN", ["IF", "A$", "THEN"]],
        ["A=&FFTO9", ["A", "FF", "TO", "9"]],
    ])("should split %s into %j", (text, words) => {
        expect(wordsOf(text, BasicIVDialect)).toEqual(words);
        expect(wordsOf(text, ModelBDialect)).toEqual(words);
    });

    it("should split COLOR and EDIT on the Master only, where they are keywords", () => {
        expect(wordsOf("10COLOR1:EDIT10", BasicIVDialect)).toEqual([
            "10",
            "COLOR",
            "1",
            "EDIT",
            "10",
        ]);
        expect(wordsOf("10COLOR1:EDIT10", ModelBDialect)).toEqual(["10", "COLOR1", "EDIT10"]);
    });

    describe("in the editor", () => {
        afterEach(() => registerBbcBasicLanguage(ModelBDialect));

        const wordAt = (text, column) => {
            const model = editor.createModel(text, "BBCBASIC");
            try {
                return model.getWordAtPosition({lineNumber: 1, column})?.word;
            } finally {
                model.dispose();
            }
        };

        it("should follow the machine the editor is on", () => {
            registerBbcBasicLanguage(ModelBDialect);
            expect(wordAt("10EDIT20", 4)).toBe("EDIT20");
            registerBbcBasicLanguage(BasicIVDialect);
            expect(wordAt("10EDIT20", 4)).toBe("EDIT");
            expect(wordAt("10COLOR1", 4)).toBe("COLOR");
        });
    });
});
