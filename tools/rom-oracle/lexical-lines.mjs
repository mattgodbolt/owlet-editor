// Random lines made of lexical pieces (keywords whole, abbreviated and cut short, numbers, names, punctuation, strings),
// for lexfuzz.mjs and for the tests that hold other readers of a line to the lexer.
import {mulberry32} from "./generate.mjs";
import {MaxLineLength} from "./rom.mjs";

export function lexicalLines(seed, count, dialect) {
    const names = [...new Set(dialect.keywords.map(kw => kw.keyword))];
    const random = mulberry32(seed);
    const pick = list => list[Math.floor(random() * list.length)];
    const cut = (word, extra) =>
        word.slice(0, 1 + Math.floor(random() * (word.length - 1 + extra)));
    const pieces = [
        () => pick(names),
        () => pick(names),
        () => `${cut(pick(names), 0)}.`,
        () => cut(pick(names), 1),
        () => pick(["1", "2.5", ".", "10", "1E", "1E5", "2E-3", ".5E", "&FF", "&", "&G", "1.2.3"]),
        () => pick(["A", "X", "E", "x", "foo", "_", "A1", "Z9", "@%", "P", "a$", "B%"]),
        () => pick([..."%$()=,:;+*<>~#?'[]!-.\\"]),
        () => pick([" ", " ", "  "]),
        () => pick(['"s"', '"', "TO", "THEN", "ELSE", "E", "P", "FN", "PROC", "REM", "D.", "*"]),
    ];
    const lines = [];
    while (lines.length < count) {
        let line = "";
        for (let n = 2 + Math.floor(random() * 6); n > 0; --n) line += pick(pieces)();
        // A line that starts with a number has its own line number, which BASIC does not keep in the line.
        if (!/^\s*\d/.test(line) && line.length < MaxLineLength) lines.push(line);
    }
    return lines;
}
