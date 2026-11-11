// Run by oracle.mjs through vitest, which gives Monaco the DOM it needs: tokenises each statement in ORACLE_IN and
// writes, for each, the text of its first invalid token (or null) to ORACLE_OUT.
import {registerBbcBasicLanguage} from "../../src/bbcbasic";
import {it} from "vitest";
import fs from "fs";
import {editor} from "monaco-editor/esm/vs/editor/editor.api";

it("highlights the oracle's statements", () => {
    registerBbcBasicLanguage();
    const texts = JSON.parse(fs.readFileSync(process.env.ORACLE_IN, "utf8"));
    const verdicts = texts.map(text => {
        const tokens = editor.tokenize(text, "BBCBASIC")[0];
        const index = tokens.findIndex(token => token.type.includes("invalid"));
        if (index < 0) return null;
        return text.slice(
            tokens[index].offset,
            index + 1 < tokens.length ? tokens[index + 1].offset : text.length,
        );
    });
    fs.writeFileSync(process.env.ORACLE_OUT, JSON.stringify(verdicts));
});
