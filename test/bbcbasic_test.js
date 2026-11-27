import {
    codeActionProviderFor,
    getSyntaxMarkers,
    withoutCodes,
    getWarnings,
    LanguageId,
    rebuildBracketPairs,
    registerBbcBasicLanguage,
} from "../src/bbcbasic";
import {
    BasicIIDialect,
    BasicIVDialect,
    dialectFor,
    ModelBDialect,
    ModelBNoGxrDialect,
} from "../src/parser/dialect";
import {mnemonicsFor} from "../src/parser/assembler";
import {problemCount} from "../src/problem-count";
import {highlightLine, readLines} from "../src/parser/highlight";
import {keywords, tokenChar} from "../src/tokens";
import {falseInvalid, masterVerdicts, RomTokens, verdicts} from "./rom-tables";
import {describe, it} from "vitest";
import assert from "assert";
import {editor, MarkerSeverity, Range} from "monaco-editor/editor/editor.api";

registerBbcBasicLanguage(ModelBDialect);

// Each line's tokens as {offset, type}, neighbours of the same type joined, an open assembler block carrying on.
function tokenLines(text) {
    let inAssembler = false;
    return text.split("\n").map(line => {
        const result = highlightLine(line, ModelBDialect, inAssembler);
        inAssembler = result.inAssembler;
        return result.tokens.filter((t, i, all) => i === 0 || t.type !== all[i - 1].type);
    });
}

// Each line's tokens, as "offset:type" separated by spaces.
function tokens(text) {
    return tokenLines(text).map(line => line.map(t => `${t.offset}:${t.type}`).join(" "));
}

// The source text of each token of the given type, on every line.
function spans(text, type) {
    const lines = text.split("\n");
    return tokenLines(text).flatMap((line, l) =>
        line.flatMap((t, i) =>
            t.type === type
                ? [lines[l].slice(t.offset, i + 1 < line.length ? line[i + 1].offset : undefined)]
                : [],
        ),
    );
}

// [start, end] of each token of the given type in a one-line text.
function spanRanges(text, type) {
    const line = tokenLines(text)[0];
    return line.flatMap((t, i) =>
        t.type === type ? [[t.offset, i + 1 < line.length ? line[i + 1].offset : text.length]] : [],
    );
}

// Each bracket Monaco finds, as [column, isUnmatched].
function brackets(text) {
    const model = editor.createModel(text, LanguageId);
    try {
        model.tokenization.forceTokenization(model.getLineCount());
        return model.bracketPairs
            .getBracketsInRange(model.getFullModelRange())
            .toArray()
            .map(b => [b.range.startColumn, b.isInvalid]);
    } finally {
        model.dispose();
    }
}

// The columns of each ) shown as having no (: by Monaco, or by the tokenizer as an invalid token.
const unmatched = text => [
    ...brackets(text).flatMap(([column, invalid]) => (invalid ? [column] : [])),
    ...spanRanges(text, "invalid").flatMap(([start]) => (text[start] === ")" ? [start + 1] : [])),
];

const openers = keywords.filter(kw => kw.keyword.endsWith("(")).map(tokenChar);

function checkWarnings(text, ...expected) {
    assert.deepStrictEqual(
        getWarnings(text, ModelBDialect),
        expected.map(x => ({
            severity: MarkerSeverity.Warning,
            ...x,
            startLineNumber: 1,
            endLineNumber: 1,
        })),
        text,
    );
}

const romTokens = new Map(RomTokens);

// Checks that the ROM backs the marks the tokenizer makes on a text it rejects: the text, or for one that cannot be a
// row of the table the rows given, is a recorded row, and nothing the ROM runs is red. A line the ROM runs backs a mark
// only in text it never reads (ON ERROR 30 reads the 30 only after an error).
function backedByRom(text, ...rows) {
    for (const row of rows.length ? rows : [text]) {
        assert.ok(verdicts.has(row) || romTokens.has(row), `${row} is not a recorded row`);
        if (verdicts.get(row) === "ok") assert.strictEqual(row, text, `${row} runs on the ROM`);
    }
    if (verdicts.has(text))
        assert.deepStrictEqual(
            falseInvalid(text, spanRanges(text, "invalid"), verdicts, BasicIIDialect),
            [],
            text,
        );
}

const caseWarning = (keyword, startColumn) => ({
    message: `BASIC keywords should be upper case, did you mean ${keyword}?`,
    code: "lowercase-keyword",
    startColumn,
    endColumn: startColumn + keyword.length,
});

describe("Tokenisation", () => {
    describe("keywords and names", () => {
        it("should read keywords, abbreviations and tokens that abut each other as keywords", () => {
            for (const text of [
                "PRINT",
                "CALL",
                "RESTORE",
                "PRINTLEN",
                "P.LEN",
                "P.",
                "C.",
                "R.",
                "TIME",
            ])
                assert.deepStrictEqual(tokens(text), ["0:keyword"], text);
            assert.deepStrictEqual(tokens("PRINTA$"), ["0:keyword 5:variable"]);
            assert.deepStrictEqual(tokens("IFVALA$PRINTA$.1"), [
                "0:keyword 5:variable 7:keyword 12:variable 14:number.float",
            ]);
            assert.deepStrictEqual(tokens("TIME r"), ["0:keyword 4:white 5:invalid"]);
            backedByRom("TIME r");
        });
        it("should read names with a type suffix", () => {
            for (const text of ["A%", "X%", "LONGVAR%", "@%", "LDA"])
                assert.deepStrictEqual(tokens(text), ["0:variable"], text);
            assert.deepStrictEqual(tokens("N=1"), ["0:variable 1:operator 2:number"]);
            assert.deepStrictEqual(tokens("N%=1"), ["0:variable 2:operator 3:number"]);
            assert.deepStrictEqual(tokens("N$ = 1"), [
                "0:variable 2:white 3:operator 4:white 5:number",
            ]);
        });
        it("should allow $ in abbreviated tokens, but only before a literal dot", () => {
            assert.deepStrictEqual(tokens('P.STRING$.2,"HO")'), [
                "0:keyword 10:number 11:operator 12:string.quote 13:string 15:string.quote 16:delimiter.parenthesis",
            ]);
            for (const text of ["A$=LEFT$A$", "A$=MID$X"])
                assert.deepStrictEqual(spans(text, "keyword"), [], text);
        });
        it("should not treat BG as an abbreviation without the dot", () => {
            // BGET abbreviates to B., BG. and BGE. but plain BG is just a variable.
            for (const text of ["BG=1", "BG%=2", 'BG$=""'])
                assert.deepStrictEqual(spans(text, "keyword"), [], text);
            assert.deepStrictEqual(spans("A=BG.#1", "keyword"), ["BG."]);
            assert.deepStrictEqual(spans("A=BG.#1", "symbol"), ["#"]);
        });
        it("should not read a conditional keyword, or its abbreviation, before a letter or digit", () => {
            assert.deepStrictEqual(tokens("TIMER"), ["0:variable"]);
            // See #36. An abbreviation stands for the first keyword in the table with that prefix (B. is BGET, R. is
            // RETURN), so it is conditional if that keyword is, whatever later keywords share the prefix. BASIC reads
            // _ as a letter here.
            const names =
                "H.TO H._ TI._X B.X BG.X BP.X CLO.X EO.X PT.X E.X EN.X ER.X O.X R.X RE.X".split(
                    " ",
                );
            for (const text of names) {
                assert.deepStrictEqual(tokens(text), ["0:invalid"], text);
                backedByRom(text);
            }
            for (const text of ["A=B. #X", "R.:", "RE.", "P.X", "I.X", "F.X", "D.X", "REP.X"])
                assert.deepStrictEqual(spans(text, "invalid"), [], text);
        });
        it("should read a keyword and a dot as the abbreviation of an earlier keyword it begins", () => {
            // END. is ENDPROC, MOD. is MODE and so on, since those come first in the table.
            for (const text of ["END.", "ON ERR.", "A=GET.", "A=INKEY.5"])
                assert.deepStrictEqual(
                    spans(text, "keyword").slice(-1),
                    [text.match(/[A-Z]+\./)[0]],
                    text,
                );
            assert.deepStrictEqual(tokens("END.X"), ["0:invalid"]);
            assert.deepStrictEqual(tokens("A=8MOD.3"), [
                "0:variable 1:operator 2:number 3:invalid",
            ]);
            backedByRom("END.X");
            backedByRom("A=8MOD.3");
            assert.deepStrictEqual(spans("A=8MOD 3", "keyword"), ["MOD"]);
        });
        it("should allow FN and PROC names starting with a digit", () => {
            assert.deepStrictEqual(tokens("DEFFN3D PROC1to1:PRO.2too:=FN42"), [
                "0:keyword 5:variable 7:white 8:keyword 12:variable 16:symbol 17:keyword 21:variable 25:symbol 26:operator 27:keyword 29:variable",
            ]);
        });
        it("should allow @ anywhere in an FN or PROC name, as the ROM does, but not in a variable's", () => {
            // #373: every row here is recorded from both ROMs (at-in-names-373).
            const cases = [
                ["PROC@", ["@"]],
                ["PROC@a", ["@a"]],
                ["PROCa@", ["a@"]],
                ["PROCa@b(1)", ["a@b"]],
                ["PROC@:X=1", ["@"]],
                ["X=FN@", ["@"]],
                ["X=FN@+1", ["@"]],
                ["X=FNa@b(1)", ["a@b"]],
                ["DEF PROC@", ["@"]],
                ["DEF PROCa@b(A)", ["a@b"]],
                ["DEF FN@=7", ["@"]],
                ["DEF FNa@b(A)=A", ["a@b"]],
            ];
            for (const [text, names] of cases) {
                assert.deepStrictEqual(spans(text, "invalid"), [], text);
                assert.strictEqual(verdicts.get(text), "ok", text);
                assert.strictEqual(masterVerdicts.get(text), "ok", text);
                backedByRom(text);
                const tokenised = highlightLine(text, ModelBDialect, false).tokens;
                for (const name of names) {
                    const at = text.indexOf(name);
                    assert.strictEqual(
                        tokenised.find(t => t.offset === at)?.type,
                        "variable",
                        `${name} in ${text}`,
                    );
                }
            }
            // The ROM stops at the % here (a Syntax error), so the % is what is marked.
            for (const text of ["PROC@%", "X=FN@%"]) {
                assert.strictEqual(verdicts.get(text), "Syntax error", text);
                assert.deepStrictEqual(spans(text, "invalid"), ["%"], text);
            }
        });
        it("should highlight a keyword that cannot start a statement", () => {
            // See #151, checked on the ROM, where each invalid case is a syntax error.
            const cases = [
                ['ERROR5,"x"', ["ERROR5,"]],
                ["RND(-TIME)", ["RND(-TIME)"]],
                ["STEP1", ["STEP1"]],
                ["TOOMUCH=1", ["TOOMUCH=1"]],
                ["A=1:ABS A", ["ABS A"]],
                ["IF A THEN TO", ["TO"]],
                ["IF 0 THEN 10 ELSE FNf", ["FNf"]],
                ["A.", ["A."]],
                ["10 THEN", ["THEN"]],
                ["\u0185", ["\u0185"]],
                // PTR, PAGE and TIME as functions (tokens &8F, &90, &91) cannot start a statement, their statement
                // forms can.
                ["\u018f#0=1", ["\u018f#0=1"]],
                ["\u0190=1", ["\u0190=1"]],
                ["\xcf#0=1", []],
                ["\xd0=1", []],
                ["ON ERROR OFF", []],
                ['ON ERROR PRINT "x"', []],
                ["TIME=0", []],
                ["PTR#0=0:HIMEM=HIMEM", []],
                ["ELSE", ["ELSE"]],
                ["IF 1 THEN ELSE", []],
                ["RNDX=1", []],
                ["MODE 7", []],
            ];
            for (const [text, invalid] of cases)
                assert.deepStrictEqual(spans(text, "invalid"), invalid, text);
            backedByRom("\u018f#0=1");
        });
    });

    describe("numbers", () => {
        it("should read integers, decimals and exponents", () => {
            const floats = [
                "123.450",
                "1.",
                ".5",
                ".",
                "123.450E-1",
                "2E4",
                "9E+",
                "9E-",
                "9.E+",
                ".9E-",
                ".E-",
            ];
            // After A= so as not to be a line number.
            for (const [text, type] of [
                ["123450", "number"],
                ...floats.map(n => [n, "number.float"]),
            ])
                assert.deepStrictEqual(
                    tokens(`A=${text}`),
                    [`0:variable 1:operator 2:${type}`],
                    text,
                );
            // See #26.
            // The tokeniser reads E4TO22400STEP100 as a name, so BASIC finds no TO.
            assert.deepStrictEqual(tokens("FORJ%=2E4TO22400STEP100"), [
                "0:keyword 3:variable 5:operator 6:number.float 9:invalid",
            ]);
            backedByRom("FORJ%=2E4TO22400STEP100");
            assert.deepStrictEqual(tokens("P.$.114338E6"), ["0:keyword 2:operator 3:number.float"]);
        });
        it("should read a dot after a value as a number only where one value can follow another", () => {
            // See #85, #149, #150 and #162, checked on the ROM: PRINT, VDU and INPUT take one value directly after
            // another, so P.X. prints X and then 0, but Y=X.7 is a syntax error and Z. is a Mistake. A number may end
            // in an empty exponent, as 1E does.
            assert.deepStrictEqual(tokens("P.X.\nY=X.7\nPRIT."), [
                "0:keyword 2:variable 3:number.float",
                "0:variable 1:operator 2:variable 3:invalid",
                "0:variable 4:invalid",
            ]);
            const cases = [
                ["PRINT X.7", []],
                ["V.X.", []],
                ["VDU X.7,1", []],
                ["INPUT X.", ["."]],
                ["I.X.7", [".7"]],
                ["A=BGET##1", ["#1"]],
                ['PRINT "a".5', []],
                ["PRINT STR$(1);.5", []],
                ["VDU1,2.5", []],
                ["IF 0 THEN P.X. ELSE P.Y.", []],
                ["X=Y.5", [".5"]],
                ["Z.", ["."]],
                ["X%=X%.5", [".5"]],
                ["x=x.5", [".5"]],
                ["FOR I=1 TO X.", ["."]],
                ["FOR I=X. TOP", [". TOP"]],
                ["A=X. TO", [". TO"]],
                ["IF X. THEN PRINT", [". THEN PRINT"]],
                ["COLOUR X.", ["."]],
                ["PRINT#X.,1", [".,1"]],
                ["INPUT#X.,Y", [".,Y"]],
                ["P.X.:Y=X.", ["."]],
                ["PRINT 1E.5", []],
                ["VDU 1E.5", []],
                ["P.1E.X", []],
                ["PRINT 1.5E.5 +1", []],
                ["PRINT 5.E.5:", []],
                ["PRINT 1E.5ERL", []],
                ["PRINT 1E+.5", []],
                ["PRINT 1E .5", []],
            ];
            for (const [text, invalid] of cases)
                assert.deepStrictEqual(spans(text, "invalid"), invalid, text);
        });
    });

    describe("TOP and ~", () => {
        it("should treat TO followed by P as the single keyword TOP", () => {
            assert.deepStrictEqual(spans("PRINT TOP", "keyword"), ["PRINT", "TOP"]);
            assert.deepStrictEqual(spans("PRINT TOP", "variable"), []);
            assert.deepStrictEqual(spans("A=TOP+1", "keyword"), ["TOP"]);
            assert.deepStrictEqual(spans("X=TOP-PAGE", "keyword"), ["TOP", "PAGE"]);
            assert.deepStrictEqual(spans("[LDA #TOP MOD 256", "keyword"), ["LDA", "TOP", "MOD"]);
            assert.deepStrictEqual(spans("[LDA #TOP MOD 256", "invalid"), []);
        });
        it("should read TO P in a FOR statement as the loop's TO unless an operand is expected", () => {
            // Each case's variables, then its keywords if they are not just FOR, TOP and TO.
            const cases = [
                // The first TOP is the function, the second is TO then the variable P.
                ["F.P=TOP TOP:P.P:N.", ["P", "P", "P"], ["F.", "TOP", "TO", "P.", "N."]],
                ["FOR I=1 TO P", ["I", "P"], ["FOR", "TO"]],
                ["FOR I=1TOP", ["I", "P"], ["FOR", "TO"]],
                ["FOR I=(TOP) TO TOP+1", ["I"], ["FOR", "TOP", "TO", "TOP"]],
                ["FOR I=A+TOP TO P STEP 2", ["I", "A", "P"], ["FOR", "TOP", "TO", "STEP"]],
                // The FOR statement ends at a colon.
                ["FOR I=1 TO 2:PRINT TOP", ["I"], ["FOR", "TO", "PRINT", "TOP"]],
                // After a keyword that takes an operand, TOP is still the function.
                ["FOR I=ABS TOP TO TOP", ["I"], ["FOR", "ABS", "TOP", "TO", "TOP"]],
                ["FOR I=AB. TOP TO TOP", ["I"], ["FOR", "AB.", "TOP", "TO", "TOP"]],
                ["FOR I=AB.TOP TO TOP", ["I"]],
                ["FOR I=XY.TOP", ["I", "XY"]],
                ["FOR I=1 AND TOP TO 2", ["I"], ["FOR", "AND", "TOP", "TO"]],
                // Abbreviated and raw token forms, checked against the ROM by running them.
                ["FO.I=TOP TO TOP+1", ["I"], ["FO.", "TOP", "TO", "TOP"]],
                ["\xe3I=\xb8P \xb8 \xb8P+1", ["I"], ["\xe3", "\xb8P", "\xb8", "\xb8P"]],
                ["\xe3P=\xb8P \xb8P:\xf1P", ["P", "P", "P"]],
                ["\xe3I=\u0194\xb8P \xb8 \xb8P", ["I"]],
            ];
            for (const [text, variables, keywordSpans] of cases) {
                assert.deepStrictEqual(spans(text, "variable"), variables, text);
                if (keywordSpans)
                    assert.deepStrictEqual(spans(text, "keyword"), keywordSpans, text);
            }
        });
        it("should only allow ~ in PRINT items and after STR$", () => {
            const valid = [
                ["PRINT ~A", 1],
                ["PRINT ~A,~B", 2],
                ["PRINT A;~B", 1],
                ["PRINT'~A", 1],
                ["P.~A", 1],
                ['PRINT "x"~A', 1],
                ["PRINT A$+STR$~A", 1],
                ["PRINT STR$ ~A", 1],
                ["A$=STR$~(A)", 1],
                ["A$=STR.~A", 1],
                ["IF A THEN PRINT ~A ELSE PRINT ~B", 2],
                ["P.STR.~255", 1],
                ["\xf1\xc3~255", 1],
                ["A$=\xc3~255", 1],
                ["PRINT ~TOP-TOP", 1],
                ["P.~~42", 2],
                ["P.~~~42", 3],
                ["P.STR$~42", 1],
            ];
            for (const [text, count] of valid) {
                assert.deepStrictEqual(spans(text, "invalid"), [], text);
                assert.strictEqual(
                    spans(text, "operator").join("").split("~").length - 1,
                    count,
                    text,
                );
            }
            const invalid = [
                ["A=~B", "~B"],
                ["A$=STR$(~12)", "~12)"],
                ["A$=\xc3(~1)", "~1)"],
                ["PRINT#0,~A", "~A"],
                ["INPUT ~A", "~A"],
                ["VDU ~A", "~A"],
                ["PRINT 1+~A", "~A"],
                ["PRINT (~A)", "~A)"],
                ["PRINT TAB(~A)", "~A)"],
                ["PRINT ~A:B=~A", "~A"],
                ["PRINT !~A", "~A"],
                ["PRINT ?~A", "~A"],
                ["PRINT ;-~B", "~B"],
                ["PRINT A AND ~B", "~B"],
                ["PRINT A MOD~B", "~B"],
                ["~", "~"],
                // See #152: STR$ takes one ~, though PRINT takes any number.
                ["P.STR$~~42", "~42"],
                ["A$=STR$~~42", "~42"],
                ["P.STR.~~42", "~42"],
            ];
            for (const [text, red] of invalid)
                assert.deepStrictEqual(spans(text, "invalid"), [red], text);
        });
    });

    describe("examples from the issues", () => {
        // Each is a line someone reported (the number is the issue or pull request), with its tokens; the ROM's
        // verdict on it, or on the statement it comes from, is a row of test/rom/verdicts with the same number.
        it("should read each as reported", () => {
            const cases = [
                ["#26", "Z%=2E4", "0:variable 2:operator 3:number.float"],
                [
                    "#27",
                    "P.1.,.5,.",
                    "0:keyword 2:number.float 4:operator 5:number.float 7:operator 8:number.float",
                ],
                [
                    "#28",
                    "A%=@%:@%=A%",
                    "0:variable 2:operator 3:variable 5:symbol 6:variable 8:operator 9:variable",
                ],
                ["#37", "*FX19:PRINT", "0:keyword.oscli.string"],
                ["#37", "*.:0", "0:keyword.oscli.string"],
                [
                    "#41",
                    "P.'\"a\"'@%''TIME'",
                    "0:keyword 2:operator 3:string.quote 4:string 5:string.quote 6:operator 7:variable 9:operator 11:keyword 15:operator",
                ],
                ["#43", "D.http://bbcmic.ro", "0:keyword 2:string.unquoted"],
                ["#45", "PRINT TOP", "0:keyword 5:white 6:keyword"],
                [
                    "#45",
                    "F.P=TOP TOP:P.P:N.",
                    "0:keyword 2:variable 3:operator 4:keyword 7:white 8:keyword 10:variable 11:symbol 12:keyword 14:variable 15:symbol 16:keyword",
                ],
                [
                    "#45",
                    "FORP=TOP-TOP TOP+TOP/TOP:N.",
                    "0:keyword 3:variable 4:operator 5:keyword 8:operator 9:keyword 12:white 13:keyword 15:variable 16:operator 17:keyword 20:operator 21:keyword 24:symbol 25:keyword",
                ],
                ["#52", 'P."A"X', "0:keyword 2:string.quote 3:string 4:string.quote 5:variable"],
                ["#62", "PRINTQ.1", "0:keyword 5:variable 6:number.float"],
                ["#83", "*KEY0PAGE=4608|MO.|MRU.|M", "0:keyword.oscli.string"],
                ["#83", "*LOAD P.DAT", "0:keyword.oscli.string"],
                [
                    "#85",
                    "@%=0:X=1:P.X.",
                    "0:variable 2:operator 3:number 4:symbol 5:variable 6:operator 7:number 8:symbol 9:keyword 11:variable 12:number.float",
                ],
                [
                    "#85",
                    "X=42:V.X.",
                    "0:variable 1:operator 2:number 4:symbol 5:keyword 7:variable 8:number.float",
                ],
                ["#112", "ONERROR*HELP", "0:keyword 7:keyword.oscli.string"],
                ["#112", "IF0EL.*H.", "0:keyword 2:number 3:keyword 6:keyword.oscli.string"],
                ["#112", "ONERR.*HELP", "0:keyword 6:keyword.oscli.string"],
                [
                    "#140",
                    "ri=42:P.ri.",
                    "0:variable 2:operator 3:number 5:symbol 6:keyword 8:variable 10:number.float",
                ],
                [
                    "#144",
                    "FOR I=AB. TOP TO 9:N.",
                    "0:keyword 3:white 4:variable 5:operator 6:keyword 9:white 10:keyword 13:white 14:keyword 16:white 17:number 18:symbol 19:keyword",
                ],
                ["#149", "Y=X.7", "0:variable 1:operator 2:variable 3:invalid"],
                ["#150", "Z.", "0:variable 1:invalid"],
                ["#150", "PRIT.", "0:variable 4:invalid"],
                ["#152", "P.STR$~~42", "0:keyword 6:operator 7:invalid"],
                ["#152", "A$=STR$~~42", "0:variable 2:operator 3:keyword 7:operator 8:invalid"],
                ["#156", "\xf2p", "0:keyword 1:variable"],
                ["#156", "\xdd\xf2x", "0:keyword 2:variable"],
                // A line number BASIC has already encoded.
                ["#161", "\xe5\u018dTJ@", "0:keyword 1:constant.linenum"],
                [
                    "#74",
                    "\xe4\u018dTJ@:\xe5\u018dTT@:\xf4OK",
                    "0:keyword.string 1:constant.linenum 5:symbol 6:keyword 7:constant.linenum 11:symbol 12:keyword 13:comment",
                ],
                ["#167", "[lda42,X", "0:delimiter.square 1:keyword 4:number 6:symbol 7:keyword"],
                [
                    "#170",
                    "Q$=MID$(Q$,2)+STR$(Q%)",
                    "0:variable 2:operator 3:keyword 7:delimiter.parenthesis 8:variable 10:operator 11:number 12:delimiter.parenthesis 13:operator 14:keyword 18:delimiter.parenthesis 19:variable 21:delimiter.parenthesis",
                ],
                [
                    "#170",
                    "Q$=\xc1Q$,2)+\xc3(Q%)",
                    "0:variable 2:operator 3:keyword 4:variable 6:operator 7:number 8:delimiter.parenthesis 9:operator 10:keyword 11:delimiter.parenthesis 12:variable 14:delimiter.parenthesis",
                ],
                [
                    "#170",
                    "Q$=MI.Q$,2)+STR.(Q%)",
                    "0:variable 2:operator 3:keyword 6:variable 8:operator 9:number 10:delimiter.parenthesis 11:operator 12:keyword 16:delimiter.parenthesis 17:variable 19:delimiter.parenthesis",
                ],
            ];
            for (const [source, text, expected] of cases)
                assert.deepStrictEqual(tokens(text), [expected], `${source} ${text}`);
            for (const text of ["\xe5\u018dTJ@", "\xe4\u018dTJ@:\xe5\u018dTT@:\xf4OK"])
                backedByRom(text);
        });
        it("should mark nothing in the lines reported as wrongly red", () => {
            for (const text of [
                "\xe440:\xf4 wrongly highlighted as invalid", // #156
                "\xe0:\xf4 wrongly highlighted as invalid",
                "\xf8",
                "\xe22,3,2,-4,4,50,50,50,127,0,0,0,126,0:\xf4 wrongly highlighted as invalid",
                "\xe1:\xf4 wrongly highlighted as invalid",
                'MO.4:F.R=2TOLEN"\xff@W\u0197\u0187\xc3\xc3\xe1\xe1\xf0\xe0\xf0\xe0\xf0\u0180<lf\xba\u0199\xaaf\u0100B":?8=R?7180:?9=R:F.X=1TO9:MOVE(X*2OR1A.R)*40,R*40+?8MOD2*@%:P."\u0105\u0119\u0199\u0100\u0100\u011c\u0100":!6=!6/2:N.,:V.1', // #23
                "F.A=H. TO8^5:?A=42:N.", // #30
                'A$="OWLET":P.RI.A$,1)LE.A$,2)MI.A$,4,1)MI.A$,3,1)', // #114
                "P.LE.A$,1)", // #160
                "PRINTLE.A$,1)",
                "P.LENMI.A$,2)",
                "DIM tab(2):P.tab(1)", // #140
                'READ A$:DATA "abc\nP.1', // #138
            ])
                assert.deepStrictEqual(spans(text, "invalid"), [], text);
        });
    });

    describe("statements", () => {
        it("should read the rest of the line after REM as a comment", () => {
            for (const text of [
                "REM a comment with PRINT in it",
                "REM a comment:PRINT",
                "REMthis too",
            ])
                assert.deepStrictEqual(tokens(text), ["0:keyword 3:comment"], text);
            assert.deepStrictEqual(tokens("REM\nPRINT"), ["0:keyword", "0:keyword"]);
        });
        it("should suitably highlight DATA statements", () => {
            const lines = [
                "DATA",
                "D.a b,c",
                "DA.,,,7,",
                "DAT.PI,COS0,SQRLN@%",
                'DATA3 ,"comma,quoted", "esc""ape", qu"te,q", 3x',
            ];
            assert.deepStrictEqual(tokens(lines.join("\n")), [
                "0:keyword",
                "0:keyword 2:string.unquoted 5:symbol 6:string.unquoted",
                "0:keyword 3:symbol 6:string.unquoted 7:symbol",
                "0:keyword 4:string.unquoted 6:symbol 7:string.unquoted 11:symbol 12:string.unquoted",
                "0:keyword 4:string.unquoted 5:white 6:symbol 7:string.quote 8:string 20:string.quote 21:symbol 22:white 23:string.quote 24:string 27:string.quote 29:string 32:string.quote 33:symbol 34:white 35:string.unquoted 40:symbol 41:string.unquoted 43:symbol 44:white 45:string.unquoted",
            ]);
        });
        it("should start each line afresh, whatever ended the line before", () => {
            const firsts = [
                'A$="ABC',
                'DATA "abc',
                'D.1,"x',
                "10PRINT",
                "20PRINT ",
                "30INPUT",
                "PROC",
                "A=FN",
                "A=1 ",
            ];
            for (const first of firsts) {
                assert.deepStrictEqual(
                    tokens([first, "10X=1", "*FX15"].join("\n")).slice(1),
                    ["0:constant.linenum 2:variable 3:operator 4:number", "0:keyword.oscli.string"],
                    first,
                );
            }
            assert.deepStrictEqual(spans('DATA "abc', "string"), ['"abc']);
            assert.deepStrictEqual(spans('D.1,"x', "string"), ['"x']);
        });
        it("should read a * command where a statement starts", () => {
            const cases = [
                ["*INFO", "*INFO"],
                ["10 *INFO", "*INFO"],
                ["P.2*3:*.0:blah", "*.0:blah"],
                ...[
                    "IF1THEN",
                    "IF1THE.",
                    "IF1TH.",
                    "\xe71\u018c",
                    "IF0ELSE",
                    "IF0ELS.",
                    "IF0EL.",
                    "\xe70\u018b",
                ].map(statement => [`${statement}*H.`, "*H."]),
                ...["ONERROR", "ONERRO.", "ONERR.", "\xee\u0185"].map(statement => [
                    `${statement}*H.`,
                    "*H.",
                ]),
                ...["REPEAT ", "REP. ", "REPEA.", "\xf5 "].map(statement => [
                    `${statement}*|`,
                    "*|",
                ]),
                ["REPEAT **", "**"],
                ["REPEAT *FX 0", "*FX 0"],
                ["REPEAT X=X*2", null],
            ];
            for (const [text, command] of cases) {
                assert.deepStrictEqual(
                    spans(text, "keyword.oscli.string"),
                    command ? [command] : [],
                    text,
                );
                assert.deepStrictEqual(spans(text, "invalid"), [], text);
            }
        });
        it("should read as line numbers the numbers that BASIC's RENUMBER renumbers, but not after ERROR", () => {
            // Each checked by RENUMBER on BBC BASIC II.
            const cases = [
                ["IF A THEN 30 ELSE 40", ["30", "40"]],
                ["IF A TH.30 EL.40", ["30", "40"]],
                ["IFX THEN200ELSE210", ["200", "210"]],
                ["GOTO 20:GOSUB 30:G.40:GOS.50:\xe550", ["20", "30", "40", "50", "50"]],
                ["ON X GOTO 10,20 , 30 ELSE 40", ["10", "20", "30", "40"]],
                ["ON ERROR GOTO 70:RESTORE 60:TRACE 130", ["70", "60", "130"]],
                [
                    "LIST 230:AUTO 240:DELETE 10,20:RENUMBER 10,20",
                    ["230", "240", "10", "20", "10", "20"],
                ],
                // BASIC stops at the first token that is not part of the list.
                ["GOTO 10*2:GOTO 150+10:GOTO 230 10:GOTO 10 ,, 20", ["10", "150", "230", "10"]],
                ["GOTO 10;20:GOTO 10.5,20:GOTO 10E2,20:GOTO -10,20", ["10", "10", "10"]],
                ["GOTO &10,20", []],
                ["ON X GOTO 10,X,20:GOTO (220):GOTO A%*10", ["10"]],
                ["X=1:250:REPEAT 20:PRINT 170", []],
                ["ON X GOTO 240,250 ELSE PRINT 260", ["240", "250"]],
                ['PRINT "GOTO 80":REM GOTO 80\nDATA 90\n*FX 140', []],
            ];
            for (const [text, lineNumbers] of cases)
                assert.deepStrictEqual(spans(text, "constant.linenum"), lineNumbers, text);
            // The 30 is read only after an error.
            for (const [text, expected] of [
                ["ON ERROR 30", "0:keyword 2:white 3:keyword 8:white 9:invalid"],
                ['ERROR 5,"x"', "0:invalid 8:invalid.string"],
                ["ON ERR. 30", "0:keyword 2:white 3:keyword 7:white 8:invalid"],
                ["\xee\u0185 30", "0:keyword 2:white 3:invalid"],
            ]) {
                assert.deepStrictEqual(tokens(text), [expected], text);
                backedByRom(text);
            }
            assert.deepStrictEqual(tokens("GOTO 10*2:GOTO 150+10:GOTO 230 10:GOTO 10 ,, 20"), [
                "0:keyword 4:white 5:constant.linenum 7:invalid 9:symbol 10:keyword 14:white 15:constant.linenum 18:invalid 21:symbol 22:keyword 26:white 27:constant.linenum 30:white 31:invalid 33:symbol 34:keyword 38:white 39:constant.linenum 41:white 42:invalid",
            ]);
            backedByRom("GOTO 10*2:GOTO 150+10:GOTO 230 10:GOTO 10 ,, 20");
        });
    });

    describe("strings, symbols and operators", () => {
        it("should handle symbols and operators", () => {
            for (const text of ["!", "="])
                assert.deepStrictEqual(tokens(text), ["0:operator"], text);
            for (const text of ["^", "'"]) {
                assert.deepStrictEqual(tokens(text), ["0:invalid"], text);
                backedByRom(text);
            }
            assert.deepStrictEqual(tokens(":"), ["0:symbol"]);
            assert.deepStrictEqual(tokens("#"), ["0:invalid"]);
            assert.deepStrictEqual(tokens("DEFFNmain:{=0}"), [
                "0:keyword 5:variable 9:symbol 10:invalid",
            ]);
            backedByRom("DEFFNmain:{=0}");
        });
        it("should handle # operator where valid", () => {
            const cases = [
                [
                    "P. #X,D$:CLOSE#X",
                    "0:keyword 2:white 3:symbol 4:variable 5:operator 6:variable 8:symbol 9:keyword 14:symbol 15:variable",
                ],
                [
                    "INPUT#X,A,B$",
                    "0:keyword 5:symbol 6:variable 7:operator 8:variable 9:operator 10:variable",
                ],
                ["U.EOF# Y", "0:keyword 5:symbol 6:white 7:variable"],
                [
                    "c=BGET# (channel)",
                    "0:variable 1:operator 2:keyword 6:symbol 7:white 8:delimiter.parenthesis 9:variable 16:delimiter.parenthesis",
                ],
                ["BP.#N,32", "0:keyword 3:symbol 4:variable 5:operator 6:number"],
                ["P.EXT#C%", "0:keyword 5:symbol 6:variable"],
                [
                    "PTR#f=PT.#f+4",
                    "0:keyword 3:symbol 4:variable 5:operator 6:keyword 9:symbol 10:variable 11:operator 12:number",
                ],
            ];
            for (const [text, expected] of cases)
                assert.deepStrictEqual(tokens(text), [expected], text);
        });
        it("should read strings, and an unterminated one as unfinished", () => {
            assert.deepStrictEqual(tokens('P.""C1'), ["0:keyword 2:string.quote 4:variable"]);
            assert.deepStrictEqual(tokens('P."\nP."TEST\nP."ESC""APE\nP."OK"'), [
                "0:keyword 2:string.quote",
                "0:keyword 2:string.quote 3:string",
                "0:keyword 2:string.quote 3:string 6:string.quote 8:string",
                "0:keyword 2:string.quote 3:string 5:string.quote",
            ]);
        });
        it("should highlight invalid operators from other languages", () => {
            const cases = [
                ["INVALID=1==2OR8!=2**3", "0:variable 7:operator 8:number 9:invalid"],
                ["IFA><1ORB=<2ORB=>6GOTO10", "0:keyword 2:variable 3:invalid"],
                ["A+=2", "0:variable 1:invalid"],
                ["A=B<<C OR D>>E", "0:variable 1:operator 2:variable 3:invalid"],
            ];
            for (const [text, expected] of cases) {
                assert.deepStrictEqual(tokens(text), [expected], text);
                backedByRom(text);
            }
        });
    });

    describe("assembler", () => {
        it("should recognise 6502 inside []", () => {
            const cases = [
                [
                    "0[\n1LDA#42",
                    [
                        "0:constant.linenum 1:delimiter.square",
                        "0:constant.linenum 1:keyword 4:symbol 5:number",
                    ],
                ],
                [
                    "[LDA(&70,X)",
                    [
                        "0:delimiter.square 1:keyword 4:delimiter.parenthesis 5:number.hex 8:symbol 9:keyword 10:delimiter.parenthesis",
                    ],
                ],
                [
                    "[STA(&80),Y",
                    [
                        "0:delimiter.square 1:keyword 4:delimiter.parenthesis 5:number.hex 8:delimiter.parenthesis 9:symbol 10:keyword",
                    ],
                ],
                ["[ORA@%,X", ["0:delimiter.square 1:keyword 4:variable 6:symbol 7:keyword"]],
                ["[\nOPTN%", ["0:delimiter.square", "0:keyword.directive 3:variable"]],
                [
                    "[\nEQUB LENA$",
                    ["0:delimiter.square", "0:keyword.directive 4:white 5:keyword 8:variable"],
                ],
                // The tokeniser makes no keyword inside a name, so FN is not one here.
                ["[\nEQUSFNx", ["0:delimiter.square", "0:keyword.directive 4:variable"], "EQUSFNx"],
                [
                    "[ROR 80\\comment:ROR80\\comment:]P.",
                    [
                        "0:delimiter.square 1:keyword 4:white 5:number 7:comment 15:symbol 16:keyword 19:number 21:comment 29:symbol 30:delimiter.square 31:keyword",
                    ],
                ],
                // ; starts no comment, and each line starts a new statement.
                ["[;notacomment", ["0:delimiter.square 1:invalid"], "[OPT0:;notacomment:]"],
                [
                    "[NOP \\ a\n;notacomment",
                    ["0:delimiter.square 1:keyword 4:white 5:comment", "0:invalid"],
                    "[OPT0:;notacomment:]",
                ],
            ];
            for (const [text, expected, row] of cases) {
                assert.deepStrictEqual(tokens(text), expected, text);
                if (row) backedByRom(text, row);
            }
        });
        it("should highlight tokens invalid in assembler", () => {
            const text = [
                "[LDA CLEAR+CLG+CLS+DEF+ENDPROC+END+LINE+NEW+OLD+OFF",
                "STA RETURN+REPEAT+REPORT+RUN+STEP+SPC+STOP+TO+TAB(1):]",
            ].join("\n");
            // BASIC stops at the first, and what follows it is as wrong.
            assert.deepStrictEqual(tokens(text), [
                "0:delimiter.square 1:keyword 4:white 5:invalid",
                "0:keyword 3:white 4:invalid 52:symbol 53:delimiter.square",
            ]);
            backedByRom(text, "[OPT0:LDA CLEAR:]");
            // The raw END token is tagged as a string too, which keeps it out of bracket matching.
            assert.deepStrictEqual(tokens("[\nLDA #\u00e0\n]"), [
                "0:delimiter.square",
                "0:keyword 3:white 4:symbol 5:invalid.string",
                "0:delimiter.square",
            ]);
            backedByRom("[\nLDA #\u00e0\n]", "[OPT0:LDA #END:]");
        });
        it("should treat a \\ comment as text up to the next colon, whatever it says", () => {
            for (const comment of [
                "LOAD THE ACCUMULATOR",
                "END OF LOOP",
                "the FOR loop",
                "IF EQUAL THEN",
                '"x',
                "]",
            ])
                assert.deepStrictEqual(
                    spans(`[OPT3:LDA #1 \\ ${comment}:]`, "invalid"),
                    [],
                    comment,
                );
            for (const text of [
                "[LDA &70,X \\ LOAD THE",
                "[.l LDA #1 \\ if x",
                "[NOP\nRTS \\ END OF LOOP",
                "[EQUB 1 \\ FOR",
            ])
                assert.deepStrictEqual(spans(text, "invalid"), [], text);
            assert.deepStrictEqual(spans("[OPT3:LDA #1 \\ fine:FOR:]", "invalid"), ["FOR"]);
            // BASIC ignores the rest of a complete instruction, but anything there but a comment is a mistake.
            assert.deepStrictEqual(spans("[NOP PRINT", "invalid"), ["PRINT"]);
        });
        // The ROM runs all of these, so ; is as much junk as | is, though BASIC only appears to take it as a comment.
        it.each([
            ["[OPT3:LDA #1 ; LOAD THE ACCUMULATOR:]", [";"]],
            ["[OPT3:LDA #1;x:NOP:]", [";"]],
            ["[OPT3:LDA #1|x:NOP:]", ["|"]],
            ["[NOP ; a\nRTS ; b", [";", ";"]],
        ])("should mark the junk after a complete instruction in %j", (text, junk) => {
            assert.deepStrictEqual(spans(text, "invalid"), junk);
        });
        it("should read letters in the case BASIC takes them", () => {
            // Mnemonics, OPT and EQU in any case; the accumulator, an index register and EQU's size only in upper
            // case, except that LDX and STX take y and LDY and STY take x.
            const cases = [
                ["[lda42,X", ["lda", "X"], []],
                ["[.l Lda #1", ["Lda"], []],
                ["[ldax", ["lda"], []],
                ["[ASL A", ["ASL", "A"], []],
                ["[asl a", ["asl"], []],
                ["[LDA 42,x", ["LDA"], ["x"]],
                ["[lda (&70,x)", ["lda"], ["x)"]],
                ["[LDA (&70), y", ["LDA"], ["y"]],
                ["[LDX &70,x", ["LDX"], ["x"]],
                ["[LDX &70,y", ["LDX", "y"], []],
                ["[sty &70,x", ["sty", "x"], []],
                // BASIC reads no index after these.
                ["[LDA #1,x", ["LDA"], [","]],
                ["[JSR &70,x", ["JSR"], [","]],
                ["[LDA ASC(MID$(A$,x,1))", ["LDA", "ASC", "MID$"], []],
                ["[equb 1", [], ["equb 1"]],
                ["[EQUw 1", [], ["EQUw 1"]],
                ["[Ora 1:orA 1:oRA 1", ["Ora", "orA", "oRA"], []],
                ["[ORa 1", [], ["ORa 1"]],
            ];
            for (const [text, keywords, invalid] of cases) {
                assert.deepStrictEqual(spans(text, "keyword"), keywords, text);
                assert.deepStrictEqual(spans(text, "invalid"), invalid, text);
            }
            assert.deepStrictEqual(spans("[opt 3:eqUW 1", "keyword.directive"), ["opt", "eqUW"]);
        });
        it("should allow STR$~ in an expression", () => {
            for (const text of ["[OPT3:EQUS STR$~(255):]", "[OPT3:EQUB ASC(STR$~A%):]"])
                assert.deepStrictEqual(spans(text, "invalid"), [], text);
            assert.deepStrictEqual(spans("[OPT3:EQUS STR$~~(255):]", "invalid"), ["~(255)"]);
        });
        it("should read an operand's names and keywords as BASIC reads them", () => {
            // A mnemonic is only a mnemonic where a statement starts, and BASIC reads PIX and TIMER as names.
            const cases = [
                ["[LDA TAXRATE", ["TAXRATE"]],
                ["[EQUB LDA+2", ["LDA"]],
                ["[LDA #PIX", ["PIX"]],
                ["[LDA #TIMER", ["TIMER"]],
                ["[LDA #PI", []],
            ];
            for (const [text, variables] of cases)
                assert.deepStrictEqual(spans(text, "variable"), variables, text);
            // LEFT$. is LEFT$( abbreviated, which an operand can use.
            assert.deepStrictEqual(spans("[LDA LEFT$.A$,1)", "invalid"), []);
        });
    });
});

describe("Bracket matching", () => {
    it("should pair each ) with its (, including the hidden ( of keywords, abbreviations and tokens", () => {
        const hidden = [
            "RIGHT$(",
            "RIGHT$.",
            "RI.",
            "LE.",
            "MI.",
            "MID$(",
            "TAB(",
            "POINT(",
            "STRING$(",
        ];
        const cases = [
            ...[...hidden, ...openers].map(keyword => [`P.${keyword}A$,1)`, []]),
            ['A$="OWLET":P.RI.A$,1)LE.A$,2)MI.A$,4,1)MI.A$,3,1)', []], // #114
            ["P.(1+2))", [8]],
            ["P.RI.A$,1))", [11]],
            ["P.RIGHT$(A$,1))", [15]],
            ["PRI.A$,1)", [9]], // PRI. is PRINT, not RIGHT$(
        ];
        for (const [text, columns] of cases) assert.deepStrictEqual(unmatched(text), columns, text);
    });
    it("should make only the ( of a keyword that ends in ( a bracket, so the keyword is coloured as one", () => {
        // #170: Q$=MID$(Q$,2) must colour MID$ like STR$, with only the ( in the bracket colour.
        for (const text of [
            "Q$=MID$(Q$,2)+STR$(Q%)",
            "P.RIGHT$(A$,1)",
            "P.TAB(3)",
            "X=POINT(1,2)",
            "A$=STRING$(2,A$)",
        ])
            assert.strictEqual(brackets(text)[0][0], text.indexOf("(") + 1, text);
        assert.deepStrictEqual(
            brackets("Q$=MID$(Q$,2)").map(([start]) => start),
            [8, 13],
        );
    });
    it("should nest brackets by depth, so that Monaco colours each level, and mark a ) with no ( as unexpected", () => {
        const levels = text => {
            const model = editor.createModel(text, LanguageId);
            try {
                model.tokenization.forceTokenization(model.getLineCount());
                return model.bracketPairs
                    .getBracketsInRange(model.getFullModelRange())
                    .toArray()
                    .map(b => [b.range.startColumn, b.nestingLevel, b.isInvalid]);
            } finally {
                model.dispose();
            }
        };
        assert.deepStrictEqual(levels("PRINT (1+(2*(3+4)))"), [
            [7, 0, false],
            [10, 1, false],
            [13, 2, false],
            [17, 2, false],
            [18, 1, false],
            [19, 0, false],
        ]);
        assert.deepStrictEqual(levels("A$=MID$(A$,1,2)"), [
            [8, 0, false],
            [15, 0, false],
        ]);
        // The tokenizer marks it invalid itself, and keeps it from Monaco.
        assert.deepStrictEqual(levels("P.(1+2))").at(-1), [7, 0, false]);
    });
    it("should ignore brackets in strings, comments and * commands", () => {
        for (const text of ['P."RI.A$,1)"', "REM RI.A$,1)", "*FX 1)", "10 *RUN RI.("])
            assert.deepStrictEqual(brackets(text), [], text);
    });
    it("should never treat a raw token that is not an opener as a bracket", () => {
        for (const char of keywords.map(tokenChar).filter(char => !openers.includes(char))) {
            for (const text of [
                char,
                `PRINT ${char}`,
                `IFX ${char}`,
                `A=1:${char}:B=2`,
                `[\n${char}\n]`,
            ])
                assert.deepStrictEqual(
                    unmatched(text),
                    [],
                    `U+${char.codePointAt(0).toString(16)} in ${text}`,
                );
        }
    });
    it("should match an abbreviated opener straight after a keyword", () => {
        for (const text of [
            "PRINTLE.A$,1)",
            "PRINT LE.A$,1)",
            "PRINTLEFT$(A$,1)",
            "P.LE.A$,1)",
            "P.LENMI.A$,2)",
        ])
            assert.deepStrictEqual(unmatched(text), [], text);
    });
    // Each bracket Monaco pairs, as line:column and nesting level.
    const paired = text => {
        const model = editor.createModel(text, LanguageId);
        try {
            model.tokenization.forceTokenization(model.getLineCount());
            return model.bracketPairs
                .getBracketsInRange(model.getFullModelRange())
                .toArray()
                .map(b => {
                    assert.ok(!b.isInvalid, text);
                    return `${b.range.startLineNumber}:${b.range.startColumn}=${b.nestingLevel}`;
                })
                .join(" ");
        } finally {
            model.dispose();
        }
    };
    it("should give Monaco only the brackets that pair on their line and that BASIC accepts", () => {
        for (const [text, expected] of [
            ["PRINTLE.A$,1)", "1:8=0 1:13=0"],
            ["P.LENMI.A$,2)", "1:8=0 1:13=0"],
            ["PRINTLEFT$.RI.A$,2),1)", "1:11=0 1:14=1 1:19=1 1:22=0"],
            // A ( with no ) does not pair with a ) on a later line or in a later statement, nor nest what follows.
            ["PRINT (1+2\nPRINT 3)\nPRINT (4)", "3:7=0 3:9=0"],
            ["PRINT (1:PRINT 2)", ""],
            // A dot that is not an opener is not a bracket.
            ["A=.5+(1.5)", "1:6=0 1:10=0"],
            ["PRINT A.B)", ""],
            ["P.X.7", ""],
            // A bracket BASIC rejects stays in the colour of an error, and so its partner is not one of a pair.
            ["PRINT LEFT$(A$,1,2)", ""],
            ["P.(1+2))", "1:3=0 1:7=0"],
            // An assembler block is the pair that spans lines.
            ["[\nLDA (&70),Y\n]\nPRINT (1)", "1:1=0 2:5=1 2:9=1 3:1=0 4:7=0 4:9=0"],
        ])
            assert.strictEqual(paired(text), expected, text);
    });
});

describe("The tokenizer's state in a Monaco model", () => {
    it("should carry an open assembler block from line to line, through edits, undo and redo", () => {
        const model = editor.createModel("[OPT 3\nLDA #1\n]\nLDA=1", LanguageId);
        // The colour of the first token of each line, from the model's own incremental tokenization.
        const firstColours = () => {
            model.tokenization.forceTokenization(model.getLineCount());
            return Array.from({length: model.getLineCount()}, (_, i) =>
                model.tokenization.getLineTokens(i + 1).getForeground(0),
            );
        };
        try {
            const [, mnemonic, , name] = firstColours();
            assert.notStrictEqual(mnemonic, name);
            // Without the "]", the last line is in the block, where LDA is a mnemonic.
            model.pushEditOperations([], [{range: new Range(3, 1, 4, 1), text: ""}], () => null);
            assert.deepStrictEqual(firstColours().slice(1), [mnemonic, mnemonic]);
            model.undo();
            const undone = firstColours();
            assert.deepStrictEqual([undone[1], undone[3]], [mnemonic, name]);
            model.redo();
            assert.deepStrictEqual(firstColours().slice(1), [mnemonic, mnemonic]);
            // Typing the "]" back at the end of the second line closes the block there.
            model.pushEditOperations([], [{range: new Range(2, 7, 2, 7), text: ":]"}], () => null);
            assert.deepStrictEqual(firstColours().slice(1), [mnemonic, name]);
        } finally {
            model.dispose();
        }
    });
});

describe("Line warnings", () => {
    it("should not generate warnings on lines that are fine", () => {
        const cases = [
            "COLOUR 123",
            'P."I am a mongoose"',
            "colour%=123",
            "colour$=a$",
            // A variable that merely starts with a keyword is fine: only a whole lower-case keyword is suspicious.
            ...["radius%", "order%", "cosang", "sinang", "colour3", "printer$", "print_x"].map(
                name => `${name}=1`,
            ),
            // Lower-case immediate commands are often names.
            "old=new",
            "auto=delete+load/list+renumber*save",
            "H. TO",
            "P.TO",
            "A=H.",
        ];
        for (const text of cases) checkWarnings(text);
    });
    it("should warn on keywords typed in lower case", () => {
        checkWarnings("colour", caseWarning("COLOUR", 1));
        checkWarnings("chr$", caseWarning("CHR$", 1));
        checkWarnings('print"hi"', caseWarning("PRINT", 1));
        // A name ends at a `$`, and a keyword ends at its bracket, so whatever follows them is not part of the name.
        checkWarnings("A=left$(B$,1)", caseWarning("LEFT$(", 3));
        checkWarnings("P.chr$65", caseWarning("CHR$", 3));
        checkWarnings("A$=inkey$0", caseWarning("INKEY$", 4));
        checkWarnings("A=len(B$)", caseWarning("LEN", 3));
        // The whole name is a keyword when something that cannot be part of a name follows it.
        for (const follower of [",", ":", ";", " ", "."])
            checkWarnings(`print${follower}`, caseWarning("PRINT", 1));
        // Both GET and GET$ are tokens - check that doesn't trip us up.
        checkWarnings("A$=get$", caseWarning("GET$", 4));
        // Each line of a program, wherever its text starts.
        const where = getWarnings("  colour\nX=1:chr$", ModelBDialect).map(w => [
            w.startLineNumber,
            w.startColumn,
        ]);
        assert.deepStrictEqual(where, [
            [1, 3],
            [2, 5],
        ]);
    });
    it("should leave alone the names that BASIC does not read as keywords or abbreviations", () => {
        // ` is a letter, so COUNT` is a name; after FN a dot ends the name, so there is no abbreviation to space out.
        for (const [text, row] of [
            ["A=count`", "A=COUNT`"],
            ["A=FNO.X1", "A=FNO.X1"],
        ]) {
            assert.ok(romTokens.has(row), `${row} is not a recorded row`);
            checkWarnings(text);
        }
        assert.strictEqual(
            romTokens.get("A=FNO. X1").replace(" 20", ""),
            romTokens.get("A=FNO.X1"),
        );
    });
    it("should not warn about a lower case name after PROC, FN or DEF", () => {
        // The ROM keeps what follows PROC or FN as text, so PROCmove is the keyword PROC and the name move; procmove
        // is no keyword at all.
        for (const text of [
            "PROCmove",
            "DEFPROCdraw",
            "X=FNend",
            "PROCprint:PROCinput",
            "procmove",
            "X=fnend",
        ]) {
            assert.ok(romTokens.has(text), `${text} is not a recorded row`);
            checkWarnings(text);
        }
        // Also where the recogniser has marked the name invalid (a PROC where a value was wanted).
        checkWarnings("X=PROCprint");
        checkWarnings("DEFPROCdraw(x):print", caseWarning("PRINT", 16));
    });
    it("should warn about an abbreviation after a number only where the ROM reads it differently", () => {
        const rows = ["A=1ER.a$", "A=1ER. a$", "A=1.5ER.a$", "A=&1ER.a$", "A=1er.a$"];
        for (const row of rows) assert.ok(romTokens.has(row), `${row} is not a recorded row`);
        checkWarnings("A=1ER.a$", {
            message:
                'ER. is not read as an abbreviation when followed directly by letters or digits, did you mean "ER. a"?',
            code: "space-after-abbreviation",
            startColumn: 4,
            endColumn: 8,
        });
        checkWarnings("A=1ER. a$");
    });
    it("should warn about an abbreviation after a number where the ROM runs the line", () => {
        const rows = [
            [
                '@%=1:R=5:a$="x":P.1ER.a$',
                'ER. is not read as an abbreviation when followed directly by letters or digits, did you mean "ER. a"?',
                20,
                24,
            ],
            [
                "@%=1:R=5:P.1ER.1",
                'ER. is not read as an abbreviation when followed directly by letters or digits, did you mean "ER. 1"?',
                13,
                17,
            ],
        ];
        for (const [text, message, startColumn, endColumn] of rows) {
            assert.strictEqual(verdicts.get(text), "ok", `${text} is not a recorded row`);
            checkWarnings(text, {
                message,
                code: "space-after-abbreviation",
                startColumn,
                endColumn,
            });
        }
        for (const text of [
            '@%=1:R=5:a$="x":P.1ER. a$',
            "@%=1:R=5:P.1ER. 1",
            "@%=1:R=5:P.1ER.(1)",
            "@%=1:R=5:P.1ER.-1",
        ]) {
            assert.strictEqual(verdicts.get(text), "ok", `${text} is not a recorded row`);
            checkWarnings(text);
        }
    });
    it("should keep a bare E as the exponent of a number even when a dot follows", () => {
        const numbers = readLines("PRINT 1E.5", ModelBDialect)
            .at(-1)
            .tokens.filter(token => token.kind === "number")
            .map(token => token.text);
        assert.deepStrictEqual(numbers, ["1E", ".5"]);
        checkWarnings("PRINT 1E.5");
    });
    it("should warn on invalid operators from other languages", () => {
        const cases = [
            ["==", "=", 1],
            ["!=", "<>", 1],
            ["A=2**3", "^", 4],
            ["><", "<>", 1],
            ["=<", "<=", 1],
            ["=>", ">=", 1],
        ];
        for (const [text, replacement, startColumn] of cases) {
            const operator = text.slice(startColumn - 1, startColumn + 1);
            checkWarnings(text, {
                message: `${operator} is not a BBC BASIC operator, did you mean ${replacement}?`,
                code: "foreign-operator",
                startColumn,
                endColumn: startColumn + 2,
            });
        }
    });
    it("should suggest a space after an abbreviation that is followed by letters", () => {
        const cases = [
            ["H.TO", "H. TO", 1],
            ["F.A=1 TO H.TO8", "H. TO8", 10],
        ];
        for (const [text, fixed, startColumn] of cases) {
            checkWarnings(text, {
                message: `H. is not read as an abbreviation when followed directly by letters or digits, did you mean "${fixed}"?`,
                code: "space-after-abbreviation",
                startColumn,
                endColumn: startColumn + fixed.length - 1,
            });
        }
    });
});

describe("Quick fixes", () => {
    // Applies the first quick fix for the line's first warning and returns the line as the edit leaves it.
    function applyQuickFix(text) {
        const model = editor.createModel(text, LanguageId);
        try {
            const markers = getWarnings(text, ModelBDialect);
            const {actions} = codeActionProviderFor(ModelBDialect).provideCodeActions(
                model,
                markers[0],
                {markers},
            );
            const {title, edit} = actions[0];
            const {range, text: inserted} = edit.edits[0].textEdit;
            const result =
                text.slice(0, range.startColumn - 1) + inserted + text.slice(range.endColumn - 1);
            return {title, result};
        } finally {
            model.dispose();
        }
    }

    it("should insert a space after the abbreviation", () => {
        assert.deepStrictEqual(applyQuickFix("H.TO"), {
            title: "Insert a space after H.",
            result: "H. TO",
        });
        assert.deepStrictEqual(applyQuickFix("F.A=1 TO H.TO8"), {
            title: "Insert a space after H.",
            result: "F.A=1 TO H. TO8",
        });
    });
    it("should put the space after an abbreviation that follows a number", () => {
        assert.deepStrictEqual(applyQuickFix("A=1ER.a$"), {
            title: "Insert a space after ER.",
            result: "A=1ER. a$",
        });
    });
    it("should offer the space for an abbreviation after a number in a line that runs", () => {
        assert.deepStrictEqual(applyQuickFix("@%=1:R=5:P.1ER.1"), {
            title: "Insert a space after ER.",
            result: "@%=1:R=5:P.1ER. 1",
        });
    });
    it("should replace a keyword typed in lower case, or an operator from another language", () => {
        assert.deepStrictEqual(applyQuickFix("colour"), {
            title: "Replace with COLOUR",
            result: "COLOUR",
        });
        assert.deepStrictEqual(applyQuickFix("A=2**3"), {title: "Replace with ^", result: "A=2^3"});
    });
});

describe("Quick fixes and syntax markers", () => {
    // The titles of the quick fixes offered for every marker the editor has on the text.
    function offered(text) {
        const model = editor.createModel(text, LanguageId);
        try {
            const markers = [
                ...getWarnings(text, ModelBDialect),
                ...getSyntaxMarkers(text, ModelBDialect),
            ];
            const {actions} = codeActionProviderFor(ModelBDialect).provideCodeActions(
                model,
                markers[0],
                {markers},
            );
            return actions.map(action => action.title);
        } finally {
            model.dispose();
        }
    }
    it("should offer fixes only for the warnings, and never rewrite the text of a syntax marker", () => {
        assert.deepStrictEqual(offered('print "lower"'), ["Replace with PRINT"]);
        assert.deepStrictEqual(offered("GOTO 20 30"), []);
        assert.deepStrictEqual(offered("x == 3"), ["Replace with ="]);
    });
    it("should offer a fix for junk after a complete instruction, and a ] fix when it is a ]", () => {
        assert.deepStrictEqual(offered("[OPT0:LDA #1]:tax=1"), [
            "Insert : before ]",
            "Insert \\ before the junk",
        ]);
        assert.deepStrictEqual(offered("[OPT0:NOP hello:]"), ["Insert \\ before the junk"]);
    });
    it("should offer to replace a ; with a \\, as the ARM assembler of BASIC V takes it as a comment", () => {
        assert.deepStrictEqual(offered("[OPT0:NOP ; hello:]"), ["Replace ; with \\"]);
    });
    it("should offer only the space for a keyword straight after a mnemonic", () => {
        assert.deepStrictEqual(offered("[OPT0:STAH.,X:]"), ["Insert a space after STA"]);
    });
    it.each([
        ["[OPT0:LDA#1]", "Insert : before ]", "[OPT0:LDA#1:]"],
        ["[LDA #1]\ntax=1\n]", "Insert : before ]", "[LDA #1:]\ntax=1\n]"],
        ["[OPT0:NOP hello:]", "Insert \\ before the junk", "[OPT0:NOP \\hello:]"],
        ["[OPT0:LDA #1 ,X:]", "Insert \\ before the junk", "[OPT0:LDA #1 \\,X:]"],
        ["[OPT0:LDA #1 ; load:]", "Replace ; with \\", "[OPT0:LDA #1 \\ load:]"],
        ["[OPT0:LDA #1;x:NOP:]", "Replace ; with \\", "[OPT0:LDA #1\\x:NOP:]"],
        ["[OPT0:STAH.,X:]", "Insert a space after STA", "[OPT0:STA H.,X:]"],
        ["[OPT0:LDAUSR@%+GET:]", "Insert a space after LDA", "[OPT0:LDA USR@%+GET:]"],
        ["[OPT0:LDAH.:]", "Insert a space after LDA", "[OPT0:LDA H.:]"],
        ["[OPT0:EQUBH.:]", "Insert a space after EQUB", "[OPT0:EQUB H.:]"],
        ["[OPT0:.lab STAH.,X:]", "Insert a space after STA", "[OPT0:.lab STA H.,X:]"],
        ["[OPT0:NOPPAGE:]", "Insert \\ before the junk", "[OPT0:NOP\\PAGE:]"],
        ["[OPT0:LDAP.,X:]", "Insert \\ before the junk", "[OPT0:LDAP\\.,X:]"],
    ])("%s should offer %s, leaving %j with no junk marker", (text, title, result) => {
        const [offer] = fixes(text, ModelBDialect).filter(([name]) => name === title);
        assert.deepStrictEqual(offer, [title, result]);
        assert.deepStrictEqual(
            getSyntaxMarkers(result, ModelBDialect).filter(marker => marker.code),
            [],
        );
    });
});

// The text each quick fix offered for the line's syntax markers leaves, by title.
function fixes(text, dialect) {
    const model = editor.createModel(text, LanguageId);
    try {
        const markers = getSyntaxMarkers(text, dialect);
        const {actions} = codeActionProviderFor(dialect).provideCodeActions(model, markers[0], {
            markers,
        });
        return actions.map(({title, edit}) => {
            const {range, text: inserted} = edit.edits[0].textEdit;
            const lines = text.split("\n");
            const line = lines[range.startLineNumber - 1];
            lines[range.startLineNumber - 1] =
                line.slice(0, range.startColumn - 1) + inserted + line.slice(range.endColumn - 1);
            return [title, lines.join("\n")];
        });
    } finally {
        model.dispose();
    }
}

// The warnings the editor shows on a MOVE BY- or DRAW BY-, with the text each quick fix for one leaves.
function relativeMoveWarnings(text, dialect) {
    const markers = getWarnings(text, dialect).filter(warning => warning.code === "basic-v-fix");
    const model = editor.createModel(text, LanguageId);
    try {
        return markers.map(warning => {
            const {actions} = codeActionProviderFor(dialect).provideCodeActions(model, warning, {
                markers: [warning],
            });
            const {range, text: inserted} = actions[0].edit.edits[0].textEdit;
            const lines = text.split("\n");
            const line = lines[range.startLineNumber - 1];
            lines[range.startLineNumber - 1] =
                line.slice(0, range.startColumn - 1) + inserted + line.slice(range.endColumn - 1);
            return {warning, title: actions[0].title, fixed: lines.join("\n")};
        });
    } finally {
        model.dispose();
    }
}

describe("Warning for MOVE BY- and DRAW BY- when BY is never set", () => {
    const dialects = [
        [BasicIIDialect, verdicts],
        [ModelBNoGxrDialect, verdicts],
        [ModelBDialect, verdicts],
        [BasicIVDialect, masterVerdicts],
    ];
    // BASIC II and IV read BY as a variable, so the ROM accepts the line and stops only when it runs it (No such
    // variable on both ROMs, checked with rom.mjs, which no row can hold: the statement is not a syntax verdict); with
    // BY set the line runs (a recorded row), and so does the fixed one.
    it.each([
        [
            "MOVE BY-40,40",
            "PLOT0,-40,40",
            "BY=1:MOVE BY-40,40",
            "Replace MOVE BY-40,40 with PLOT0,-40,40",
        ],
        [
            "DRAW BY-40,40",
            "PLOT1,-40,40",
            "BY=1:DRAW BY-40,40",
            "Replace DRAW BY-40,40 with PLOT1,-40,40",
        ],
        [
            "MOVE BY -40,40",
            "PLOT0,-40,40",
            "BY=1:MOVE BY -40,40",
            "Replace MOVE BY -40,40 with PLOT0,-40,40",
        ],
        ["MOVE BY-X,Y", "PLOT0,-X,Y", "BY=1:MOVE BY-X,Y", "Replace MOVE BY-X,Y with PLOT0,-X,Y"],
        [
            "MOVE BY-40,40:PRINT",
            "PLOT0,-40,40:PRINT",
            "BY=1:MOVE BY-40,40:PRINT",
            "Replace MOVE BY-40,40 with PLOT0,-40,40",
        ],
        [
            "PRINT:MOVE BY-40,40",
            "PRINT:PLOT0,-40,40",
            null,
            "Replace MOVE BY-40,40 with PLOT0,-40,40",
        ],
        [
            "IF 1 THEN MOVE BY-40,40 ELSE PRINT",
            "IF 1 THEN PLOT0,-40,40 ELSE PRINT",
            "BY=1:IF 1 THEN MOVE BY-40,40 ELSE PRINT",
            "Replace MOVE BY-40,40 with PLOT0,-40,40",
        ],
    ])("%s should be a warning with the fix %s", (text, fixed, withBy, title) => {
        for (const [dialect, table] of dialects) {
            const [found, ...others] = relativeMoveWarnings(text, dialect);
            assert.deepStrictEqual(others, []);
            assert.strictEqual(found.warning.severity, MarkerSeverity.Warning);
            assert.match(
                found.warning.message,
                /BASIC II and IV have no (MOVE|DRAW) BY \(BASIC V's /,
            );
            assert.match(found.warning.message, /nothing in this program sets.*No such variable/);
            assert.strictEqual(found.title, title);
            assert.strictEqual(found.fixed, fixed);
            assert.strictEqual(table.get(fixed), "ok");
            if (withBy) assert.strictEqual(table.get(withBy), "ok");
            // ROM-valid text is never an error.
            assert.deepStrictEqual(getSyntaxMarkers(text, dialect), []);
            assert.deepStrictEqual(
                withoutCodes(getWarnings(text, dialect)).map(w => w.code),
                [undefined],
            );
        }
    });
    it("should mark the statement and say what BASIC V does", () => {
        const [{warning}] = relativeMoveWarnings("X=1:MOVE BY-40,40:PRINT", ModelBDialect);
        assert.deepStrictEqual(
            [warning.startLineNumber, warning.startColumn, warning.endColumn],
            [1, 5, 18],
        );
        assert.strictEqual(
            warning.message,
            "BASIC II and IV have no MOVE BY (BASIC V's MOVE BY moves the graphics cursor relative to where it is), so BY is read as a variable, which nothing in this program sets, and BASIC will stop with No such variable; PLOT0,-40,40 does the same",
        );
    });
    it("should warn on the line of a program that has it, whatever the lines before and after", () => {
        const found = relativeMoveWarnings("10 X=1\n20 DRAW BY-4,4\n30 MOVE BY-1,1", ModelBDialect);
        assert.deepStrictEqual(
            found.map(({warning, fixed}) => [
                warning.startLineNumber,
                fixed.split("\n")[warning.startLineNumber - 1],
            ]),
            [
                [2, "20 PLOT1,-4,4"],
                [3, "30 PLOT0,-1,1"],
            ],
        );
    });
    // Another operator is no BASIC V move written for BASIC II (and BY+1 is as likely to be the variable's): no warning.
    it.each([
        "MOVE BY+40,40",
        "MOVE BY +40,40",
        "MOVE BY!1,2",
        "MOVE BY?1,2",
        "MOVE BY*2,2",
        "MOVE BY/2,2",
        "MOVE BY^2,2",
        "MOVE BY(1),2",
        "MOVE BY AND 1,2",
        "MOVE BY=1,2",
        "MOVE BY,2",
        "MOVE BY",
        "MOVE BY-1",
        "DRAW BY+1,2",
        "DRAW BY!1,2",
        "DRAW BY AND 1,2",
        "MOVE BY%-1,2",
        "MOVE BY$-1,2",
        "MOVE BYE-1,2",
        "MOVE BX-1,2",
        "MOVE 1,BY-2",
        "PRINT BY-1",
        "X=BY-1",
        "POINT BY -1,2",
        "POINT BY-1,2",
    ])("%s should have no warning for BY", text => {
        for (const [dialect] of dialects) {
            assert.deepStrictEqual(
                getWarnings(text, dialect).filter(warning => warning.code === "basic-v-fix"),
                [],
            );
        }
    });
    // Each way of giving BY a value, before the move or after it, or on another line, means no warning.
    it.each([
        "BY=1",
        "BY = 1",
        "LET BY=1",
        "X=1:BY=1",
        "IF X THEN BY=1",
        "IF X THEN 10 ELSE BY=1",
        "REPEAT BY=BY+1",
        "ON ERROR BY=1",
        "ONERRORBY=1",
        "ON ERROR BY=1:GOTO 20",
        "ON ERROR LOCAL BY=1",
        "IF1BY=1",
        "IF 1 BY=1",
        "X=1:IFX BY=1.",
        "IF X<2BY=1",
        "IF(X)BY=1",
        "IF X=1 BY=1",
        "IF X THEN BY=1 ELSE BY=2",
        "IF 0 ELSE BY=1",
        "IF 0 THEN 20 ELSE BY=1",
        "ON X GOTO 20 ELSE BY=1",
        "ON X GOSUB 20 ELSE BY=1",
        "REPEAT:BY=1:UNTIL 1",
        "LOCAL BY",
        "LOCAL X,BY",
        "FOR BY=1TO3",
        "INPUT BY",
        'INPUT "x",BY',
        "INPUT LINE BY",
        "READ BY",
        "READ X,BY",
        "DEF PROCa(BY)",
        "DEF PROCa(X,BY)",
        "DEF FNa(BY)",
        "DEF FNa(BY)=BY",
        "DIM BY 10",
        "[:.BY RTS:]",
        "[.BY RTS]",
    ])("should not warn when the program has %s, before, after or on its own line", assignment => {
        for (const text of [
            `${assignment}:MOVE BY-40,40`,
            `MOVE BY-40,40:${assignment}`,
            `10 ${assignment}\n20 MOVE BY-40,40`,
            `10 MOVE BY-40,40\n20 ${assignment}`,
            `10 MOVE BY-40,40\n20 X=1\n30 DRAW BY-4,4\n40 ${assignment}`,
        ]) {
            for (const [dialect] of dialects) {
                assert.deepStrictEqual(
                    getWarnings(text, dialect).filter(warning => warning.code === "basic-v-fix"),
                    [],
                    text,
                );
            }
        }
    });
    // A comparison looks the same as an assignment wherever the statement may start (IF1BY=1 sets BY, IF BY=1 THEN does
    // not), so the scan does not tell them apart: no warning, a missed one being better than a false one. In the ROM
    // the program stops at the move with No such variable (and `[LDA#BY=1]` does not set BY either).
    it.each(["PRINT BY=1", "IF BY=1 THEN PRINT", "X=BY=1", "[OPT0:LDA#BY=1:]"])(
        "should not warn when the program has %s, which may set BY",
        other => {
            for (const [dialect] of dialects) {
                assert.deepStrictEqual(
                    relativeMoveWarnings(`10 ${other}\n20 MOVE BY-40,40`, dialect),
                    [],
                    other,
                );
            }
        },
    );
    // BY assigned in an ON ERROR handler is set by the time the move is run again, as in Olly Betts's programs on #354.
    it.each(["ONERRORBY=1\nMOVE BY-1,-1", "IF1BY=1\nMOVE BY-1,-1", "X=1:IFX BY=1.\nMOVE BY-1,-1"])(
        "should not warn on the program %j",
        text => {
            for (const [dialect] of dialects) {
                assert.deepStrictEqual(relativeMoveWarnings(text, dialect), [], text);
                assert.deepStrictEqual(
                    getWarnings(text, dialect).filter(warning => warning.code === "basic-v-fix"),
                    [],
                );
            }
        },
    );
    // A different variable does not set BY: an array, another name, or the integer or string BY.
    it.each([
        "DIM BY(3):BY(1)=1",
        "BY(1)=1",
        "BYE=1",
        "BX=1",
        'BY$=""',
        "BY%=1",
        "X=BY(1)",
        "BY?1=2",
        'PRINT "BY=1"',
        "REM BY=1",
        "DATA BY=1",
        "by=1",
        "FOR I=BY TO 3",
        "LET X=BY",
        // BASIC V only: BASIC II and IV stop at them ("Mistake"), so they set nothing.
        "BY+=1",
        "BY-=1",
        "BY*=1",
        "BY/=1",
    ])("should still warn when the program has only %s", other => {
        const text = `10 ${other}\n20 MOVE BY-40,40`;
        for (const [dialect] of dialects) {
            const found = relativeMoveWarnings(text, dialect);
            assert.deepStrictEqual(
                found.map(({warning}) => warning.startLineNumber),
                [2],
                other,
            );
        }
    });
});

describe("Quick fix for a lower case index register", () => {
    // Each line is a recorded row: on BASIC II it stops with Index, and the capitalised line assembles.
    it.each([
        ["[ASL42,x:]", "Replace x with X", "[ASL42,X:]"],
        ["[OPT0:LDA 42,x:]", "Replace x with X", "[OPT0:LDA 42,X:]"],
        ["[OPT0:LDA 42,y:]", "Replace y with Y", "[OPT0:LDA 42,Y:]"],
        ["[OPT0:STA (42),y:]", "Replace y with Y", "[OPT0:STA (42),Y:]"],
        ["[OPT0:LDA (42,x):]", "Replace x with X", "[OPT0:LDA (42,X):]"],
        ["[OPT0:LDA (42),y:]", "Replace y with Y", "[OPT0:LDA (42),Y:]"],
        ["[OPT0:ASL 42,x:]", "Replace x with X", "[OPT0:ASL 42,X:]"],
        ["[OPT0:LDA 42,x", "Replace x with X", "[OPT0:LDA 42,X"],
        ["[OPT0:LDA (42),y", "Replace y with Y", "[OPT0:LDA (42),Y"],
        ["[OPT0:STA (42),y", "Replace y with Y", "[OPT0:STA (42),Y"],
    ])("BASIC II: %s should offer %s, leaving %s", (text, title, result) => {
        assert.deepStrictEqual([verdicts.get(text), verdicts.get(result)], ["Index", "ok"]);
        assert.deepStrictEqual(fixes(text, BasicIIDialect), [[title, result]]);
        assert.deepStrictEqual(getSyntaxMarkers(result, BasicIIDialect), []);
    });
    // Each is a recorded row that stops with Index on BASIC II, and still does with the register in capitals.
    it.each([
        ["[OPT0:ASL 42,y:]", "[OPT0:ASL 42,Y:]"],
        ["[OPT0:LDX 42,x:]", "[OPT0:LDX 42,X:]"],
        ["[OPT0:LDA (42,x:]", "[OPT0:LDA (42,X:]"],
        ["[OPT0:LDA (42,x", "[OPT0:LDA (42,X"],
        ["[OPT0:JMP (42,x):]", "[OPT0:JMP (42,X):]"],
    ])("BASIC II: %s should offer no fix, as %s is still wrong", (text, capitalised) => {
        assert.deepStrictEqual([verdicts.get(text), verdicts.get(capitalised)], ["Index", "Index"]);
        assert.deepStrictEqual(fixes(text, BasicIIDialect), []);
        assert.strictEqual(getSyntaxMarkers(text, BasicIIDialect).length, 1);
    });
    // BASIC IV reads the register in either case, so there is nothing to fix.
    it.each(["[ASL42,x:]", "[OPT0:STA (42),y:]", "[OPT0:LDA (42,x):]", "[OPT0:LDA 42,x"])(
        "BASIC IV: %s should have no marker",
        text => {
            assert.strictEqual(masterVerdicts.get(text), "ok");
            assert.deepStrictEqual(getSyntaxMarkers(text, BasicIVDialect), []);
        },
    );
    it.each(["[OPT0:ASL 42,y:]", "[OPT0:LDA (42,x"])(
        "BASIC IV: %s, wrong in either case, should offer no fix",
        text => {
            assert.strictEqual(masterVerdicts.get(text), "Index");
            assert.strictEqual(getSyntaxMarkers(text, BasicIVDialect).length, 1);
            assert.deepStrictEqual(fixes(text, BasicIVDialect), []);
        },
    );
    it("should mend the register on a later line of an assembler block", () => {
        assert.deepStrictEqual(fixes("[\nLDA 42,x\n]", BasicIIDialect), [
            ["Replace x with X", "[\nLDA 42,X\n]"],
        ]);
    });
    it("should leave the marker an error", () => {
        assert.deepStrictEqual(
            getSyntaxMarkers("[ASL42,x:]", BasicIIDialect).map(marker => marker.severity),
            [MarkerSeverity.Error],
        );
    });
});

describe("Quick fix for a keyword that a number or name runs into", () => {
    // Each is a recorded row that stops at the keyword on both ROMs. The line with a space before it is read on, so the
    // fix is offered and what the ROM says of it, if not ok, is that the line ends.
    it.each([
        ["FORJ%=1E4TO", "No TO", "TO", "FORJ%=1E4 TO", "No such variable"],
        ["X=1E4AND3", "Syntax error", "AND", "X=1E4 AND3", "ok"],
        ["X=1E4DIV3", "Syntax error", "DIV", "X=1E4 DIV3", "ok"],
        ["X=1E4EOR3", "Syntax error", "EOR", "X=1E4 EOR3", "ok"],
        ["X=1E4MOD3", "Syntax error", "MOD", "X=1E4 MOD3", "ok"],
        ["X=1E4OR3", "Syntax error", "OR", "X=1E4 OR3", "ok"],
        ["X=1E4AND", "Syntax error", "AND", "X=1E4 AND", "No such variable"],
        ["ONX/1E1GOTO10,20ELSEPRINT", "ON syntax", "GOTO", "ONX/1E1 GOTO10,20ELSEPRINT", "ok"],
        ["ONX/1E1GOSUB10,20ELSEPRINT", "ON syntax", "GOSUB", "ONX/1E1 GOSUB10,20ELSEPRINT", "ok"],
        ["FORJ%=2E4TO22400STEP100", "No TO", "TO", "FORJ%=2E4 TO22400STEP100", "ok"],
        ["FORJ%=2E4TOA", "No TO", "TO", "FORJ%=2E4 TOA", "ok"],
        ["FORJ%=1TO2E4STEP100", "Syntax error", "STEP", "FORJ%=1TO2E4 STEP100", "ok"],
        ["FORJ%=1TO2E4STEP", "Syntax error", "STEP", "FORJ%=1TO2E4 STEP", "No such variable"],
    ])("%s should offer a space before %s, leaving %s", (text, verdict, keyword, result, after) => {
        for (const [dialect, table] of [
            [BasicIIDialect, verdicts],
            [BasicIVDialect, masterVerdicts],
        ]) {
            assert.strictEqual(table.get(text), verdict);
            assert.strictEqual(table.get(result), after);
            assert.deepStrictEqual(fixes(text, dialect), [
                [`Insert a space before ${keyword}`, result],
            ]);
            assert.strictEqual(
                getSyntaxMarkers(result, dialect).filter(
                    marker => marker.severity === MarkerSeverity.Error,
                ).length,
                0,
            );
        }
    });
    it("should offer a space before PROC after ON only on BASIC IV", () => {
        const text = "ONX/1E1PROCa ELSEPRINT";
        assert.strictEqual(masterVerdicts.get(text), "ON syntax");
        assert.strictEqual(masterVerdicts.get("ONX/1E1 PROCa ELSEPRINT"), "ok");
        assert.deepStrictEqual(fixes(text, BasicIVDialect), [
            ["Insert a space before PROC", "ONX/1E1 PROCa ELSEPRINT"],
        ]);
        assert.strictEqual(verdicts.get("ONX/1E1 PROCa ELSEPRINT"), "ON syntax");
        assert.deepStrictEqual(fixes(text, BasicIIDialect), []);
    });
    // Recorded rows that stop with the same error with the space as well, so no fix is offered.
    it.each([
        ["FORJ%=1to10", "FORJ%=1 to10"],
        ["X=1E4and3", "X=1E4 and3"],
        ["ONX/1E1goto10,20ELSEPRINT", "ONX/1E1 goto10,20ELSEPRINT"],
    ])("should offer no fix where the keyword is in lower case in %s", (text, spaced) => {
        for (const [dialect, table] of [
            [BasicIIDialect, verdicts],
            [BasicIVDialect, masterVerdicts],
        ]) {
            assert.strictEqual(table.get(text), table.get(spaced));
            assert.notStrictEqual(table.get(text), "ok");
            assert.strictEqual(getSyntaxMarkers(text, dialect).length, 1);
            assert.deepStrictEqual(fixes(text, dialect), []);
        }
    });
    // BASIC reads E1ELSE30 as part of a name and ignores it, with no error: the mark is on purpose
    // (docs/rom-deviations.md), and the fix is offered only where an ON or IF is waiting for the ELSE.
    it("should offer a space before an ELSE that a number runs into after an ON list", () => {
        const text = "X%=5:ONX%GOTO20E1,20,+.2E2JUNK,ERL+2E1ELSE30";
        const spaced = "X%=5:ONX%GOTO20E1,20,+.2E2JUNK,ERL+2E1 ELSE30";
        for (const [dialect, table] of [
            [BasicIIDialect, verdicts],
            [BasicIVDialect, masterVerdicts],
        ]) {
            assert.strictEqual(table.get(spaced), "ok");
            assert.deepStrictEqual(fixes(text, dialect), [["Insert a space before ELSE", spaced]]);
            assert.deepStrictEqual(fixes(spaced, dialect), []);
        }
    });
    it("should offer no ELSE fix where no IF or ON is waiting for it", () => {
        assert.deepStrictEqual(fixes("X=1E1ELSE30", BasicIIDialect), []);
    });
    it("should leave the marker an error, and mend the line it is on", () => {
        assert.deepStrictEqual(
            getSyntaxMarkers("FORJ%=2E4TO22400STEP100", BasicIIDialect).map(m => m.severity),
            [MarkerSeverity.Error],
        );
        assert.deepStrictEqual(fixes("10 X=1\n20 FORJ%=1TO2E4STEP100", BasicIIDialect), [
            ["Insert a space before STEP", "10 X=1\n20 FORJ%=1TO2E4 STEP100"],
        ]);
    });
});

describe("Quick fix for GCOL with one argument", () => {
    // Each is a recorded row that both ROMs stop at with Missing , (#340); with 0, before the argument it is read.
    it.each([
        ["C=1:GCOL C", "C=1:GCOL 0,C"],
        ["C=1:GC.C", "C=1:GC.0,C"],
        ["C=1:GCOL C+1", "C=1:GCOL 0,C+1"],
        ["GCOL 1:PRINT", "GCOL 0,1:PRINT"],
        ["IF 1 THEN GCOL 1 ELSE PRINT", "IF 1 THEN GCOL 0,1 ELSE PRINT"],
        ["10 X=1\n20 GCOL   1", "10 X=1\n20 GCOL   0,1"],
    ])("%s should offer 0, before the argument, leaving %s", (text, result) => {
        for (const [dialect, table] of [
            [BasicIIDialect, verdicts],
            [BasicIVDialect, masterVerdicts],
        ]) {
            if (!text.includes("\n")) assert.strictEqual(table.get(text), "Missing ,");
            assert.deepStrictEqual(fixes(text, dialect), [
                ["Insert 0, before the argument", result],
            ]);
        }
    });
    it.each(["C=1:GCOL C,C,C", "C=1:GCOL 0,C", "GCOL 1 2", "GCOL"])(
        "%s should offer no fix",
        text => {
            for (const dialect of [BasicIIDialect, BasicIVDialect])
                assert.deepStrictEqual(fixes(text, dialect), []);
        },
    );
    it("should say that BASIC V accepts one argument, after the ROM's words", () => {
        assert.deepStrictEqual(
            getSyntaxMarkers("C=1:GCOL C", BasicIIDialect).map(m => [m.severity, m.message]),
            [
                [
                    MarkerSeverity.Warning,
                    "GCOL needs two arguments here, as in GCOL 0,C; BASIC V accepts a single argument, and GCOL C means GCOL 0,C there (BASIC: Missing ,)",
                ],
            ],
        );
    });
});

describe("Quick fix for a BASIC V statement", () => {
    // Each is a recorded row that both ROMs stop at (#348), and the fixed line is one that both run. CIRCLE has a fix
    // only where PLOT has the circle codes: BASIC IV (the Master) and a Model B with the GXR, not on BASIC II or a
    // Model B without it.
    it.each([
        ["OFF", "VDU 23,1,0;0;0;0;"],
        ["ON", "VDU 23,1,1;0;0;0;"],
        ["OFF:PRINT", "VDU 23,1,0;0;0;0;:PRINT"],
        ["IF 1 THEN OFF ELSE PRINT", "IF 1 THEN VDU 23,1,0;0;0;0; ELSE PRINT"],
        ["BY=1:MOVE BY 1,2", "BY=1:PLOT0,1,2"],
        ["BY=1:MOVE BY X+1,Y*2", "BY=1:PLOT0,X+1,Y*2"],
        ["BY=1:DRAW BY 1,2", "BY=1:PLOT1,1,2"],
        ["BY=1:IF 1 THEN DRAW BY 1,2 ELSE PRINT", "BY=1:IF 1 THEN PLOT1,1,2 ELSE PRINT"],
        ["POINT 1,2", "PLOT&65,1,2"],
        ["POINT 1,2:PRINT", "PLOT&65,1,2:PRINT"],
        ["POINT (1),(2)", "PLOT&65,(1),(2)"],
        ["POINT BY 1,2", "PLOT&61,1,2"],
        ["ORIGIN 1,2", "VDU29,1;2;"],
        ["ORIGIN X+1,Y*2", "VDU29,X+1;Y*2;"],
        ["LINE 1,2,3,4", "MOVE 1,2:DRAW 3,4"],
        ["LINE X,Y+1,X+2,FNg(1)", "MOVE X,Y+1:DRAW X+2,FNg(1)"],
        ["LINE 1,2,3,4:PRINT", "MOVE 1,2:DRAW 3,4:PRINT"],
        ["IF 1 THEN LINE 1,2,3,4 ELSE PRINT", "IF 1 THEN MOVE 1,2:DRAW 3,4 ELSE PRINT"],
        ["CIRCLE 1,2,3", "MOVE 1,2:PLOT&91,3,0"],
        ["CIRCLE X,Y,FNg(2)", "MOVE X,Y:PLOT&91,FNg(2),0"],
        ["CIRCLE FILL 1,2,3", "MOVE 1,2:PLOT&99,3,0"],
        ["CIRCLE 1,2,3:PRINT", "MOVE 1,2:PLOT&91,3,0:PRINT"],
        ["10 X=1\n20 ORIGIN  1 , 2", "10 X=1\n20 VDU29,1;2;"],
    ])("%s should offer %s", (text, result) => {
        const needsCircles = text.includes("CIRCLE");
        for (const [dialect, table] of [
            [BasicIIDialect, verdicts],
            [ModelBNoGxrDialect, verdicts],
            [ModelBDialect, verdicts],
            [BasicIVDialect, masterVerdicts],
        ]) {
            if (!text.includes("\n")) {
                assert.notStrictEqual(table.get(text), "ok");
                // The rows that define BY to be a variable have the fixed text without that, which is the same.
                assert.strictEqual(table.get(result.replace(/^BY=1:/, "")), "ok");
            }
            const offered = fixes(text, dialect).map(([, fixed]) => fixed);
            const wanted = needsCircles && !dialect.gxr ? [] : [result];
            assert.deepStrictEqual(offered, wanted);
        }
    });

    // The edit copies the arguments as typed, not as the lexer reads them (it reads U+0141 as A), which Copilot noticed.
    it.each([
        ["ORIGIN \u0141,2", "VDU29,\u0141;2;"],
        ['ORIGIN LEN"\u0141\u014a",2', 'VDU29,LEN"\u0141\u014a";2;'],
    ])("%s should offer %s, with the characters as typed", (text, result) => {
        for (const dialect of [BasicIIDialect, BasicIVDialect]) {
            assert.deepStrictEqual(
                fixes(text, dialect).map(([, fixed]) => fixed),
                [result],
            );
        }
    });
    // BY is a variable in BASIC II and IV, so a sign or operator after it is the variable's, and the ROM runs the line
    // (#354). Each row is recorded on both ROMs with BY defined, and has no error and so no fix. A space before ! ?
    // $ or ( makes it the BASIC V form, as the next table has.
    const variableOperators = [
        "-1", " -1", "+1", " +1", "!1", "?1", "*1", " *1", "/1", " /1", "^1", " ^1", "<1", " <1", ">1", " >1",
        "=1", " =1", " AND 1", " OR 1", " EOR 1", " DIV 1", " MOD 1",
    ]; // prettier-ignore
    it.each(["MOVE", "DRAW"].flatMap(kw => variableOperators.map(operator => [kw, operator])))(
        "%s BY%s,2 should be a variable and offer no fix",
        (kw, operator) => {
            const text = `BY=1:${kw} BY${operator},2`;
            assert.strictEqual(verdicts.get(text), "ok");
            assert.strictEqual(masterVerdicts.get(text), "ok");
            for (const dialect of [
                BasicIIDialect,
                ModelBNoGxrDialect,
                ModelBDialect,
                BasicIVDialect,
            ]) {
                assert.deepStrictEqual(getSyntaxMarkers(text, dialect), []);
                assert.deepStrictEqual(fixes(text, dialect), []);
            }
        },
    );
    it.each([
        "DIM BY(3):MOVE BY(1),2",
        "DIM BY(3):MOVE BY(1)+1,2",
        "DIM BY(3):DRAW BY(1),2",
        "DIM BY(3):DRAW BY(1)+1,2",
        "BY=1:MOVE BY-1,2:PRINT",
        "BY=1:DRAW BY-1,2:PRINT",
    ])("%s should be a variable and offer no fix", text => {
        assert.strictEqual(verdicts.get(text), "ok");
        assert.strictEqual(masterVerdicts.get(text), "ok");
        for (const dialect of [BasicIIDialect, BasicIVDialect]) {
            assert.deepStrictEqual(getSyntaxMarkers(text, dialect), []);
            assert.deepStrictEqual(fixes(text, dialect), []);
        }
    });
    // Where the ROMs stop (a space before the sign or the bracket, or a number or name after BY), BY is the BASIC V
    // word, and POINT BY has no variable reading with any operator, as POINT is not a statement of BASIC II or IV.
    it.each([
        ["BY=1:MOVE BY !1,2", "BY=1:PLOT0,!1,2"],
        ["BY=1:MOVE BY ?1,2", "BY=1:PLOT0,?1,2"],
        ["BY=1:MOVE BY (1),2", "BY=1:PLOT0,(1),2"],
        ["BY=1:MOVE BY Y,2", "BY=1:PLOT0,Y,2"],
        ["BY=1:DRAW BY !1,2", "BY=1:PLOT1,!1,2"],
        ["BY=1:DRAW BY ?1,2", "BY=1:PLOT1,?1,2"],
        ["BY=1:DRAW BY (1),2", "BY=1:PLOT1,(1),2"],
        ["BY=1:DRAW BY Y,2", "BY=1:PLOT1,Y,2"],
        ["POINT BY-1,2", "PLOT&61,-1,2"],
        ["POINT BY+1,2", "PLOT&61,+1,2"],
        ["POINT BY!1,2", "PLOT&61,!1,2"],
        ["POINT BY?1,2", "PLOT&61,?1,2"],
        ["POINT BY -1,2", "PLOT&61,-1,2"],
        ["POINT BY +1,2", "PLOT&61,+1,2"],
        ["POINT BY !1,2", "PLOT&61,!1,2"],
        ["POINT BY ?1,2", "PLOT&61,?1,2"],
        ["POINT BY (1),2", "PLOT&61,(1),2"],
        ["POINT BY Y,2", "PLOT&61,Y,2"],
        ["POINT -1,2", "PLOT&65,-1,2"],
        ["POINT +1,2", "PLOT&65,+1,2"],
        ["POINT !1,2", "PLOT&65,!1,2"],
        ["POINT ?1,2", "PLOT&65,?1,2"],
        ["POINT (1),2", "PLOT&65,(1),2"],
    ])("%s should offer %s, as BY is not a variable there", (text, result) => {
        assert.notStrictEqual(verdicts.get(text), "ok");
        assert.notStrictEqual(masterVerdicts.get(text), "ok");
        assert.strictEqual(verdicts.get(result.replace(/^BY=1:/, "")), "ok");
        for (const dialect of [BasicIIDialect, ModelBNoGxrDialect, ModelBDialect, BasicIVDialect]) {
            assert.deepStrictEqual(
                fixes(text, dialect).map(([, fixed]) => fixed),
                [result],
            );
        }
    });
    it("should read the circle codes of PLOT as the Master's and the GXR's", () => {
        const model = {isMaster: false};
        assert.strictEqual(dialectFor(model), ModelBDialect);
        assert.strictEqual(dialectFor(model, true), ModelBDialect);
        assert.strictEqual(dialectFor(model, false), ModelBNoGxrDialect);
        assert.strictEqual(dialectFor({isMaster: true}, false), BasicIVDialect);
        assert.deepStrictEqual(
            [BasicIIDialect, ModelBNoGxrDialect, ModelBDialect, BasicIVDialect].map(({gxr}) => gxr),
            [false, false, true, true],
        );
    });
    it("should title the fix with the text it replaces", () => {
        assert.deepStrictEqual(fixes("OFF", BasicIIDialect), [
            ["Replace OFF with VDU 23,1,0;0;0;0;", "VDU 23,1,0;0;0;0;"],
        ]);
        assert.deepStrictEqual(fixes("X=1:LINE 1,2,3,4:PRINT", BasicIIDialect), [
            ["Replace LINE 1,2,3,4 with MOVE 1,2:DRAW 3,4", "X=1:MOVE 1,2:DRAW 3,4:PRINT"],
        ]);
    });
    // Each is an error with no fix: the arguments do not split into the form's count (so that nothing is guessed), the
    // statement is not the BASIC V form (MOVE BY1,2 and MOVE BY,2 are variables), or it is valid.
    it.each([
        "OFF 1",
        "LINE 1,2,3",
        "LINE 1,2,3,4,5",
        "LINE 1,,3,4",
        "POINT 1",
        "POINT (1,2)",
        "POINT 1,2 REM x",
        "MOVE BY",
        "BY=1:MOVE BY,2",
        "BY=1:MOVE BY -1,2",
        "BY1=1:MOVE BY1,2",
        "POINT BY,2",
        "POINT BY*1,2",
        "POINT BY AND 1,2",
        "ON ERROR OFF",
        "ON ERROR LINE 1,2",
        "TRACE OFF",
    ])("%s should offer no fix", text => {
        for (const dialect of [BasicIIDialect, BasicIVDialect])
            assert.deepStrictEqual(fixes(text, dialect), []);
    });
    it("should say that BASIC V accepts the statement, after the ROM's words", () => {
        assert.deepStrictEqual(
            getSyntaxMarkers("ORIGIN 1,2", BasicIIDialect).map(m => [m.severity, m.message]),
            [
                [
                    MarkerSeverity.Error,
                    "BASIC V accepts ORIGIN X,Y, which sets the graphics origin; BASIC II and IV have no such statement, but VDU29,X;Y; does the same (BASIC: Syntax error)",
                ],
            ],
        );
    });
});

describe("BASIC V operators", () => {
    const accepts = (operator, does, rom) =>
        `BASIC V accepts ${operator}, which ${does}; BASIC II and IV have no such operator${rom ? ` (BASIC: ${rom})` : ""}`;
    const shiftLeft = rom => accepts("<<", "shifts left", rom);
    const adds = accepts("+=", "adds to the variable", "Mistake");
    const appends = accepts("+=", "appends to the string", "Mistake");
    const subtractsNoString =
        "BASIC V accepts -= only for a number, and stops with Type mismatch on a string; BASIC II and IV have no such operator (BASIC: Mistake)";
    // Each is a recorded row that both ROMs stop at, with the same error (#364). BASIC V's operator is named only where
    // there is one: not with a space inside it, nor for the operators BASIC V does not have either.
    // None has a fix: A=A+1 is not the same as A+=1 (docs/rom-deviations.md says why). What the right side of a += or -=
    // is plays no part, so A$+=1, a Type mismatch on BASIC V, still says that += appends.
    it.each([
        ["A=1<<3", shiftLeft("No such variable")],
        ["A=A>>2", accepts(">>", "shifts right, keeping the sign", "No such variable")],
        ["A=A>>>2", accepts(">>>", "shifts right, filling with zeros", "No such variable")],
        ["PRINT 1<<3", shiftLeft("No such variable")],
        ["P.FNf(1<<3)", shiftLeft(null)],
        ["A+=1", adds],
        ["A += 1", adds],
        ["X%(1)+=1", adds],
        ["!D+=1", adds],
        ["LET A+=1", adds],
        ["A-=1", accepts("-=", "subtracts from the variable", "Mistake")],
        ['A$+="x"', appends],
        ['LETA$+="x"', appends],
        ['X$(1)+="x"', appends],
        ['$D+="x"', appends],
        ["A$+=1", appends],
        ['A$-="x"', subtractsNoString],
        ['LETA$-="x"', subtractsNoString],
        ['X$(1)-="x"', subtractsNoString],
        ['$D-="x"', subtractsNoString],
        ["A$-=1", subtractsNoString],
        ["A=1< <3", "Expected a value here, not < (BASIC: No such variable)"],
        ["A=1>>=3", "Expected a value here, not >= (BASIC: No such variable)"],
        ["A+ =1", "A is read as a variable, so + is not expected here (BASIC: Mistake)"],
        ["A*=1", "A is read as a variable, so * is not expected here (BASIC: Mistake)"],
        ["A/=1", "A is read as a variable, so / is not expected here (BASIC: Mistake)"],
        ["A^=1", "A is read as a variable, so ^ is not expected here (BASIC: Mistake)"],
        ["A<<=1", "A is read as a variable, so < is not expected here (BASIC: Mistake)"],
        ["A>>=1", "A is read as a variable, so > is not expected here (BASIC: Mistake)"],
    ])("%s", (text, message) => {
        for (const [dialect, table] of [
            [BasicIIDialect, verdicts],
            [BasicIVDialect, masterVerdicts],
        ]) {
            assert.notStrictEqual(table.get(text) ?? "ok", "ok", `${text} is not a recorded error`);
            assert.deepStrictEqual(
                getSyntaxMarkers(text, dialect).map(m => [m.severity, m.message]),
                [[MarkerSeverity.Error, message]],
            );
            assert.deepStrictEqual(fixes(text, dialect), []);
        }
    });
});

describe("BASIC IV's assembler on BASIC II", () => {
    const BasicIVOnly = "BRA CLR DEA INA PHX PHY PLX PLY STZ TRB TSB".split(" ");
    const iv = mnemonic => `${mnemonic} is a BASIC IV instruction, which BASIC II does not have`;
    // The instructions BASIC IV's assembler has over BASIC II's, from enumerating every three-letter word on both ROMs
    // (#311); each is a recorded row that BASIC II stops at and BASIC IV assembles.
    it("should know exactly the instructions the ROMs differ by", () => {
        const only = mnemonicsFor(BasicIVDialect).filter(
            mnemonic => !mnemonicsFor(BasicIIDialect).includes(mnemonic),
        );
        assert.deepStrictEqual(only.sort(), BasicIVOnly);
    });
    it.each([
        ["[PLX:]", iv("PLX")],
        ["[PLY:]", iv("PLY")],
        ["[STZZ%:]", iv("STZ")],
        ["[BRAP%:]", iv("BRA")],
        ["[OPT0:DEA:]", iv("DEA")],
        ["[OPT0:INA:]", iv("INA")],
        ["[OPT0:PHX:]", iv("PHX")],
        ["[OPT0:PHY:]", iv("PHY")],
        ["[OPT0:CLR 1:]", iv("CLR")],
        ["[OPT0:TRB 1:]", iv("TRB")],
        ["[OPT0:TSB 1:]", iv("TSB")],
        ["[OPT0:STZ 1,X:]", iv("STZ")],
        ["[OPT0:stz 1:]", iv("STZ")],
        ["[OPT0:Bra 1:]", iv("BRA")],
        ["[OPT0:plx:]", iv("PLX")],
        ["[OPT0:LDA #1:PLX:LDA #2:]", iv("PLX")],
    ])("BASIC II: %s should say %j", (text, explanation) => {
        assert.strictEqual(verdicts.get(text), "Syntax error");
        assert.strictEqual(masterVerdicts.get(text)?.startsWith("Syntax"), false);
        const [marker] = getSyntaxMarkers(text, BasicIIDialect);
        assert.strictEqual(marker.message, `${explanation} (BASIC: Syntax error)`);
        assert.strictEqual(marker.severity, MarkerSeverity.Error);
        assert.deepStrictEqual(fixes(text, BasicIIDialect), []);
        assert.deepStrictEqual(getSyntaxMarkers(text, BasicIVDialect), []);
    });
    it("should mark from the mnemonic, as BASIC stops there", () => {
        const [marker] = getSyntaxMarkers("[OPT0:LDA #1:STZZ%:]", BasicIIDialect);
        assert.deepStrictEqual(
            [marker.startColumn, marker.endColumn],
            ["[OPT0:LDA #1:".length + 1, "[OPT0:LDA #1:STZZ%".length + 1],
        );
    });
    it.each(["[OPT0:XYZ 1:]", "[OPT0:RMB 1:]", "[OPT0:WAI:]"])(
        "BASIC II: %s, which is not one of them, should say only what BASIC says",
        text => {
            assert.strictEqual(verdicts.get(text), "Syntax error");
            const [marker] = getSyntaxMarkers(text, BasicIIDialect);
            assert.match(marker.message, /^\S+ is not expected here \(BASIC: Syntax error\)$/);
        },
    );
    // Each is a recorded row that stops with a Syntax error on BASIC II, and assembles with the A in capitals.
    it.each([
        ["[ORa#10:]", "[ORA#10:]"],
        ["[OPT0:ORa 1:]", "[OPT0:ORA 1:]"],
        ["[OPT0:ORa 1", "[OPT0:ORA 1"],
        ["[OPT0:ORa (1),Y:]", "[OPT0:ORA (1),Y:]"],
        ["[OPT0:ORa 1,X:]", "[OPT0:ORA 1,X:]"],
    ])("BASIC II: %s should offer Replace ORa with ORA, leaving %s", (text, result) => {
        assert.deepStrictEqual([verdicts.get(text), verdicts.get(result)], ["Syntax error", "ok"]);
        assert.strictEqual(masterVerdicts.get(text), "ok");
        const [marker] = getSyntaxMarkers(text, BasicIIDialect);
        assert.strictEqual(
            marker.message,
            "BASIC II reads the A of ORA only in capitals: A, not a (BASIC: Syntax error)",
        );
        assert.strictEqual(marker.severity, MarkerSeverity.Error);
        assert.deepStrictEqual(fixes(text, BasicIIDialect), [["Replace ORa with ORA", result]]);
        assert.deepStrictEqual(getSyntaxMarkers(result, BasicIIDialect), []);
    });
    // The capitalised statement is still wrong, or the A is not what is wrong: there is no fix.
    it.each([
        ["[OPT0:ORa 1,x:]", "BASIC II reads the A of ORA only in capitals: A, not a"],
        ["[OPT0:ORa:]", "BASIC II reads the A of ORA only in capitals: A, not a"],
    ])("BASIC II: %s should say what is wrong but offer no fix", (text, explanation) => {
        assert.strictEqual(verdicts.get(text), "Syntax error");
        const [marker] = getSyntaxMarkers(text, BasicIIDialect);
        assert.strictEqual(marker.message, `${explanation} (BASIC: Syntax error)`);
        assert.deepStrictEqual(fixes(text, BasicIIDialect), []);
    });
    it.each(["[OPT0:OR a 1:]", "[OPT0:ORb 1:]"])(
        "BASIC II: %s is not an ORa, so should say only what BASIC says",
        text => {
            assert.strictEqual(verdicts.get(text), "Syntax error");
            const [marker] = getSyntaxMarkers(text, BasicIIDialect);
            assert.match(marker.message, /\(BASIC: Syntax error\)$/);
            assert.doesNotMatch(marker.message, /capitals/);
            assert.deepStrictEqual(fixes(text, BasicIIDialect), []);
        },
    );
    it.each(["[OPT0:Ora 1:]", "[OPT0:ora 1:]", "[OPT0:orA 1:]", "[OPT0:ORA 1:]"])(
        "BASIC II: %s is accepted, so should have no marker",
        text => {
            assert.strictEqual(verdicts.get(text), "ok");
            assert.deepStrictEqual(getSyntaxMarkers(text, BasicIIDialect), []);
        },
    );
    it("should mend ORa on a later line of an assembler block", () => {
        assert.deepStrictEqual(fixes("[\nORa 1\n]", BasicIIDialect), [
            ["Replace ORa with ORA", "[\nORA 1\n]"],
        ]);
    });
});

describe("Syntax markers", () => {
    const Unfinished = (needed, after, rom) => `Expected ${needed} after ${after} (BASIC: ${rom})`;
    const markers = text =>
        getSyntaxMarkers(text, ModelBDialect).map(m => [
            m.severity,
            m.message,
            m.startLineNumber,
            m.startColumn,
            m.endColumn,
        ]);
    it("should show a line that ends too soon as information at its end", () => {
        assert.deepStrictEqual(markers("GOTO"), [
            [MarkerSeverity.Warning, Unfinished("a value", "GOTO", "No such variable"), 1, 1, 5],
        ]);
        assert.deepStrictEqual(markers("10 FOR I=1 TO "), [
            [MarkerSeverity.Warning, Unfinished("a value", "TO", "No such variable"), 1, 12, 15],
        ]);
        assert.deepStrictEqual(markers('X=1\nPRINT "HI'), [
            [MarkerSeverity.Warning, Unfinished("a closing quote", '"HI', 'Missing "'), 2, 7, 10],
        ]);
        assert.deepStrictEqual(markers("A$=LEFT$(X$"), [
            [MarkerSeverity.Warning, Unfinished("a comma", "X$", "Missing ,"), 1, 10, 12],
        ]);
    });
    it("should say plainly what BASIC does where a marker is stricter than the ROM, as an error", () => {
        const reads =
            "LD is not an instruction: the register letter is missing. BASIC reads the 8 as X (LDX), so what follows is the address; probably LDA, LDX or LDY was meant";
        assert.deepStrictEqual(markers("[LD89"), [[MarkerSeverity.Error, reads, 1, 2, 4]]);
    });
    it("should say what BASIC II and IV do with ON ERROR LOCAL, as an error on the LOCAL", () => {
        const message =
            "BASIC V accepts ON ERROR LOCAL (not emulated here), but BASIC II and IV take LOCAL as the error handler: the first error fails with Not LOCAL, which runs the handler again, so the program loops forever and Escape does not stop it";
        assert.deepStrictEqual(markers("ON ERROR LOCAL X"), [
            [MarkerSeverity.Error, message, 1, 10, 15],
        ]);
    });
    it("should say that a keyword straight after a mnemonic is read as a variable, and a space was meant", () => {
        const message =
            "H. here is read as the variable H, not the keyword: BASIC recognises a keyword only at the start of a word, and this follows STA with no space, so the rest of the instruction is ignored; probably a space was meant after STA";
        assert.deepStrictEqual(markers("[OPT0:STAH.,X:]"), [
            [MarkerSeverity.Error, message, 1, 10, 12],
        ]);
    });
    it("should show something missing from the middle of a statement at the token where it stops", () => {
        assert.deepStrictEqual(markers("A$=LEFT$(X$)"), [
            [MarkerSeverity.Warning, "Expected a comma before ) (BASIC: Missing ,)", 1, 12, 13],
        ]);
    });
    // The red starts at the comma before the first argument too many, where BASIC stops, and runs to the end of the
    // statement.
    describe.each([
        ["BASIC II", ModelBDialect, verdicts],
        ["BASIC IV", BasicIVDialect, masterVerdicts],
    ])("an argument too many on %s", (name, dialect, table) => {
        const TooMany = "Too many arguments before )";
        const NoClose = "Expected a closing ) here, not ,";
        it.each([
            ["A$=LEFT$(X$,1,2)", ",2)", TooMany],
            ["X=RND(1,2)", ",2)", TooMany],
            ["A$=LEFT$(X$,1,2,3,4)", ",2,3,4)", TooMany],
            ["A$=MID$(X$,1,2,3,4)", ",3,4)", TooMany],
            ["A$=STRING$(2,X$,3)", ",3)", TooMany],
            ["X=INSTR(X$,X$,1,2)", ",2)", TooMany],
            ["X=POINT(1,2,3)", ",3)", TooMany],
            ["PRINT TAB(1,2,3)", ",3)", TooMany],
            ["PRINT SPC(1,2)", ",2)", TooMany],
            ["X=(1,2,3)", ",2,3)", TooMany],
            ["X=RND(1 , 2 )", ", 2 )", TooMany],
            ["X=RND(1,)", ",)", TooMany],
            ["X=RND(1,FNa(2,3))", ",FNa(2,3))", TooMany],
            ["X=RND(1,(2,3))", ",(2,3))", TooMany],
            ['X=RND(1,"a)b")', ',"a)b")', TooMany],
            ['X=RND(1,"a(")', ',"a(")', TooMany],
            ["X=SQR(RND(1,2))", ",2))", TooMany],
            ["X=RND(1,2)+1", ",2)+1", TooMany],
            ["IF 1 THEN X=RND(1,2) ELSE PRINT", ",2)", TooMany],
            ["X=RND(1,2", ",2", NoClose],
            ["X=RND(1,2:PRINT", ",2", NoClose],
            ["X=RND(1,2 ELSE )", ",2", NoClose],
            ["X=RND(1,FNa(2)", ",FNa(2)", NoClose],
            ["X=RND(1,LEFT$(X$,1)", ",LEFT$(X$,1)", NoClose],
            ["X=RND(1,LE.X$,1)", ",LE.X$,1)", NoClose],
        ])("%s", (text, marked, message) => {
            const found = getSyntaxMarkers(text, dialect).map(m => [
                text.slice(m.startColumn - 1, m.endColumn - 1),
                m.message,
            ]);
            assert.deepStrictEqual(found, [[marked, `${message} (BASIC: ${table.get(text)})`]]);
        });
        // In an assembler block the statement also ends at the "]"; the statement after it has its own marker.
        it.each([
            ["[OPT0:LDA RND(1,2):]", ",2)", TooMany],
            ['[OPT0:LDA RND(1,"]",2)]', ',"]",2)', TooMany],
            ['[OPT0:EQUS LEFT$("])",1,2)]', ",2)", TooMany],
            ["[OPT0:LDA RND(1,2]", ",2", NoClose],
            ["[OPT0:LDA RND(1,2] PRINT RND(1,3))", ",2", NoClose],
            ["[OPT0:LDA RND(1,2]:X=RND(1,3))", ",2", NoClose],
            ["[OPT0:LDA RND(1,2:LDA RND(1,3)):]", ",2", NoClose],
            ["IF X THEN [OPT0:LDA RND(1,2 ELSE PRINT RND(1,3))", ",2", NoClose],
        ])("%s", (text, marked, message) => {
            const [first] = getSyntaxMarkers(text, dialect);
            assert.deepStrictEqual(
                [text.slice(first.startColumn - 1, first.endColumn - 1), first.message],
                [marked, `${message} (BASIC: ${table.get(text)})`],
            );
        });
    });
    it("should not mark the line the cursor is on as unfinished, only the others", () => {
        const text = "FOR I=1 TO\nGOTO 20 30\nPRINT (";
        const at = line =>
            getSyntaxMarkers(text, ModelBDialect, line).map(m => [m.severity, m.startLineNumber]);
        const error = [MarkerSeverity.Error, 2];
        assert.deepStrictEqual(at(0), [
            [MarkerSeverity.Warning, 1],
            error,
            [MarkerSeverity.Warning, 3],
        ]);
        assert.deepStrictEqual(at(1), [error, [MarkerSeverity.Warning, 3]]);
        assert.deepStrictEqual(at(2), [
            [MarkerSeverity.Warning, 1],
            error,
            [MarkerSeverity.Warning, 3],
        ]);
        assert.deepStrictEqual(at(3), [[MarkerSeverity.Warning, 1], error]);
    });
    it("should leave a warning to say what it says about the same text", () => {
        assert.deepStrictEqual(markers("x == 3"), []);
        assert.deepStrictEqual(markers("A=2**3"), []);
        assert.deepStrictEqual(markers("colour"), []);
    });
    it("should mark a block that is never closed once, at its [", () => {
        const program = ["MODE 7", "[OPT 0", "LDA #", "STA &70 FOR", "RTS", "PRINT )", "END"].join(
            "\n",
        );
        assert.deepStrictEqual(markers(program), [
            [
                MarkerSeverity.Error,
                "Assembler block not closed: there is no ] after this [",
                2,
                1,
                2,
            ],
        ]);
        const closed = markers(`${program}\n]`);
        assert.ok(
            closed.length > 1 && closed.every(([, message]) => !message.startsWith("Assembler")),
        );
    });
    it.each([
        ["GOTO 20 30", "30 is not expected here (BASIC: Syntax error)", 9, 11],
        ["PRINT )", "Expected a value here, not ) (BASIC: No such variable)", 7, 8],
        ["X=1+*", "Expected a value here, not * (BASIC: No such variable)", 5, 6],
        ["X=(1+:Y=2", "Expected a value after + (BASIC: No such variable)", 5, 6],
        ["FOR I=1:NEXT", "Expected TO after 1 (BASIC: No TO)", 7, 8],
        ["A$=LEFT$(X$,1,2)", "Too many arguments before ) (BASIC: Missing ))", 14, 17],
        ["X=RND(1,:P.", "Expected a closing ) here, not , (BASIC: Missing ))", 8, 9],
        ["A=1'", "' is not expected here (BASIC: Syntax error)", 4, 5],
        [
            "10 FO I%=1 TO 10",
            "FO is read as a variable, so I% is not expected here; did you mean FOR? (BASIC: Mistake)",
            7,
            17,
        ],
    ])(
        "should say in plain words where BASIC stops, with its own error in brackets: %s",
        (text, message, start, end) => {
            assert.deepStrictEqual(
                markers(text),
                [[MarkerSeverity.Error, message, 1, start, end]],
                text,
            );
        },
    );
    // "here, not" where BASIC stops at the marked token, and "after" where it stops after it; the error in brackets is
    // the recorded one.
    describe.each([
        ["BASIC II", ModelBDialect, verdicts],
        ["BASIC IV", BasicIVDialect, masterVerdicts],
    ])("on %s", (_, dialect, table) => {
        it.each([
            ["PRINT (1 2:PRINT", "Expected a closing ) here, not 2"],
            ["PRINT (1 2", "Expected a closing ) here, not 2"],
            ["FOR I=1 2:NEXT", "Expected TO here, not 2"],
            ['X$=LEFT$("A" 2:P.', "Expected a comma here, not 2"],
            ['X=INSTR("A" "B"', 'Expected a comma here, not "B"'],
            ["MOVE 1 2:P.", "Expected a comma here, not 2"],
            ["BPUT 1", "Expected a # here, not 1"],
            ["X=1+*", "Expected a value here, not *"],
            ["PRINT GOTO", "Expected a value here, not GOTO"],
            ["X=RND(1,", "Expected a closing ) here, not ,"],
            ["FOR I=1 T", "Expected TO here, not T"],
            ["[OPT0:LDA #]", "Expected a value here, not ]"],
            ["PRINT (1:PRINT", "Expected a closing ) after 1"],
            ['X$=LEFT$("A",1:P.', "Expected a closing ) after 1"],
            ["PRINT TAB(1:P.", "Expected a comma or a closing ) after 1", false],
            ["FOR I=1:NEXT", "Expected TO after 1"],
            ["FOR I=(1):NEXT", "Expected TO after )"],
            ["X=(1+:Y=2", "Expected a value after +"],
            ["X=&G", "Expected a hex digit after &"],
            ["X=&:P.", "Expected a hex digit after &"],
            ['X$="A', 'Expected a closing quote after "A'],
        ])("%s should say %j", (text, plain, worded = true) => {
            const rom = table.get(text);
            assert.ok(rom, `${text} is not a recorded row`);
            const [marker] = getSyntaxMarkers(text, dialect);
            assert.strictEqual(marker.message, worded ? `${plain} (BASIC: ${rom})` : plain);
        });
    });
    // BASIC stops with Bad call at a FN or PROC with no name straight after it, and the mark is on the keyword; a
    // warning where a name could still be typed. In text BASIC skips (IF 0 THEN, after END) it is marked all the same.
    describe.each([
        ["BASIC II", ModelBDialect, verdicts],
        ["BASIC IV", BasicIVDialect, masterVerdicts],
    ])("a FN or PROC with no name on %s", (_, dialect, table) => {
        const Fn = "FN needs a function name straight after it, with no space (BASIC: Bad call)";
        const Proc =
            "PROC needs a procedure name straight after it, with no space (BASIC: Bad call)";
        const {Error: Stops, Warning: EndsTooSoon} = MarkerSeverity;
        it.each([
            ["IF FN THEN X=1", Stops, "FN THEN X=1", Fn],
            ["IF FN X=1", Stops, "FN X=1", Fn],
            ["IF FN X=1 ELSE Y=1", Stops, "FN X=1", Fn],
            ["IF FN LETX=1", Stops, "FN LETX=1", Fn],
            ["PROC(1)", Stops, "PROC(1)", Proc],
            ["PROC (1)", Stops, "PROC (1)", Proc],
            ["PROC X", Stops, "PROC X", Proc],
            ["PROC:", Stops, "PROC", Proc],
            ["PROC ELSE X=1", Stops, "PROC", Proc],
            ["PROC.5", Stops, "PROC.5", Proc],
            ["PROC%", Stops, "PROC%", Proc],
            ["X=FN(1)", Stops, "FN(1)", Fn],
            ["X=FN+FNf", Stops, "FN+FNf", Fn],
            ["X=FN:Y=1", Stops, "FN", Fn],
            ["PRINT FN;", Stops, "FN;", Fn],
            ["PROC", EndsTooSoon, "PROC", Proc],
            ["PRO.", EndsTooSoon, "PRO.", Proc],
            ["X=FN", EndsTooSoon, "FN", Fn],
            ["X=FNf+FN", EndsTooSoon, "FN", Fn],
            ["IF FN", EndsTooSoon, "FN", Fn],
            ["IF 1 THEN PROC", EndsTooSoon, "PROC", Proc],
            ["IF 0 THEN PROC", EndsTooSoon, "PROC", Proc],
            ["IF 1 THEN PROCp ELSE PROC", EndsTooSoon, "PROC", Proc],
            ["END:PROC", EndsTooSoon, "PROC", Proc],
        ])("%s", (text, severity, marked, message) => {
            assert.ok(["Bad call", "ok"].includes(table.get(text)), text);
            const found = getSyntaxMarkers(text, dialect).map(m => [
                m.severity,
                text.slice(m.startColumn - 1, m.endColumn - 1),
                m.message,
            ]);
            assert.deepStrictEqual(found, [[severity, marked, message]]);
        });
        it.each([
            "PROCp",
            "PROCq(1)",
            "PROCq (1)",
            "IF FNf THEN X=1",
            "X=FNf+1",
            "DEF PROC",
            "DEF FN",
        ])("should leave %s alone", text => {
            assert.strictEqual(table.get(text), "ok", text);
            assert.deepStrictEqual(getSyntaxMarkers(text, dialect), []);
        });
        // A call reads @ as part of the name, though the tokeniser does not (PROC@ is No such FN/PROC).
        it.each(["PROC@", "X=FN@"])("should not say Bad call for %s", text => {
            for (const {message} of getSyntaxMarkers(text, dialect))
                assert.ok(!message.includes("Bad call"), message);
        });
    });
    // An ON PROC list reads its first target only for 1; any other value looks for an ELSE anywhere on the line.
    it.each([
        ["ON 1 PROC", MarkerSeverity.Warning, "PROC"],
        ["ON X PROC", MarkerSeverity.Warning, "PROC"],
        ['ON 1 PROC:PRINT"ELSE"', MarkerSeverity.Error, "PROC"],
        ["ON 2 PROC ELSE Y=1", null, null],
        ["ON 2 PROC:X=1 ELSE Y=1", null, null],
        ["ON 2 PROC,PROCp", null, null],
    ])(
        "should mark the PROC of BASIC IV's %s only where every value stops",
        (text, severity, marked) => {
            assert.strictEqual(masterVerdicts.get(text), severity === null ? "ok" : "Bad call");
            const found = getSyntaxMarkers(text, BasicIVDialect).map(m => [
                m.severity,
                text.slice(m.startColumn - 1, m.endColumn - 1),
            ]);
            assert.deepStrictEqual(found, severity === null ? [] : [[severity, marked]]);
        },
    );
    it.each([
        ["[ASL42,Y:]", BasicIIDialect, "ASL cannot be indexed by Y, only by X"],
        ["[ASL42,Y:]", BasicIVDialect, "ASL cannot be indexed by Y, only by X"],
        ["[OPT0:LDX 42,X:]", BasicIIDialect, "LDX cannot be indexed by X, only by Y"],
        ["[OPT0:STZ 42,Y:]", BasicIVDialect, "STZ cannot be indexed by Y, only by X"],
        ["[OPT0:LDA Z,Z:]", BasicIIDialect, "Z is not an index register: LDA takes X or Y"],
        [
            "[OPT0:LDA 42,:]",
            BasicIIDialect,
            "Expected an index register after the comma: LDA takes X or Y",
        ],
        [
            "[OPT0:LDA 42,x:]",
            BasicIIDialect,
            "BASIC II reads the index register after LDA only in capitals: X, not x",
        ],
        [
            "[OPT0:LDA (42,Y):]",
            BasicIIDialect,
            "LDA cannot be indexed by Y inside the brackets, only by X",
        ],
        [
            "[OPT0:JMP (42,Y):]",
            BasicIVDialect,
            "JMP cannot be indexed by Y inside the brackets, only by X",
        ],
        [
            "[OPT0:LDA (42),X:]",
            BasicIVDialect,
            "LDA cannot be indexed by X after the brackets, only by Y",
        ],
        [
            "[OPT0:LDA (42):]",
            BasicIIDialect,
            "Expected ,Y after ): BASIC II has LDA (address),Y but not LDA (address)",
        ],
        [
            "[OPT0:JMP (42,X):]",
            BasicIIDialect,
            "BASIC II has JMP (address) but not JMP (address,X)",
        ],
        ["[OPT0:LDA (42,X Z:]", BasicIIDialect, "Expected a closing ) here, not Z"],
        ["[OPT0:JMP (42:]", BasicIVDialect, "Expected a closing ) after 42"],
    ])(
        "should say what is wrong with an operand where BASIC says Index: %s",
        (text, dialect, message) => {
            const table = dialect === BasicIVDialect ? masterVerdicts : verdicts;
            assert.strictEqual(table.get(text), "Index", text);
            assert.deepStrictEqual(
                getSyntaxMarkers(text, dialect).map(marker => marker.message),
                [`${message} (BASIC: Index)`],
                text,
            );
        },
    );
    it("should end each message with the ROM's own error for every row of the ROM table", () => {
        const wrong = [...verdicts].flatMap(([text, verdict]) =>
            verdict === "ok"
                ? []
                : getSyntaxMarkers(text, ModelBDialect)
                      .filter(marker => marker.message.includes("(BASIC: "))
                      .filter(marker => !marker.message.endsWith(`(BASIC: ${verdict})`))
                      .map(marker => [text, verdict, marker.message]),
        );
        assert.deepStrictEqual(wrong, []);
    });
    it("should keep the code out of what the editor shows, and still find the fix from the text", () => {
        const text = "[OPT0:NOP hello:]";
        const shown = withoutCodes(getSyntaxMarkers(text, ModelBDialect));
        assert.ok(shown.length > 0 && shown.every(marker => marker.code === undefined));
        const model = editor.createModel(text, LanguageId);
        try {
            const {actions} = codeActionProviderFor(ModelBDialect).provideCodeActions(
                model,
                shown[0],
                {
                    markers: shown,
                },
            );
            assert.deepStrictEqual(
                actions.map(action => action.title),
                ["Insert \\ before the junk"],
            );
        } finally {
            model.dispose();
        }
    });
    it("should show nothing for a line that is complete", () => {
        for (const text of ["GOTO 20", "FOR I=1 TO 10", "IF A=1 THEN PRINT 2", "REM GOTO 20 30"])
            assert.deepStrictEqual(markers(text), [], text);
    });
    it("should follow an assembler block over the lines", () => {
        assert.deepStrictEqual(markers("[\nLDA #\n]"), [
            [MarkerSeverity.Warning, Unfinished("a value", "#", "No such variable"), 2, 5, 6],
        ]);
    });
});

describe("Problem count", () => {
    const marker = severity => ({severity});
    it.each([
        [{syntax: [], lineNumbers: [], warnings: []}, ""],
        [
            {
                syntax: [marker(MarkerSeverity.Error), marker(MarkerSeverity.Warning)],
                lineNumbers: [marker(MarkerSeverity.Error)],
                warnings: [marker(MarkerSeverity.Warning)],
            },
            "2 errors, 1 unfinished, 1 warning",
        ],
        [{syntax: [marker(MarkerSeverity.Error)], lineNumbers: [], warnings: []}, "1 error"],
    ])("should summarise %j as %j", (markers, summary) => {
        assert.strictEqual(problemCount(markers), summary);
    });
});

describe("Bracket pairs", () => {
    // The line's pairs as "opener~closer" ("-" for none), in the model Monaco keeps, where "." opens only for an abbreviated opener.
    const pairsOfLine = (model, line) =>
        model.bracketPairs
            .getBracketPairsInRange(new Range(line, 1, line, model.getLineMaxColumn(line)))
            .toArray()
            .map(
                pair =>
                    `${model.getValueInRange(pair.openingBracketRange)}~${pair.closingBracketRange ? model.getValueInRange(pair.closingBracketRange) : "-"}`,
            );
    const program = "A=1\nREP.IFb?-1<>90N.EL.?(PA.+3)=b\nQ$=MID.Q$,2)+STR.(Q%)";

    // An empty model whose tokenizing has completed, as the editor is while the page loads its saved program.
    function loadedModel() {
        const model = editor.createModel("", LanguageId);
        pairsOfLine(model, 1);
        model.tokenization.forceTokenization(1);
        // Reading the indentation of the new text is what has Monaco build its pairs before there are tokens.
        model.setValue(program);
        model.updateOptions({insertSpaces: !model.getOptions().insertSpaces});
        return model;
    }

    it("should pair a parenthesis once the program is loaded", () => {
        const model = loadedModel();
        rebuildBracketPairs(model);
        assert.deepStrictEqual(pairsOfLine(model, 2), ["(~)"]);
        assert.deepStrictEqual(pairsOfLine(model, 3), [".~)", "(~)"]);
        model.dispose();
    });
    it("should pair a parenthesis after the language is registered again", () => {
        const model = loadedModel();
        assert.notDeepStrictEqual(pairsOfLine(model, 2), ["(~)"]);
        registerBbcBasicLanguage(ModelBDialect);
        assert.deepStrictEqual(pairsOfLine(model, 2), ["(~)"]);
        model.dispose();
    });
});
