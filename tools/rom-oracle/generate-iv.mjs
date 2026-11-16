// Statements for the oracle to run on the Master's BASIC IV, on top of generate.mjs's: the places where it differs from
// BASIC II (a fixed set of statements, and assembler statements over every mnemonic and way of writing an operand).
import {mulberry32} from "./generate.mjs";

const Prefixes = ["", "X=1:", "IF 1 THEN ", "IF 0 THEN PRINT ELSE ", "REPEAT "];
const Statements =
    `VDU 23,255,255| | VDU 7| | V.7| | VDU 7|8 | VDU 7,8| | VDU 7;8| | VDU 7 | | VDU 1 2| | VDU 1|2|3| | VDU 1,2,3|
    | VDU 7|:PRINT | VDU 7|X | VDU 7|:VDU 1 | VDU| | VDU || | VDU 7;| | VDU 7|; | VDU 7|| | VDU 7,| | VDU 7|,7 | VDU 7;;|
    | VDU ,| | VDU 7||8 | PRINT 7| | X=7| | PRINT | | X=|1 | VDU X|X | VDU 1+2|3 | VDU 7|~
    | EXT#X=1 | EXT #X=1 | EXT# X=1 | EXT#0=0 | EXT#X=X+1 | EXT# | EXT#X | EXT#X= | EXT X=0 | EXT | EXT=1 | EXT(1) | EX.#X=1
    | EXT#X,1 | EXT#X=1,2 | PRINT EXT#X | X=EXT#X | X=EXT X | EXT#(X)=1 | EXT#X?1=2
    | COLOR 1 | COLOR1 | COLOR | COLOR 1,2 | COLOR 1,2,3 | COLOR. | COLO.1 | COL.1 | COLOR X | COLOR PRINT | COLOUR 1 | color 1
    | COLOR 1:COLOR 2 | X=COLOR | PRINT COLOR | GCOLOR 1 | GCOL 0,1
    | ON 1 PROCp | ON X PROCp | ON 1 PROCp,PROCq | ON 1 PROCp ELSE PRINT | ON 1 PROCp,PROCq ELSE PRINT 1 | ON 1 PROCp, | ON 1 PROC
    | ON 1 PROCp(1) | ON 1 PROCq(1) | ON 1 PROCq(1,2) | ON 1 PROCq( | ON 1 PROCq(1 | ON 1 FNf | ON 1 PROCp PROCq | ON 1 PROCp:PRINT
    | ON X PROCp,PROCq,PROCp | ON 1 PROC p | ON 1 PROCp 1 | ON X PROC | ON PROCp | ON 1 PROCp ELSE
    | TIME$ | TIME$="a" | TIME$ ="a" | TIME$= "a" | TIME $="a" | TIME$=X$ | TIME$=1 | TIME$= | TIME$=TIME$ | X$=TIME$ | X$=TIME $
    | X$=TIME$+"a" | PRINT TIME$ | PRINT TIME$;TIME$ | PRINT TIME$ TIME$ | PRINT LEN TIME$ | PRINT LEN(TIME$) | X$=LEFT$(TIME$,3)
    | X=TIME$ | IF TIME$="a" THEN PRINT | X=TIME$<>"a" | TIME$$ | X$=TIME$$ | PRINT TIME$+1 | TIME=TIME$ | TIME$+"a" | TIME%=1
    | EDIT | EDIT 1 | EDIT 1,2 | EDIT X | EDIT "a" | ED. | EDIT:PRINT | X=EDIT | PRINT EDIT | EDIT=1 | IF 1 THEN EDIT 1
    | LIST IF | LIST IF "a" | LIST IF 1 | LIST IF X | LIST 1,2
    | ERROR 5,"x" | ERROR 5 | ERROR | ERROR "x" | ON ERROR LOCAL PRINT | ON ERROR OFF | ON ERROR PRINT | ON ERROR LOCAL
    | X=&G | X=& | PRINT & | X=&FG | PRINT &,1`
        .split(/\s*\|\s*/)
        .filter(Boolean);

const Mnemonics =
    `ADC AND ASL BCC BCS BEQ BIT BMI BNE BPL BRA BRK BVC BVS CLC CLD CLI CLV CMP CPX CPY DEA DEC DEX DEY EOR INA INC INX
    INY JMP JSR LDA LDX LDY LSR NOP ORA PHA PHP PHX PHY PLA PLP PLX PLY ROL ROR RTI RTS SBC SEC SED SEI STA STX STY STZ TAX TAY
    TRB TSB TSX TXA TXS TYA`.split(/\s+/);
// What the ROM does not have, but could be mistaken for: more 65C02 instructions and the like.
const Missing =
    "BBR0 BBS7 RMB1 SMB2 WAI STP ST8 ST: ST! LD89 CP8 ORX AN. EQU EQUQ OPT EQUB EQUD EQUS EQUW".split(
        " ",
    );
const Values = ["&70", "&1234", "1", "A", "P%", "(1)", "&70+1", "H."];
const Forms = [
    "#V",
    "V",
    "V,X",
    "V,x",
    "V,Y",
    "V,y",
    "(V)",
    "(V,X)",
    "(V,x)",
    "(V),Y",
    "(V),y",
    "(V,Y)",
    "(V),X",
    "(V)+1",
    "(V,X)+1",
    "(V) ,Y",
    "(V) , y",
    "V ,X",
    "V, X",
    "A",
    "a",
    "A,X",
    "a,x",
    "A+1",
    "Ab",
    "ab",
    "V,Xa",
    "V,xa",
    "V,Z",
    "V,",
    "(V,X",
    "(V",
    "(V,",
    "(V),",
    "(V)X",
    "(V,X)Y",
    "(V,Xa)",
    "#V,X",
    "#V,x",
    "V,X,Y",
    "V hello",
    "(V) hello",
    "V;c",
    "V\\c",
    "",
];
const Labels = ["", ".L ", ".E1 ", ".Exit "];
const Tails = ["", "", "", " ;c", "\\c"];

export function generateBasicIV({seed = 1, count = 3000} = {}) {
    const random = mulberry32(seed);
    const pick = list => list[Math.floor(random() * list.length)];
    const out = [];
    for (const statement of Statements) {
        for (const prefix of Prefixes.slice(0, 2))
            out.push({shape: "BASIC IV statement", text: prefix + statement});
        out.push({shape: "BASIC IV statement", text: pick(Prefixes) + statement});
    }
    for (const mnemonic of Mnemonics) {
        for (const form of Forms) {
            if (random() < 0.5) continue;
            const operand = form.replace("V", pick(Values));
            out.push(assembler(random, pick, mnemonic, operand));
        }
    }
    for (const mnemonic of Missing)
        out.push(assembler(random, pick, mnemonic, pick(["", "&70", "#1", "&70,X"])));
    for (let i = 0; i < count; ++i)
        out.push(
            assembler(
                random,
                pick,
                pick([...Mnemonics, ...Mnemonics, ...Missing]),
                pick(Forms).replace("V", pick(Values)),
            ),
        );
    return out;
}

// An instruction with no operand is rarely given one, since all that follows it is ignored.
const Implied = new Set(
    "BRK CLC CLD CLI CLV DEA DEX DEY INA INX INY NOP PHA PHP PHX PHY PLA PLP PLX PLY RTI RTS SEC SED SEI TAX TAY TSX TXA TXS TYA".split(
        " ",
    ),
);

function assembler(random, pick, mnemonic, operand) {
    if (Implied.has(mnemonic) && random() < 0.85) operand = "";
    const cased = pick([
        m => m,
        m => m,
        m => m.toLowerCase(),
        m => m[0] + m.slice(1).toLowerCase(),
    ])(mnemonic);
    const joined = operand && pick([" ", " ", ""]) + operand;
    return {
        shape: "BASIC IV assembler",
        text: `DIM P% 99:[OPT0:${pick(Labels)}${cased}${joined}${pick(Tails)}:]`,
    };
}
