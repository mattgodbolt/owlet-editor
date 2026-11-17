import {debbreviate, expandCode} from "../src/expand-code";
import {Flags, isFnProc, keywords, pseudoVariables} from "../src/tokens";
import {
    BasicIIDialect,
    BasicIVDialect,
    LimitKeyword,
    ModelBDialect,
    canStartStatement,
} from "../src/parser/dialect";
import {RomTokens} from "./rom-tables";
import {describe, expect, it} from "vitest";
import assert from "assert";
import {Buffer} from "buffer";
import {existsSync, readdirSync, readFileSync} from "fs";

// The ROM images jsbeeb ships: BASIC II's on its own, and BASIC IV's inside the Master's 128K MOS image.
const RomDirectory = "node_modules/jsbeeb/public/roms";
const BasicIIRom = `${RomDirectory}/BASIC.ROM`;
const MasterRom = `${RomDirectory}/master/mos3.20`;
// The table starts with "AND", &80 and no flags, and ends with the statement form of HIMEM, &D3.
const TableStart = Buffer.from([0x41, 0x4e, 0x44, 0x80, 0x00]);
const LastTableToken = 0xd3;
const FirstKeywordCharacter = 0x20;
const FirstTokenByte = 0x80;
const RomFlagsMask = 0xff;

const romKeywords = path => {
    if (!existsSync(path))
        throw new Error(`jsbeeb no longer ships ${path}; point this test at the ROM it ships now`);
    const rom = readFileSync(path);
    const start = rom.indexOf(TableStart);
    if (start < 0 || rom.indexOf(TableStart, start + 1) >= 0) {
        throw new Error(`${path} should hold exactly one keyword table, starting AND &80 &00`);
    }
    const entries = [];
    for (let i = start; ;) {
        let keyword = "";
        while (rom[i] >= FirstKeywordCharacter && rom[i] < FirstTokenByte)
            keyword += String.fromCharCode(rom[i++]);
        const entry = {keyword, token: rom[i++], flags: rom[i++]};
        entries.push(entry);
        if (entry.token === LastTableToken) return entries;
        if (i >= rom.length)
            throw new Error(`${path}: the keyword table does not end with token &D3`);
    }
};
const ownRows = list =>
    list.map(kw => ({keyword: kw.keyword, token: kw.token, flags: kw.flags & RomFlagsMask}));

describe("The keyword table", () => {
    it("should be BASIC II's keyword table, row for row", () => {
        const rom = romKeywords(BasicIIRom);
        expect(rom).toHaveLength(126);
        expect(ownRows(keywords)).toEqual(rom);
    });
    it("should give BASIC IV's keyword table, row for row", () => {
        const rom = romKeywords(MasterRom);
        expect(rom).toHaveLength(128);
        expect(ownRows(BasicIVDialect.keywords)).toEqual(rom);
    });
    it("should mark as values the operators and the functions, but not TO", () => {
        const values = keywords.filter(kw => kw.flags & Flags.Expr).map(kw => kw.keyword);
        expect(values).toEqual([
            "AND",
            "ABS",
            "ACS",
            "ADVAL",
            "ASC",
            "ASN",
            "ATN",
            "BGET",
            "CHR$",
            "COS",
            "COUNT",
            "DEG",
            "DIV",
            "EVAL",
            "ERL",
            "EOF",
            "EOR",
            "ERR",
            "EXP",
            "EXT",
            "FALSE",
            "FN",
            "GET$",
            "GET",
            "HIMEM",
            "INKEY$",
            "INKEY",
            "INT",
            "INSTR(",
            "LOMEM",
            "LEFT$(",
            "LEN",
            "LOG",
            "LN",
            "MID$(",
            "MOD",
            "NOT",
            "OR",
            "OPENIN",
            "OPENOUT",
            "OPENUP",
            "PAGE",
            "PTR",
            "PI",
            "POINT(",
            "POS",
            "RAD",
            "RIGHT$(",
            "RND",
            "SGN",
            "SIN",
            "SQR",
            "STR$",
            "STRING$(",
            "TAN",
            "TIME",
            "TRUE",
            "USR",
            "VAL",
            "VPOS",
        ]);
    });
});

const FirstStatement = 0xc6;
const spellings = (rows, wanted) => [...new Set(rows.filter(wanted).map(row => row.keyword))];

// What each ROM's table says, by the ROM flag byte or the token range.
describe.each([
    ["BASIC II", BasicIIDialect, BasicIIRom, 0xcd],
    ["BASIC IV", BasicIVDialect, MasterRom, 0xce],
])("The facts derived from the table of %s", (_, dialect, rom, lastCommand) => {
    const romRows = romKeywords(rom);
    it("should have the pseudo-variables the ROM flags", () => {
        expect([...pseudoVariables].sort()).toEqual(
            spellings(romRows, row => row.flags & Flags.PseudoVariable).sort(),
        );
        expect([...pseudoVariables].sort()).toEqual(["HIMEM", "LOMEM", "PAGE", "PTR", "TIME"]);
    });
    it("should take FN and PROC as the keywords the ROM flags as taking a name", () => {
        expect(spellings(dialect.keywords, isFnProc)).toEqual(
            spellings(romRows, row => row.flags & Flags.FnProc),
        );
        expect(spellings(dialect.keywords, isFnProc)).toEqual(["FN", "PROC"]);
    });
    it("should start a statement with the statement tokens, ELSE and on BASIC IV EXT", () => {
        const starters = spellings(dialect.keywords, kw => canStartStatement(dialect, kw));
        const fromRom = spellings(
            romRows,
            row => row.token >= FirstStatement || row.keyword === "ELSE",
        );
        expect(starters.sort()).toEqual((dialect.basicIV ? [...fromRom, "EXT"] : fromRom).sort());
    });
    it("should take as commands the statements from AUTO up to the last the ROM has", () => {
        const fromRom = spellings(
            romRows,
            row => row.token >= FirstStatement && row.token <= lastCommand,
        );
        expect(dialect.immediateCommands).toEqual(fromRom);
        expect([...dialect.immediateCommands].sort()).toEqual(
            ["AUTO", "DELETE", "LIST", "LOAD", "NEW", "OLD", "RENUMBER", "SAVE"]
                .concat(dialect.basicIV ? ["EDIT"] : [])
                .sort(),
        );
    });
    it("should look up the line numbers of the keywords the ROM flags but for commands and TRACE", () => {
        const flagged = spellings(romRows, row => row.flags & Flags.LineNumber);
        expect(flagged.filter(word => !dialect.lineNumberLookups.has(word)).sort()).toEqual(
            [...dialect.immediateCommands.filter(word => flagged.includes(word)), "TRACE"].sort(),
        );
        expect([...dialect.lineNumberLookups].sort()).toEqual([
            "ELSE",
            "GOSUB",
            "GOTO",
            "RESTORE",
            "THEN",
        ]);
    });
    it("should put each keyword that takes a line number in exactly one of the commands, the lookups and the limit", () => {
        const expected = {
            AUTO: ["command"],
            DELETE: ["command"],
            ELSE: ["lookup"],
            GOSUB: ["lookup"],
            GOTO: ["lookup"],
            LIST: ["command"],
            RENUMBER: ["command"],
            RESTORE: ["lookup"],
            THEN: ["lookup"],
            TRACE: ["limit"],
            ...(dialect.basicIV ? {EDIT: ["command"]} : {}),
        };
        const classesOf = word =>
            [
                dialect.immediateCommands.includes(word) && "command",
                dialect.lineNumberLookups.has(word) && "lookup",
                word === LimitKeyword && "limit",
            ].filter(Boolean);
        const flagged = spellings(dialect.keywords, kw => kw.flags & Flags.LineNumber).sort();
        expect(flagged).toEqual(Object.keys(expected).sort());
        expect(Object.fromEntries(flagged.map(word => [word, classesOf(word)]))).toEqual(expected);
        expect([...dialect.lineNumberLookups].every(word => flagged.includes(word))).toBe(true);
    });
    it("should branch an ON to GOTO and GOSUB, and on BASIC IV PROC", () => {
        expect(dialect.onBranches).toEqual(
            dialect.basicIV ? ["GOTO", "GOSUB", "PROC"] : ["GOTO", "GOSUB"],
        );
    });
});

describe("The spellings the code compares keywords by", () => {
    const SourceDirectory = "src";
    const sourceFiles = directory =>
        readdirSync(directory, {withFileTypes: true}).flatMap(entry =>
            entry.isDirectory()
                ? sourceFiles(`${directory}/${entry.name}`)
                : entry.name.endsWith(".js")
                  ? [`${directory}/${entry.name}`]
                  : [],
        );
    // keyword === "X" and isKeyword("X", "Y"): the code that names a keyword by its spelling.
    const named = text => [
        ...[...text.matchAll(/keyword\s*[!=]==\s*"([^"]+)"/g)].map(match => match[1]),
        ...[...text.matchAll(/isKeyword\(((?:\s*"[^"]+",?)+)\)/g)].flatMap(match =>
            [...match[1].matchAll(/"([^"]+)"/g)].map(word => word[1]),
        ),
    ];
    it("should all be in a keyword table", () => {
        const table = new Set(BasicIVDialect.keywords.map(kw => kw.keyword));
        const spelled = sourceFiles(SourceDirectory).flatMap(file =>
            named(readFileSync(file, "utf8")).map(word => ({file, word})),
        );
        // Enough to show the patterns still find the code that does it.
        expect(spelled.length).toBeGreaterThan(30);
        expect(spelled.filter(({word}) => !table.has(word))).toEqual([]);
    });
});

describe("Expanding a token byte straight after DATA or REM", () => {
    it("should leave it raw, as the tokeniser does, however DATA or REM was written", () => {
        const cases = [
            ["D.", "DATA"],
            ["DAT.", "DATA"],
            ["DATA"],
            ["\xdc", "DATA"],
            ["REM"],
            ["\xf4", "REM"],
        ];
        for (const [keyword, expanded = keyword] of cases)
            assert.strictEqual(
                expandCode(`${keyword}\xf1A`, ModelBDialect),
                `${expanded}\xf1A`,
                keyword,
            );
    });
});

describe("Debbreviation", () => {
    it("should work with the empty string", () => {
        assert.strictEqual(debbreviate("", ModelBDialect), "");
    });
    it("should leave non-token things alone", () => {
        assert.strictEqual(debbreviate("I am a mongoose.", ModelBDialect), "I am a mongoose.");
    });
    it("should handle simple cases", () => {
        assert.strictEqual(debbreviate("P.", ModelBDialect), "PRINT");
    });
    it("should expand abbreviation after full token", () => {
        assert.strictEqual(debbreviate("IFCOU.", ModelBDialect), "IFCOUNT");
    });
    it("should not expand abbreviation after conditional token", () => {
        assert.strictEqual(debbreviate("PIP=1:P.PIP.", ModelBDialect), "PIP=1:PRINTPIP.");
    });
    it("should not expand abbreviation in *-command", () => {
        assert.strictEqual(debbreviate("*H.", ModelBDialect), "*H.");
        assert.strictEqual(debbreviate("10*H.", ModelBDialect), "10*H.");
        assert.strictEqual(debbreviate("IF1*H.:*H.", ModelBDialect), "IF1*HIMEM:*H.");
        assert.strictEqual(
            debbreviate("ONERR.*K.0PA.=4608|MO.|MRU.|M", ModelBDialect),
            "ONERROR*K.0PA.=4608|MO.|MRU.|M",
        );
        assert.strictEqual(
            debbreviate("IFCOU.TH.*LO. P.DATA", ModelBDialect),
            "IFCOU.THEN*LO. P.DATA",
        );
        assert.strictEqual(
            debbreviate("IFCOU. TH.*LO. P.DATA", ModelBDialect),
            "IFCOUNT THEN*LO. P.DATA",
        );
        assert.strictEqual(debbreviate("P.\n*H.\nP.", ModelBDialect), "PRINT\n*H.\nPRINT");
    });
});

describe("Debbreviation and the ROM", () => {
    const romTokens = new Map(RomTokens);
    it("should expand what the ROM reads as an abbreviation, and leave what it does not read as one", () => {
        // Each pair is recorded on the ROM, and the expansion is the same bytes as the text: nothing the ROM would not
        // read is expanded (COU. before TH. is not COUNT, and a name, REM or DATA text is not code), and nothing it
        // would read is left (MID$. is MID$( and R. after a number is RETURN).
        const cases = [
            ["IFCOU.TH.*LO. P.DATA", "IFCOU.THEN*LO. P.DATA"],
            ["IFCOU. TH.*LO. P.DATA", "IFCOUNT THEN*LO. P.DATA"],
            ["REM P. is print", "REM P. is print"],
            ["DATA P.,L.", "DATA P.,L."],
            ["xP.", "xP."],
            ["A1P.", "A1P."],
            ["&FFR.", "&FFRETURN"],
            ["A=MID$.A$,1)", "A=MID$(A$,1)"],
        ];
        for (const [text, expanded] of cases) {
            assert.strictEqual(debbreviate(text, ModelBDialect), expanded, text);
            for (const row of [text, expanded])
                assert.ok(romTokens.has(row), `${row} is not a row`);
            assert.strictEqual(romTokens.get(expanded), romTokens.get(text), text);
        }
        assert.notStrictEqual(romTokens.get("IFCOUNTTHEN*LO. P.DATA"), romTokens.get(cases[0][0]));
    });
});

describe("Expanding code", () => {
    // PRINT and TIME as token characters, then A%: expanding gives "PRINTTIME A%", with the space that TIME needs.
    const tokens = "\xf1\u0191A%";
    it("expands every line when it all fits", () => {
        assert.strictEqual(expandCode(`${tokens}\n\xf1A`, ModelBDialect), "PRINTTIME A%\nPRINTA");
    });
    it("leaves a line as it was when its expansion would not tokenise", () => {
        const fits = line => line.length <= 8;
        assert.strictEqual(
            expandCode(`${tokens}\n\xf1A`, ModelBDialect, fits),
            `${tokens}\nPRINTA`,
        );
    });
    it("leaves lines that are not tokens alone", () => {
        assert.strictEqual(
            expandCode("P.A", ModelBDialect, () => false),
            "P.A",
        );
    });
    it("does not mistake a short ASCII program for base2048", () => {
        for (const program of ["END", "RUN", "GOTO10"])
            assert.strictEqual(expandCode(program, ModelBDialect), program);
    });
    it("still decodes base2048, with or without the clamp emoji", () => {
        assert.strictEqual(expandCode("🗜༤ı3", ModelBDialect), "\xf1A\r");
        assert.strictEqual(expandCode("༤ı3", ModelBDialect), "\xf1A\r");
    });
    it("keeps the stand-in for a newline byte inside a REM or string as data", () => {
        // U+010A stands for the byte &0A; only a real newline ends a line.
        assert.strictEqual(expandCode("\xf4A\u010aB\xf1", ModelBDialect), "REMA\u010aB\xf1");
        assert.strictEqual(expandCode('\xf1"A\u010aB"\xf1', ModelBDialect), 'PRINT"A\u010aB"PRINT');
        assert.strictEqual(expandCode("\xf4A\u020aB", ModelBDialect), "REMA\u020aB");
        assert.strictEqual(expandCode("*FX\u010aP.", ModelBDialect), "*FX\u010aP.");
    });
    it("still reads a newline byte inside an encoded line number", () => {
        assert.strictEqual(expandCode("\xe5\x8dT\u010a@", ModelBDialect), "GOTO74");
    });
});
