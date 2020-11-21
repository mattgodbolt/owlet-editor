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
    "ELSE", "THEN", "OPENIN", "PTR", "PAGE", "TIME", "LOMEM", "HIMEM", "ABS", "ACS", "ADVAL",
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
