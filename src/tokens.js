import { decode } from 'base2048'

/*

 BBC BASIC Keyword Byte Tokens

 Derived from twitter.com/rheolism
 https://github.com/8bitkick/BBCMicroBot/blob/master/tools/bbcbasictokenise

 To twitter these inclusive ranges count as 1 character (everything else as 2):
 U+0000-U+10FF
 U+2000-U+200D # various spaces
 U+2010-U+201F # various punctuation
 U+2032-U+2037 # various prime marks

 Array starts at byte token 0x80

*/

export const tokens = [
    "AND", "DIV", "EOR", "MOD", "OR", "ERROR", "LINE", "OFF", "STEP", "SPC", "TAB(",
    "ELSE", "THEN", null, "OPENIN", "PTR", "PAGE", "TIME", "LOMEM", "HIMEM", "ABS", "ACS", "ADVAL",
    "ASC", "ASN", "ATN", "BGET", "COS", "COUNT", "DEG", "ERL", "ERR", "EVAL", "EXP", "EXT", "FALSE",
    "FN", "GET", "INKEY", "INSTR", "INT", "LEN", "LN", "LOG", "NOT", "OPENIN", "OPENOUT", "PI",
    "POINT(", "POS", "RAD", "RND", "SGN", "SIN", "SQR", "TAN", "TO", "TRUE", "USR", "VAL", "VPOS",
    "CHR$", "GET$", "INKEY$", "LEFT$(", "MID$(", "RIGHT$(", "STR$", "STRING$(", "EOF", "AUTO",
    "DELETE", "LOAD", "LIST", "NEW", "OLD", "RENUMBER", "SAVE", "PUT", "PTR", "PAGE",
    "TIME", "LOMEM", "HIMEM", "SOUND", "BPUT", "CALL", "CHAIN", "CLEAR", "CLOSE", "CLG",
    "CLS", "DATA", "DEF", "DIM", "DRAW", "END", "ENDPROC", "ENVELOPE", "FOR", "GOSUB",
    "GOTO", "GCOL", "IF", "INPUT", "LET", "LOCAL", "MODE", "MOVE", "NEXT", "ON", "VDU",
    "PLOT", "PRINT", "PROC", "READ", "REM", "REPEAT", "REPORT", "RESTORE", "RETURN", "RUN",
    "STOP", "COLOUR", "TRACE", "UNTIL", "WIDTH", "OSCLI"
];

  // TODO - merge with byte token array, pay attention to flags wrt spacing
const abbreviationOrder = ["AND","ABS","ACS","ADVAL","ASC","ASN","ATN","AUTO","BGET","BPUT","COLOUR","CALL","CHAIN","CHR$","CLEAR","CLOSE","CLG","CLS","COS","COUNT","DATA","DEG","DEF","DELETE","DIV","DIM","DRAW","ENDPROC","END","ENVELOPE","ELSE","EVAL","ERL","ERROR","EOF","EOR","ERR","EXP","EXT","FOR","FALSE","FN","GOTO","GET$","GET","GOSUB","GCOL","HIMEM","INPUT","IF","INKEY$","INKEY","INT","INSTR(","LIST","LINE","LOAD","LOMEM","LOCAL","LEFT$(","LEN","LET","LOG","LN","MID$(","MODE","MOD","MOVE","NEXT","NEW","NOT","OLD","ON","OFF","OR","OPENIN","OPENOUT","OPENUP","OSCLI","PRINT","PAGE","PTR","PI","PLOT","POINT(","PROC","POS","RETURN","REPEAT","REPORT","READ","REM","RUN","RAD","RESTORE","RIGHT$(","RND","RENUMBER","STEP","SAVE","SGN","SIN","SQR","SPC","STR$","STRING$(","SOUND","STOP","TAN","THEN","TO","TAB(","TRACE","TIME","TRUE","UNTIL","USR","VDU","VAL","VPOS","WIDTH","PAGE","PTR","TIME","LOMEM","HIMEM"];

const Chars = {
      Quote: '"'.charCodeAt(0),
      FirstToken: 0x80,
      LineNumberToken: 0x8d,
      Dot: '.'.charCodeAt(0)
    }

function findKeyword(abbreviation){
  for (const keyword of abbreviationOrder) {
    if (keyword.indexOf(abbreviation) === 0 && (abbreviation !== keyword)) {
      return keyword
    }
  }
  return abbreviation+"."
}

function isUpperCase(c){
  return (c > 64 && c<91)
}

function lineNumberSpace(text){
    return text.replace(/(^|\n)\s*(\d+)\s*/g, '$1$2 ');
}

function debbreviate(text) {
  let output = "";
  let buffer = "";
  let withinString = false;
  const codePoints = [...text].map(char => char.charCodeAt(0) & 0xff);
  for (const charCode of codePoints) {
    if (charCode === Chars.Quote)
    withinString = !withinString;
    if (isUpperCase(charCode) && !withinString) {
      buffer += String.fromCodePoint(charCode)
    }
    else {
      output += ((charCode === Chars.Dot) && !withinString && buffer !== "") ? findKeyword(buffer) :
      buffer+String.fromCodePoint(charCode);
      buffer = "";
    }
  }
  return output+buffer;
}

function decode2048(input){
    try{
      let code = input.match(/🗜(\S*)/);
      code = (code===null) ? input : code[1]; // if no clamp emoji, try the decoding the whole lot
      return String.fromCharCode.apply(null, decode(code.trim()));
    }
    catch(error){
      console.log(error);
      return input
    }
}

function detokenise(text) {
    let output = "";
    let withinString = false;
    let lineNumberBuffer = null;
    const codePoints = [...text].map(char => char.charCodeAt(0) & 0xff);
    for (const charCode of codePoints) {
        if (charCode === Chars.Quote)
            withinString = !withinString;
        if (charCode === Chars.LineNumberToken) {
            // If we see the magic line number token we need to accumulate the
            // next three bytes.
            lineNumberBuffer = [];
            continue;
        }
        if (lineNumberBuffer !== null) {
            lineNumberBuffer.push(charCode);
            if (lineNumberBuffer.length === 3) {
                // With reference to https://xania.org/200711/bbc-basic-line-number-format-part-2
                const topBits = lineNumberBuffer[0] << 2;
                const lowBits = lineNumberBuffer[1] ^ (topBits & 0xc0);
                const highBits = lineNumberBuffer[2] ^ ((topBits << 2) & 0xc0);
                output += `${(highBits << 8) | lowBits}`;
            }
            continue;
        }
        output += charCode >= Chars.FirstToken && !withinString
            ? tokens[charCode - Chars.FirstToken]
            : String.fromCodePoint(charCode);
    }
    return output;
}

export function expandCode(text) {
    text = decode2048(text);
    text = debbreviate(text);
    text = detokenise(text);
    text = lineNumberSpace(text);
    return text;
}
