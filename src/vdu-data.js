// Reference tables for the VDU drivers of the BBC Micro (BBC Micro User Guide, MOS 1.20 / BBC BASIC II).

export const hex = code => `&${code.toString(16).toUpperCase().padStart(2, "0")}`;

// In `syntax`, a name followed by ; is a 16-bit value sent as two bytes, low then high.
export const VduCodes = [
    {code: 0, params: 0, syntax: "VDU 0", name: "Does nothing"},
    {code: 1, params: 1, syntax: "VDU 1,char", name: "Send the next byte to the printer only"},
    {code: 2, params: 0, syntax: "VDU 2", name: "Enable the printer (copy output to it)"},
    {code: 3, params: 0, syntax: "VDU 3", name: "Disable the printer"},
    {code: 4, params: 0, syntax: "VDU 4", name: "Write text at the text cursor"},
    {code: 5, params: 0, syntax: "VDU 5", name: "Write text at the graphics cursor"},
    {code: 6, params: 0, syntax: "VDU 6", name: "Enable screen output"},
    {code: 7, params: 0, syntax: "VDU 7", name: "Beep"},
    {code: 8, params: 0, syntax: "VDU 8", name: "Cursor left"},
    {code: 9, params: 0, syntax: "VDU 9", name: "Cursor right"},
    {code: 10, params: 0, syntax: "VDU 10", name: "Cursor down"},
    {code: 11, params: 0, syntax: "VDU 11", name: "Cursor up"},
    {code: 12, params: 0, syntax: "VDU 12", name: "Clear the text area (CLS)"},
    {code: 13, params: 0, syntax: "VDU 13", name: "Carriage return, cursor to start of line"},
    {code: 14, params: 0, syntax: "VDU 14", name: "Page mode on"},
    {code: 15, params: 0, syntax: "VDU 15", name: "Page mode off"},
    {code: 16, params: 0, syntax: "VDU 16", name: "Clear the graphics area (CLG)"},
    {
        code: 17,
        params: 1,
        syntax: "VDU 17,colour",
        name: "Set the text colour (COLOUR); add 128 to set the background",
        example: ["VDU 17,1", "is COLOUR 1"],
    },
    {
        code: 18,
        params: 2,
        syntax: "VDU 18,mode,colour",
        name: "Set the graphics colour and plotting mode (GCOL)",
        example: ["VDU 18,0,2", "is GCOL 0,2"],
    },
    {
        code: 19,
        params: 5,
        syntax: "VDU 19,logical,physical,0,0,0",
        name: "Change the palette (COLOUR logical,physical)",
        example: ["VDU 19,0,4,0,0,0", "is COLOUR 0,4: the background becomes blue"],
    },
    {code: 20, params: 0, syntax: "VDU 20", name: "Restore the default logical colours"},
    {code: 21, params: 0, syntax: "VDU 21", name: "Disable screen output"},
    {
        code: 22,
        params: 1,
        syntax: "VDU 22,mode",
        name: "Select the screen mode (MODE)",
        example: ["VDU 22,7", "is MODE 7"],
    },
    {
        code: 23,
        params: 9,
        syntax: "VDU 23,char,b1,b2,b3,b4,b5,b6,b7,b8",
        name: "Define a character: eight rows of pixels, top to bottom, one bit per pixel",
        example: ["VDU 23,224,255,129,129,129,129,129,129,255", "makes CHR$(224) a hollow square"],
    },
    {
        code: 24,
        params: 8,
        syntax: "VDU 24,left;bottom;right;top;",
        name: "Define the graphics window, in graphics units",
    },
    {
        code: 25,
        params: 5,
        syntax: "VDU 25,k,x;y;",
        name: "PLOT k,x,y (see the PLOT tab for k)",
        example: ["VDU 25,4,640;512;", "is MOVE 640,512"],
    },
    {code: 26, params: 0, syntax: "VDU 26", name: "Restore the default windows"},
    {code: 27, params: 0, syntax: "VDU 27", name: "Does nothing (Escape)"},
    {
        code: 28,
        params: 4,
        syntax: "VDU 28,left,bottom,right,top",
        name: "Define the text window, in character cells",
        example: ["VDU 28,5,10,34,2", "limits text to columns 5-34 and rows 2-10"],
    },
    {
        code: 29,
        params: 4,
        syntax: "VDU 29,x;y;",
        name: "Move the graphics origin (ORIGIN)",
        example: ["VDU 29,640;512;", "is ORIGIN 640,512: the centre of the screen"],
    },
    {code: 30, params: 0, syntax: "VDU 30", name: "Home the text cursor to the top left"},
    {
        code: 31,
        params: 2,
        syntax: "VDU 31,x,y",
        name: "Move the text cursor to column x, row y",
        example: ["VDU 31,10,5", "is PRINT TAB(10,5);"],
    },
    {code: 127, params: 0, syntax: "VDU 127", name: "Delete (backspace and erase)"},
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
    {offset: 0, position: "relative", action: "move"},
    {offset: 1, position: "relative", action: "foreground colour"},
    {offset: 2, position: "relative", action: "inverse colour"},
    {offset: 3, position: "relative", action: "background colour"},
    {offset: 4, position: "absolute", action: "move"},
    {offset: 5, position: "absolute", action: "foreground colour"},
    {offset: 6, position: "absolute", action: "inverse colour"},
    {offset: 7, position: "absolute", action: "background colour"},
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

const GroupSize = PlotColumns.length;

/** What PLOT k means: the group and column for k below 128; only the group for the extended codes. */
export function decodePlot(k) {
    const base = k - (k % GroupSize);
    const basic = PlotGroups.find(g => g.base === base);
    if (basic) {
        const {position, action} = PlotColumns[k - base];
        return {k, group: basic.name, column: `${position}, ${action}`};
    }
    const extended = PlotExtendedGroups.find(g => g.base === base);
    return extended ? {k, group: extended.name, column: null} : null;
}
