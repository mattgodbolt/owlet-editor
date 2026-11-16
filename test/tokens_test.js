import {debbreviate, expandCode} from "../src/expand-code";
import {Flags, detokenise, forEachBasicLine, keywords, partialDetokenise} from "../src/tokens";
import {BasicIVDialect} from "../src/parser/dialect";
import {RomTokens} from "./rom-tables";
import {describe, expect, it} from "vitest";
import assert from "assert";
import {Buffer} from "buffer";
import {existsSync, readFileSync} from "fs";

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

describe("Detokenisation", () => {
    it("should detokenise the empty string", () => {
        assert.strictEqual(detokenise(""), "");
    });
    it("should leave untokenised things alone", () => {
        assert.strictEqual(detokenise("I am a mongoose."), "I am a mongoose.");
    });
    it("should detokenise simple tokens", () => {
        assert.strictEqual(detokenise("\x80"), "AND");
        assert.strictEqual(detokenise("\xf1"), "PRINT");
        assert.strictEqual(detokenise("\xff"), "OSCLI");
    });
    it("should leave a byte that is not a token as it is", () => {
        assert.strictEqual(detokenise("\xf1\xce1"), "PRINT\xce1");
    });
    it("should detokenise a simple example", () => {
        assert.strictEqual(detokenise('\xf1 "HELLO"'), 'PRINT "HELLO"');
    });
    it("should not detokenise within quotes", () => {
        assert.strictEqual(detokenise('\xf1 "\xf1"'), 'PRINT "\xf1"');
    });
    it("should handle GOTOs", () => {
        assert.strictEqual(detokenise("\xe5\x8dTT@"), "GOTO20");
        assert.strictEqual(detokenise("\xe5\x8d\x54\x79\x70"), "GOTO12345");
        assert.strictEqual(detokenise("\xe5\x8d\x60\x7f\x7f"), "GOTO32767");
    });
    it("should handle nested quotes", () => {
        assert.strictEqual(detokenise('\xf1 "HI""MUM"'), 'PRINT "HI""MUM"');
    });
    it("should not detokenise in quotes even with nested quotes", () => {
        assert.strictEqual(detokenise('\xf1 "HI""\xf1"'), 'PRINT "HI""\xf1"');
    });
    it("should not detokenise in quotes even with colons", () => {
        assert.strictEqual(detokenise('\xf1 "HI:\xf1"'), 'PRINT "HI:\xf1"');
    });
    it("should detokenise a complete program", () => {
        const original = `0ô1i0123456789!oÿ1234567890=^\\<>$o QWERTYUIOP@[_^v oÿÿASDFGHJKL:;]ÿ )kÿZXCVBNM,./ÿ6g        q\`ÿ!\`ÿ!\`ÿ~\`ÿ aÿÿ8f       q\`ÿ!\`ÿ!\`ÿ~\`ÿsbÿÿÿ
1ë1:Y=6:P=4420:!3320=³:æ64,0:ð97,P,P:ï535;P;P;P;P;5:æ16,0:ì80,50:ð97,1120,386:æ0,0:ð&65,80,500
Q=+5:ãJ=0¸16:X=?Q-19:L=Q?1-96:Q=Q+2:ãI=0¸L:æ0,P:ì10*X+64*I,60*Y:ð97,48,48:ð0,-40,0:æ0,3:çPð0,-8,0:ï102:ð0,-12,-16
ïQ?I:í:Y=Y+(5Y>1):Q=Q+L+1:P=0:í:ï1
`;
        assert.strictEqual(
            detokenise(original),
            `0REM1i0123456789!oÿ1234567890=^\\<>$o QWERTYUIOP@[_^v oÿÿASDFGHJKL:;]ÿ )kÿZXCVBNM,./ÿ6g        q\`ÿ!\`ÿ!\`ÿ~\`ÿ aÿÿ8f       q\`ÿ!\`ÿ!\`ÿ~\`ÿsbÿÿÿ
1MODE1:Y=6:P=4420:!3320=RND:GCOL64,0:PLOT97,P,P:VDU535;P;P;P;P;5:GCOL16,0:MOVE80,50:PLOT97,1120,386:GCOL0,0:PLOT&65,80,500
Q=PAGE+5:FORJ=0TO16:X=?Q-19:L=Q?1-96:Q=Q+2:FORI=0TOL:GCOL0,ATNP:MOVE10*X+64*I,60*Y:PLOT97,48,48:PLOT0,-40,0:GCOL0,3:IFP PLOT0,-8,0:VDU102:PLOT0,-12,-16
VDUQ?I:NEXT:Y=Y+(5ORY>1):Q=Q+L+1:P=0:NEXT:VDU1
`,
        );
    });
    it("should add spaces after tokens with the Conditional flag", () => {
        assert.strictEqual(detokenise("\xf1\x9f\x841"), "PRINTERR OR1");
    });
    it("should add spaces before tokens which follow an identifier", () => {
        assert.strictEqual(detokenise("\xf1X\x84Y"), "PRINTX ORY");
    });
    it("shouldn't expand tokens after DATA or REM, tokenised, typed or abbreviated", () => {
        const cases = [
            ["\xdc", "DATA"],
            ["DATA"],
            ["DAT."],
            ["DA."],
            ["D."],
            ["\xf4", "REM"],
            ["REM"],
        ];
        for (const [keyword, expanded = keyword] of cases)
            assert.strictEqual(detokenise(`${keyword}X\x84Y`), `${expanded}X\u0184Y`, keyword);
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
            assert.strictEqual(expandCode(`${keyword}\xf1A`), `${expanded}\xf1A`, keyword);
    });
});

describe("Debbreviation", () => {
    it("should work with the empty string", () => {
        assert.strictEqual(debbreviate(""), "");
    });
    it("should leave non-token things alone", () => {
        assert.strictEqual(debbreviate("I am a mongoose."), "I am a mongoose.");
    });
    it("should handle simple cases", () => {
        assert.strictEqual(debbreviate("P."), "PRINT");
    });
    it("should expand abbreviation after full token", () => {
        assert.strictEqual(debbreviate("IFCOU."), "IFCOUNT");
    });
    it("should not expand abbreviation after conditional token", () => {
        assert.strictEqual(debbreviate("PIP=1:P.PIP."), "PIP=1:PRINTPIP.");
    });
    it("should not expand abbreviation in *-command", () => {
        assert.strictEqual(debbreviate("*H."), "*H.");
        assert.strictEqual(debbreviate("10*H."), "10*H.");
        assert.strictEqual(debbreviate("IF1*H.:*H."), "IF1*HIMEM:*H.");
        assert.strictEqual(
            debbreviate("ONERR.*K.0PA.=4608|MO.|MRU.|M"),
            "ONERROR*K.0PA.=4608|MO.|MRU.|M",
        );
        assert.strictEqual(debbreviate("IFCOU.TH.*LO. P.DATA"), "IFCOU.THEN*LO. P.DATA");
        assert.strictEqual(debbreviate("P.\n*H.\nP."), "PRINT\n*H.\nPRINT");
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
            ["REM P. is print", "REM P. is print"],
            ["DATA P.,L.", "DATA P.,L."],
            ["xP.", "xP."],
            ["A1P.", "A1P."],
            ["&FFR.", "&FFRETURN"],
            ["A=MID$.A$,1)", "A=MID$(A$,1)"],
        ];
        for (const [text, expanded] of cases) {
            assert.strictEqual(debbreviate(text), expanded, text);
            for (const row of [text, expanded])
                assert.ok(romTokens.has(row), `${row} is not a row`);
            assert.strictEqual(romTokens.get(expanded), romTokens.get(text), text);
        }
        assert.notStrictEqual(romTokens.get("IFCOUNTTHEN*LO. P.DATA"), romTokens.get(cases[0][0]));
    });
});

describe("For each basic line", () => {
    it("should handle an empty program", () => {
        forEachBasicLine("\x0d\xff", () => assert.fail("Shouldn't call me"));
    });
    it("should handle a single line program", () => {
        const result = [];
        forEachBasicLine('\x0d\x00\x0a\x0d\xf1 "Hello"\x0d\xff', (lineNum, line) =>
            result.push({num: lineNum, line}),
        );
        assert.deepStrictEqual(result, [{num: 10, line: '\xf1 "Hello"'}]);
    });
    it("should handle a two line program", () => {
        const result = [];
        forEachBasicLine(
            '\x0d\x00\x0a\x0d\xf1 "Hello"\x0d\x00\x14\x05\xf9\x0d\xff',
            (lineNum, line) => result.push({num: lineNum, line}),
        );
        assert.deepStrictEqual(result, [
            {num: 10, line: '\xf1 "Hello"'},
            {num: 20, line: "\xf9"},
        ]);
    });
});

describe("Partial detokenisation", () => {
    it("should drop sequential 10, 20 etc", () => {
        const rawProgram =
            '\x0d\x00\x0a\x14 \xf1 "Hello world"\x0d\x00\x14\x0b \xe5 \x8d\x54\x4a\x40\x0d\xff';
        assert.strictEqual(partialDetokenise(rawProgram), '\xf1 "Hello world"\n\xe5 10');
    });
    it("should leave non-tens line numbers", () => {
        const rawProgram =
            '\x0d\x00\x0a\x14 \xf1 "Hello world"\x0d\x00\x0b\x0b \xe5 \x8d\x54\x4a\x40\x0d\xff';
        assert.strictEqual(partialDetokenise(rawProgram), '\xf1 "Hello world"\n11 \xe5 10');
    });
    it("should not result in invisible Unicode characters", () => {
        const rawProgram = "\x0d\x00\x0a\x08\xf1\x9f\x841\x0d\xff";
        assert.strictEqual(partialDetokenise(rawProgram), "\xf1\u019f\u01841");
    });
    it("should write the bytes that would be invisible as visible characters", () => {
        const rawProgram = "\x0d\x00\x0a\x06\xa0\xad\x0d\xff";
        const shrunk = partialDetokenise(rawProgram);
        assert.strictEqual(shrunk, "\u01a0\u01ad");
        assert.strictEqual(shrunk.trim(), shrunk);
    });
    it("should reset state after a line number token", () => {
        const rawProgram =
            "\x0d\x00\x0a\x13\xe4\x8d\x54\x4a\x40:\xe5\x8d\x54\x54\x40:\xf4OK\x0d\xff";
        assert.strictEqual(partialDetokenise(rawProgram), "\xe410:\xe520:\xf4OK");
    });
    it("should not expand line number token in literal string", () => {
        const rawProgram = '\x0d\x00\x0a\x13\xf1"\x8dHello":\xe5\x8d\x54\x4a\x40\x0d\xff';
        assert.strictEqual(partialDetokenise(rawProgram), '\xf1"\u018dHello":\xe510');
    });
});

describe("Expanding code", () => {
    // PRINT and TIME as token characters, then A%: expanding gives "PRINTTIME A%", with the space that TIME needs.
    const tokens = "\xf1\u0191A%";
    it("expands every line when it all fits", () => {
        assert.strictEqual(expandCode(`${tokens}\n\xf1A`), "PRINTTIME A%\nPRINTA");
    });
    it("leaves a line as it was when its expansion would not tokenise", () => {
        const fits = line => line.length <= 8;
        assert.strictEqual(expandCode(`${tokens}\n\xf1A`, fits), `${tokens}\nPRINTA`);
    });
    it("leaves lines that are not tokens alone", () => {
        assert.strictEqual(
            expandCode("P.A", () => false),
            "P.A",
        );
    });
    it("does not mistake a short ASCII program for base2048", () => {
        for (const program of ["END", "RUN", "GOTO10"])
            assert.strictEqual(expandCode(program), program);
    });
    it("still decodes base2048, with or without the clamp emoji", () => {
        assert.strictEqual(expandCode("🗜༤ı3"), "\xf1A\r");
        assert.strictEqual(expandCode("༤ı3"), "\xf1A\r");
    });
    it("keeps the stand-in for a newline byte inside a REM or string as data", () => {
        // U+010A stands for the byte &0A; only a real newline ends a line.
        assert.strictEqual(expandCode("\xf4A\u010aB\xf1"), "REMA\u010aB\xf1");
        assert.strictEqual(expandCode('\xf1"A\u010aB"\xf1'), 'PRINT"A\u010aB"PRINT');
        assert.strictEqual(expandCode("\xf4A\u020aB"), "REMA\u020aB");
        assert.strictEqual(expandCode("*FX\u010aP."), "*FX\u010aP.");
    });
    it("still reads a newline byte inside an encoded line number", () => {
        assert.strictEqual(expandCode("\xe5\x8dT\u010a@"), "GOTO74");
    });
});
