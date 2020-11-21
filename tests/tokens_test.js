import {detokenise} from '../src/tokens';
import * as assert from 'assert';

describe('Detokinisation', () => {
    it('should detokenise the empty string', () => {
        assert.strictEqual(detokenise(""), "");
    });
    it('should leave untokenised things alone', () => {
        assert.strictEqual(detokenise("I am a mongoose."), "I am a mongoose.");
    });
    it('should detokenise simple tokens', () => {
        assert.strictEqual(detokenise("\x80"), "AND");
        assert.strictEqual(detokenise("\xf1"), "PRINT");
        assert.strictEqual(detokenise("\xff"), "OSCLI");
    });
    it('should detokenise a simple example', () => {
        assert.strictEqual(detokenise("\xf1 \"HELLO\""), "PRINT \"HELLO\"");
    });
    it('should not detokenise within quotes', () => {
        assert.strictEqual(detokenise("\xf1 \"\xf1\""), "PRINT \"\xf1\"");
    });
    it('should handle GOTOs', () => {
        assert.strictEqual(detokenise("\xe5\x8dTT@"), "GOTO20");
        assert.strictEqual(detokenise("\xe5\x8d\x54\x79\x70"), "GOTO12345");
        assert.strictEqual(detokenise("\xe5\x8d\x60\x7f\x7f"), "GOTO32767");
    });
    it('should handle nested quotes', () => {
        assert.strictEqual(detokenise("\xf1 \"HI\"\"MUM\""), "PRINT \"HI\"\"MUM\"");
    });
    it('should not detokenise in quotes even with nested quotes', () => {
        assert.strictEqual(detokenise("\xf1 \"HI\"\"\xf1\""), "PRINT \"HI\"\"\xf1\"");
    });
    it('should not detokenise in quotes even with colons', () => {
        assert.strictEqual(detokenise("\xf1 \"HI:\xf1\""), "PRINT \"HI:\xf1\"");
    });
    it('should detokenise a complete program', () => {
        const original = `0ô1i0123456789!oÿ1234567890=^\\<>$o QWERTYUIOP@[_^v oÿÿASDFGHJKL:;]ÿ )kÿZXCVBNM,./ÿ6g        q\`ÿ!\`ÿ!\`ÿ~\`ÿ aÿÿ8f       q\`ÿ!\`ÿ!\`ÿ~\`ÿsbÿÿÿ
1ë1:Y=6:P=4420:!3320=³:æ64,0:ð97,P,P:ï535;P;P;P;P;5:æ16,0:ì80,50:ð97,1120,386:æ0,0:ð&65,80,500
Q=+5:ãJ=0¸16:X=?Q-19:L=Q?1-96:Q=Q+2:ãI=0¸L:æ0,P:ì10*X+64*I,60*Y:ð97,48,48:ð0,-40,0:æ0,3:çPð0,-8,0:ï102:ð0,-12,-16
ïQ?I:í:Y=Y+(5Y>1):Q=Q+L+1:P=0:í:ï1
`;
        assert.strictEqual(detokenise(original), `0REM1i0123456789!oOSCLI1234567890=^\\<>$o QWERTYUIOP@[_^v oOSCLIOSCLIASDFGHJKL:;]OSCLI )kOSCLIZXCVBNM,./OSCLI6g        q\`OSCLI!\`OSCLI!\`OSCLI~\`OSCLI aOSCLIOSCLI8f       q\`OSCLI!\`OSCLI!\`OSCLI~\`OSCLIsbOSCLIOSCLIOSCLI
1MODE1:Y=6:P=4420:!3320=RND:GCOL64,0:PLOT97,P,P:VDU535;P;P;P;P;5:GCOL16,0:MOVE80,50:PLOT97,1120,386:GCOL0,0:PLOT&65,80,500
Q=PAGE+5:FORJ=0TO16:X=?Q-19:L=Q?1-96:Q=Q+2:FORI=0TOL:GCOL0,ATNP:MOVE10*X+64*I,60*Y:PLOT97,48,48:PLOT0,-40,0:GCOL0,3:IFPPLOT0,-8,0:VDU102:PLOT0,-12,-16
VDUQ?I:NEXT:Y=Y+(5ORY>1):Q=Q+L+1:P=0:NEXT:VDU1
`);
    });
});
