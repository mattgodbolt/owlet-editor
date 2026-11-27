import {peekViewed, screenView} from "jsbeeb/src/paging";
import {AcornDFSdisc} from "./DFS";

const ScreenEnd = 0x8000;
const BytesPerCell = 8;
const CellSubtractUnit = 0x800;
const Ma13 = 1 << 13;
const CrtcAddressMask = 0x3fff;
const TeletextBase = 0x7c00;
const TeletextBaseBelow = 0x3c00;
const TeletextSize = 0x400;
const TeletextCellMask = TeletextSize - 1;
const TeletextPageBit = 0x800;
const BootFileAddress = 0x1900;
const IoProcessor = 0xffff0000;
const BasicPageHighByte = 0x18;
const BasicIIExec = 0x8023;
const BasicIVExec = 0x802b;

/**
 * The screen the video is showing, from the first byte it displays: the size of the mode's screen memory in bytes,
 * wrapped at &8000 to the mode's base the way the video wraps it, so the bytes are the picture in display order
 * however far the CRTC start address (R12, R13) has scrolled it. `base` is where the mode's screen memory starts, so
 * where `*LOAD` of the bytes puts them with the CRTC at its default. Teletext is 1K at &7C00, the rest are 20K at
 * &3000, 16K at &4000, 10K at &5800 or 8K at &6000, by the IC32 wrap. On a Master in a shadow mode the bytes are the
 * shadow RAM, whatever the CPU pages.
 * @returns {{base: number, bytes: number[]}}
 */
export function screenDump(cpu) {
    const {regs, screenSubtract} = cpu.video;
    const start = (regs[13] | (regs[12] << 8)) & CrtcAddressMask;
    const teletext = (start & Ma13) !== 0;
    const size = teletext ? TeletextSize : screenSubtract * CellSubtractUnit;
    const bytes = [];
    for (let i = 0; i < size; ++i) {
        const address = teletext
            ? teletextAddress(cpu, (start + i) & CrtcAddressMask)
            : bitmapAddress(screenSubtract, start * BytesPerCell + i);
        bytes.push(peekViewed(cpu, screenView(cpu, address), address));
    }
    return {base: ScreenEnd - size, bytes};
}

// Where the video reads the cell `cell` of the CRTC's address (jsbeeb's Video.readVideoMem), the Model B's MA11
// choosing &3C00 or &7C00 for teletext.
function teletextAddress(cpu, cell) {
    const page = cpu.model.isMaster || cell & TeletextPageBit ? TeletextBase : TeletextBaseBelow;
    return page | (cell & TeletextCellMask);
}

// Where the video reads byte `offset` from the CRTC's address 0, in 8-byte cells; the IC32 subtracts `subtract` units
// of &800 from an address that has passed &8000.
function bitmapAddress(subtract, offset) {
    const cell = (offset / BytesPerCell) & 0x1fff;
    const high = ((cell >>> 8) & 0xf) - (cell & 0x1000 ? subtract : 0);
    return (
        (((high & 0xf) << 11) | ((cell & 0xff) * BytesPerCell) | (offset % BytesPerCell)) &
        (ScreenEnd - 1)
    );
}

/**
 * The load and exec addresses BASIC's `SAVE` gives a program on `cpu`'s machine: PAGE as the running BASIC has it, with
 * the top word set for the I/O processor, and the BASIC ROM's entry (BASIC II on the Model B, BASIC IV on the Master).
 */
export function basicSaveAddresses(cpu) {
    const page = cpu.readmem(BasicPageHighByte) << 8;
    return {
        load: IoProcessor + page,
        exec: IoProcessor + (cpu.model.isMaster ? BasicIVExec : BasicIIExec),
    };
}

/** The exported disc: the tokenised `program`, booted with SHIFT+BREAK, and the screen `cpu` shows. */
export function discImage(program, cpu) {
    const disc = new AcornDFSdisc();
    const {base, bytes} = screenDump(cpu);
    disc.save("README", "Created by Owlet https://bbcmic.ro\r", 0x0000, 0x0000);
    const {load, exec} = basicSaveAddresses(cpu);
    disc.save("PROGRAM", program, load, exec);
    disc.save("SCREEN", bytes, IoProcessor + base, 0x0000);
    disc.save("!BOOT", 'CHAIN"PROGRAM"\r', BootFileAddress, BootFileAddress);
    return disc.image;
}
