// Reference tables for the VDU drivers of the BBC Micro (BBC Micro User Guide, MOS 1.20 / BBC BASIC II).

export const VduCodes = [
    {code: 0, params: 0, name: "Does nothing"},
    {code: 1, params: 1, args: "char", name: "Send next character to printer only"},
    {code: 2, params: 0, name: "Enable printer (echo output)"},
    {code: 3, params: 0, name: "Disable printer"},
    {code: 4, params: 0, name: "Write text at text cursor"},
    {code: 5, params: 0, name: "Write text at graphics cursor"},
    {code: 6, params: 0, name: "Enable screen output"},
    {code: 7, params: 0, name: "Beep"},
    {code: 8, params: 0, name: "Cursor left"},
    {code: 9, params: 0, name: "Cursor right"},
    {code: 10, params: 0, name: "Cursor down"},
    {code: 11, params: 0, name: "Cursor up"},
    {code: 12, params: 0, name: "Clear text area (CLS)"},
    {code: 13, params: 0, name: "Carriage return"},
    {code: 14, params: 0, name: "Page mode on"},
    {code: 15, params: 0, name: "Page mode off"},
    {code: 16, params: 0, name: "Clear graphics area (CLG)"},
    {code: 17, params: 1, args: "colour", name: "Set text colour (COLOUR)"},
    {code: 18, params: 2, args: "mode, colour", name: "Set graphics colour (GCOL)"},
    {
        code: 19,
        params: 5,
        args: "logical, physical, 0, 0, 0",
        name: "Set palette (VDU 19 / COLOUR l,p)",
    },
    {code: 20, params: 0, name: "Restore default logical colours"},
    {code: 21, params: 0, name: "Disable screen output"},
    {code: 22, params: 1, args: "mode", name: "Select screen mode (MODE)"},
    {code: 23, params: 9, args: "char, 8 bytes of shape", name: "Define a character"},
    {code: 24, params: 8, args: "left; bottom; right; top;", name: "Define graphics window"},
    {code: 25, params: 5, args: "plot, x; y;", name: "PLOT (x and y are 16 bits: x;y;)"},
    {code: 26, params: 0, name: "Restore default windows"},
    {code: 27, params: 0, name: "Does nothing (Escape)"},
    {code: 28, params: 4, args: "left, bottom, right, top", name: "Define text window"},
    {code: 29, params: 4, args: "x; y;", name: "Set graphics origin (ORIGIN)"},
    {code: 30, params: 0, name: "Home text cursor"},
    {code: 31, params: 2, args: "x, y", name: "Move text cursor (PRINT TAB(x,y))"},
    {code: 127, params: 0, name: "Delete (backspace and erase)"},
];

// The BBC font shows pound sterling at 96 where ASCII has a backtick.
const BbcFontOverrides = {96: "£"};

export const AsciiChars = Array.from({length: 95}, (_, i) => {
    const code = 32 + i;
    return {code, char: BbcFontOverrides[code] ?? String.fromCharCode(code)};
});

// Only meaningful in MODE 7; the other codes in 128-159 are unused by the SAA5050.
export const TeletextCodes = [
    {code: 129, name: "Alpha red"},
    {code: 130, name: "Alpha green"},
    {code: 131, name: "Alpha yellow"},
    {code: 132, name: "Alpha blue"},
    {code: 133, name: "Alpha magenta"},
    {code: 134, name: "Alpha cyan"},
    {code: 135, name: "Alpha white"},
    {code: 136, name: "Flash"},
    {code: 137, name: "Steady"},
    {code: 140, name: "Normal height"},
    {code: 141, name: "Double height"},
    {code: 145, name: "Graphics red"},
    {code: 146, name: "Graphics green"},
    {code: 147, name: "Graphics yellow"},
    {code: 148, name: "Graphics blue"},
    {code: 149, name: "Graphics magenta"},
    {code: 150, name: "Graphics cyan"},
    {code: 151, name: "Graphics white"},
    {code: 152, name: "Conceal display"},
    {code: 153, name: "Contiguous graphics"},
    {code: 154, name: "Separated graphics"},
    {code: 156, name: "Black background"},
    {code: 157, name: "New background (current colour)"},
    {code: 158, name: "Hold graphics"},
    {code: 159, name: "Release graphics"},
];

// PLOT k,x,y: k is the group's base plus the column offset 0-7.
export const PlotColumns = [
    {offset: 0, name: "Move relative"},
    {offset: 1, name: "Draw relative, foreground"},
    {offset: 2, name: "Draw relative, inverse"},
    {offset: 3, name: "Draw relative, background"},
    {offset: 4, name: "Move absolute"},
    {offset: 5, name: "Draw absolute, foreground"},
    {offset: 6, name: "Draw absolute, inverse"},
    {offset: 7, name: "Draw absolute, background"},
];

export const PlotGroups = [
    {base: 0, name: "Solid line, both ends included"},
    {base: 8, name: "Solid line, final point omitted"},
    {base: 16, name: "Dotted line, both ends included"},
    {base: 24, name: "Dotted line, final point omitted"},
    {base: 32, name: "Solid line, initial point omitted"},
    {base: 40, name: "Solid line, both ends omitted"},
    {base: 48, name: "Dotted line, initial point omitted"},
    {base: 56, name: "Dotted line, both ends omitted"},
    {base: 64, name: "Plot a point"},
    {base: 72, name: "Fill row left and right to non-background"},
    {base: 80, name: "Fill triangle"},
    {base: 88, name: "Fill row right to background"},
    {base: 96, name: "Fill rectangle"},
    {base: 104, name: "Fill row left and right to foreground"},
    {base: 112, name: "Fill parallelogram"},
    {base: 120, name: "Fill row right to non-foreground"},
];

// Added by the Graphics Extension ROM (and built in to the Master); the columns are as above except for block copy.
export const PlotExtendedGroups = [
    {base: 128, name: "Flood fill to non-background"},
    {base: 136, name: "Flood fill to foreground"},
    {base: 144, name: "Circle outline"},
    {base: 152, name: "Circle fill"},
    {base: 160, name: "Circular arc"},
    {base: 168, name: "Segment"},
    {base: 176, name: "Sector"},
    {base: 184, name: "Block copy / move"},
    {base: 192, name: "Ellipse outline"},
    {base: 200, name: "Ellipse fill"},
];
