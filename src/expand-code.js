import {decode} from "base2048";
import {ModelBDialect} from "./parser/dialect.js";
import {lexLine} from "./parser/lexer.js";
import {detokenise} from "./tokens.js";

// The text with each abbreviation written out, as BASIC's tokeniser reads it: not in a string, REM, DATA or * command,
// and not where a name or a conditional keyword's spelling continues.
export function debbreviate(text, dialect = ModelBDialect) {
    return text
        .split("\n")
        .map(line =>
            lexLine(line, dialect)
                .map(token =>
                    token.kind === "keyword" && !token.raw
                        ? token.kw.keyword
                        : line.slice(token.start, token.end),
                )
                .join(""),
        )
        .join("\n");
}

function decode2048(input) {
    try {
        let code = input.match(/🗜(\S*)/);
        // Without the clamp emoji, try decoding the whole lot, unless it is plain ASCII: "END" and "RUN" are
        // valid base2048, and real payloads are not ASCII.
        if (code === null && [...input].every(char => char.charCodeAt(0) < 0x80)) return input;
        code = code === null ? input : code[1];
        return String.fromCharCode.apply(null, decode(code.trim()));
    } catch (e) {
        return input;
    }
}

// fits says whether a line, as expanded, can still be tokenised: expanding can add a space (TIME before a name, say),
// which can push a full line over the limit, and then the line is left as it was.
export function expandCode(text, fits = () => true, dialect = ModelBDialect) {
    if (text !== decode2048(text)) {
        return decode2048(text);
    }
    const original = text.split("\n");
    const expanded = detokenise(debbreviate(text, dialect)).split("\n");
    if (original.length !== expanded.length) return expanded.join("\n");
    return expanded.map((line, i) => (fits(line) ? line : original[i])).join("\n");
}
