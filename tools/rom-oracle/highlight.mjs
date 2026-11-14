// Run by oracle.mjs through vitest, which gives Monaco the DOM it needs: tokenises each statement in ORACLE_IN and
// writes, for each, {invalid, unfinished} to ORACLE_OUT: its invalid tokens as [start, end], and the ends of the lines the
// new tokenizer takes to be unfinished.
import {registerBbcBasicLanguage} from "../../src/bbcbasic";
import {programProblems} from "../../src/parser/highlight";
import {it} from "vitest";
import fs from "fs";
import {editor} from "monaco-editor/esm/vs/editor/editor.api";

it("highlights the oracle's statements", () => {
    registerBbcBasicLanguage(process.env.ORACLE_PARSER);
    const texts = JSON.parse(fs.readFileSync(process.env.ORACLE_IN, "utf8"));
    const newParser = process.env.ORACLE_PARSER === "new";
    const verdicts = texts.map(text => {
        const tokens = editor.tokenize(text, "BBCBASIC")[0];
        const invalid = tokens.flatMap((token, i) =>
            token.type.includes("invalid")
                ? [[token.offset, i + 1 < tokens.length ? tokens[i + 1].offset : text.length]]
                : [],
        );
        const unfinished = newParser
            ? programProblems(text).flatMap(p => (p.unfinished ? [[p.start, p.end]] : []))
            : [];
        return {invalid, unfinished};
    });
    fs.writeFileSync(process.env.ORACLE_OUT, JSON.stringify(verdicts));
});
