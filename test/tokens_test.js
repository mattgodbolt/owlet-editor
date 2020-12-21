import {debbreviate, detokenise, forEachBasicLine, partialDetokenise} from "../src/tokens";
import {assert} from "chai";

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
`
        );
    });
    it("should add spaces after tokens with the Conditional flag", () => {
        assert.strictEqual(detokenise("\xf1\x9f\x841"), "PRINTERR OR1");
    });
    it("should add spaces before tokens which follow an identifier", () => {
        assert.strictEqual(detokenise("\xf1X\x84Y"), "PRINTX ORY");
    });
    it("shouldn't expand tokens after DATA", () => {
        assert.strictEqual(detokenise("\xDCX\x84Y"), "DATAX\u0184Y");
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
});

describe("For each basic line", () => {
    it("should handle an empty program", () => {
        forEachBasicLine("\x0d\xff", () => assert.fail("Shouldn't call me"));
    });
    it("should handle a single line program", () => {
        const result = [];
        forEachBasicLine('\x0d\x00\x0a\x0d\xf1 "Hello"\x0d\xff', (lineNum, line) =>
            result.push({num: lineNum, line})
        );
        assert.deepStrictEqual(result, [{num: 10, line: '\xf1 "Hello"'}]);
    });
    it("should handle a two line program", () => {
        const result = [];
        forEachBasicLine(
            '\x0d\x00\x0a\x0d\xf1 "Hello"\x0d\x00\x14\x05\xf9\x0d\xff',
            (lineNum, line) => result.push({num: lineNum, line})
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
        assert.strictEqual(partialDetokenise(rawProgram), '10 \xf1 "Hello world"\n11 \xe5 10');
    });
    it("should not result in invisible Unicode characters", () => {
        const rawProgram = "\x0d\x00\x0a\x08\xf1\x9f\x841\x0d\xff";
        assert.strictEqual(partialDetokenise(rawProgram), "\xf1\u019f\u01841");
    });
});
