import {detokenise, forEachBasicLine, partialDetokenise} from "../src/detokenise";
import {BasicIVDialect, ModelBDialect} from "../src/parser/dialect";
import {describe, it} from "vitest";
import assert from "assert";

describe("Detokenisation", () => {
    it("should detokenise the empty string", () => {
        assert.strictEqual(detokenise("", ModelBDialect), "");
    });
    it("should leave untokenised things alone", () => {
        assert.strictEqual(detokenise("I am a mongoose.", ModelBDialect), "I am a mongoose.");
    });
    it("should detokenise simple tokens", () => {
        assert.strictEqual(detokenise("\x80", ModelBDialect), "AND");
        assert.strictEqual(detokenise("\xf1", ModelBDialect), "PRINT");
        assert.strictEqual(detokenise("\xff", ModelBDialect), "OSCLI");
    });
    it("should leave a byte that is not a token as it is", () => {
        assert.strictEqual(detokenise("\xf1\xce1", ModelBDialect), "PRINT\xce1");
    });
    it("should detokenise a simple example", () => {
        assert.strictEqual(detokenise('\xf1 "HELLO"', ModelBDialect), 'PRINT "HELLO"');
    });
    it("should not detokenise within quotes", () => {
        assert.strictEqual(detokenise('\xf1 "\xf1"', ModelBDialect), 'PRINT "\xf1"');
    });
    it("should handle GOTOs", () => {
        assert.strictEqual(detokenise("\xe5\x8dTT@", ModelBDialect), "GOTO20");
        assert.strictEqual(detokenise("\xe5\x8d\x54\x79\x70", ModelBDialect), "GOTO12345");
        assert.strictEqual(detokenise("\xe5\x8d\x60\x7f\x7f", ModelBDialect), "GOTO32767");
    });
    it("should handle nested quotes", () => {
        assert.strictEqual(detokenise('\xf1 "HI""MUM"', ModelBDialect), 'PRINT "HI""MUM"');
    });
    it("should not detokenise in quotes even with nested quotes", () => {
        assert.strictEqual(detokenise('\xf1 "HI""\xf1"', ModelBDialect), 'PRINT "HI""\xf1"');
    });
    it("should not detokenise in quotes even with colons", () => {
        assert.strictEqual(detokenise('\xf1 "HI:\xf1"', ModelBDialect), 'PRINT "HI:\xf1"');
    });
    it("should detokenise a complete program", () => {
        const original = `0ô1i0123456789!oÿ1234567890=^\\<>$o QWERTYUIOP@[_^v oÿÿASDFGHJKL:;]ÿ )kÿZXCVBNM,./ÿ6g        q\`ÿ!\`ÿ!\`ÿ~\`ÿ aÿÿ8f       q\`ÿ!\`ÿ!\`ÿ~\`ÿsbÿÿÿ
1ë1:Y=6:P=4420:!3320=³:æ64,0:ð97,P,P:ï535;P;P;P;P;5:æ16,0:ì80,50:ð97,1120,386:æ0,0:ð&65,80,500
Q=+5:ãJ=0¸16:X=?Q-19:L=Q?1-96:Q=Q+2:ãI=0¸L:æ0,P:ì10*X+64*I,60*Y:ð97,48,48:ð0,-40,0:æ0,3:çPð0,-8,0:ï102:ð0,-12,-16
ïQ?I:í:Y=Y+(5Y>1):Q=Q+L+1:P=0:í:ï1
`;
        assert.strictEqual(
            detokenise(original, ModelBDialect),
            `0REM1i0123456789!oÿ1234567890=^\\<>$o QWERTYUIOP@[_^v oÿÿASDFGHJKL:;]ÿ )kÿZXCVBNM,./ÿ6g        q\`ÿ!\`ÿ!\`ÿ~\`ÿ aÿÿ8f       q\`ÿ!\`ÿ!\`ÿ~\`ÿsbÿÿÿ
1MODE1:Y=6:P=4420:!3320=RND:GCOL64,0:PLOT97,P,P:VDU535;P;P;P;P;5:GCOL16,0:MOVE80,50:PLOT97,1120,386:GCOL0,0:PLOT&65,80,500
Q=PAGE+5:FORJ=0TO16:X=?Q-19:L=Q?1-96:Q=Q+2:FORI=0TOL:GCOL0,ATNP:MOVE10*X+64*I,60*Y:PLOT97,48,48:PLOT0,-40,0:GCOL0,3:IFP PLOT0,-8,0:VDU102:PLOT0,-12,-16
VDUQ?I:NEXT:Y=Y+(5ORY>1):Q=Q+L+1:P=0:NEXT:VDU1
`,
        );
    });
    it("should add spaces after tokens with the Conditional flag", () => {
        assert.strictEqual(detokenise("\xf1\x9f\x841", ModelBDialect), "PRINTERR OR1");
    });
    it("should add spaces before tokens which follow an identifier", () => {
        assert.strictEqual(detokenise("\xf1X\x84Y", ModelBDialect), "PRINTX ORY");
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
            assert.strictEqual(
                detokenise(`${keyword}X\x84Y`, ModelBDialect),
                `${expanded}X\u0184Y`,
                keyword,
            );
    });
});

describe.each([
    ["BASIC II", ModelBDialect],
    ["BASIC IV", BasicIVDialect],
])(
    "Detokenising a line with a string that ends like REM, DATA or a * command, in %s",
    (_, dialect) => {
        // What Shrink leaves and Decode reads: token characters, the string's own text kept as it is.
        it.each(["REM", "DATA", "D.", "DA.", "DAT.", "x REM"])(
            'should expand what follows "%s"',
            ending => {
                assert.strictEqual(
                    detokenise(`\xf1 "${ending}":\xf1 1`, dialect),
                    `PRINT "${ending}":PRINT 1`,
                );
            },
        );
        it("should expand a REM that follows a string ending in REM", () => {
            assert.strictEqual(detokenise('\xf1 "REM":\xf4 \xf1', dialect), 'PRINT "REM":REM \xf1');
        });
        it("should still leave the text after a REM, DATA or * command raw", () => {
            assert.strictEqual(detokenise('\xf1 "x":\xf4 "\xf1', dialect), 'PRINT "x":REM "\xf1');
            assert.strictEqual(detokenise('\xdc "A",\xf1', dialect), 'DATA "A",\xf1');
            assert.strictEqual(detokenise("*FX\xf1", dialect), "*FX\xf1");
        });
        it("should not take a line number token cut short by the end of the line for one", () => {
            assert.strictEqual(detokenise("\xe5\x8dT\n\xf1 1", dialect), "GOTOƍT\nPRINT 1");
        });
    },
);

describe("The dialect's token table", () => {
    it("should spell a token from the dialect it is read in", () => {
        assert.strictEqual(detokenise("\xce 10", ModelBDialect), "\u00ce 10");
        assert.strictEqual(detokenise("\xce 10", BasicIVDialect), "EDIT 10");
        assert.strictEqual(detokenise("\xfb1", BasicIVDialect), "COLOUR1");
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
        assert.strictEqual(
            partialDetokenise(rawProgram, ModelBDialect),
            '\xf1 "Hello world"\n\xe5 10',
        );
    });
    it("should leave non-tens line numbers", () => {
        const rawProgram =
            '\x0d\x00\x0a\x14 \xf1 "Hello world"\x0d\x00\x0b\x0b \xe5 \x8d\x54\x4a\x40\x0d\xff';
        assert.strictEqual(
            partialDetokenise(rawProgram, ModelBDialect),
            '\xf1 "Hello world"\n11 \xe5 10',
        );
    });
    it("should not result in invisible Unicode characters", () => {
        const rawProgram = "\x0d\x00\x0a\x08\xf1\x9f\x841\x0d\xff";
        assert.strictEqual(partialDetokenise(rawProgram, ModelBDialect), "\xf1\u019f\u01841");
    });
    it("should write the bytes that would be invisible as visible characters", () => {
        const rawProgram = "\x0d\x00\x0a\x06\xa0\xad\x0d\xff";
        const shrunk = partialDetokenise(rawProgram, ModelBDialect);
        assert.strictEqual(shrunk, "\u01a0\u01ad");
        assert.strictEqual(shrunk.trim(), shrunk);
    });
    it("should reset state after a line number token", () => {
        const rawProgram =
            "\x0d\x00\x0a\x13\xe4\x8d\x54\x4a\x40:\xe5\x8d\x54\x54\x40:\xf4OK\x0d\xff";
        assert.strictEqual(partialDetokenise(rawProgram, ModelBDialect), "\xe410:\xe520:\xf4OK");
    });
    it("should not expand line number token in literal string", () => {
        const rawProgram = '\x0d\x00\x0a\x13\xf1"\x8dHello":\xe5\x8d\x54\x4a\x40\x0d\xff';
        assert.strictEqual(
            partialDetokenise(rawProgram, ModelBDialect),
            '\xf1"\u018dHello":\xe510',
        );
    });
});
