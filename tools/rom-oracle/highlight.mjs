// Run by oracle.mjs through vitest, which gives Monaco the DOM it needs: tokenises each statement in ORACLE_IN and
// writes, for each, its invalid tokens as [start, end] to ORACLE_OUT.
import {registerBbcBasicLanguage} from "../../src/bbcbasic";
import {it} from "vitest";
import fs from "fs";
import {editor} from "monaco-editor/esm/vs/editor/editor.api";

it("highlights the oracle's statements", () => {
    registerBbcBasicLanguage();
    const texts = JSON.parse(fs.readFileSync(process.env.ORACLE_IN, "utf8"));
    const invalid = texts.map(text => {
        const tokens = editor.tokenize(text, "BBCBASIC")[0];
        return tokens.flatMap((token, i) =>
            token.type.includes("invalid")
                ? [[token.offset, i + 1 < tokens.length ? tokens[i + 1].offset : text.length]]
                : [],
        );
    });
    fs.writeFileSync(process.env.ORACLE_OUT, JSON.stringify(invalid));
});
