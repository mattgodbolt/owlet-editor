// What BBC BASIC is doing, read from the emulated machine's memory with jsbeeb's reading of BASIC's workspace.
import {
    basicRom,
    LanguageRomNumber,
    lineHolding,
    readPointers,
    readResidentIntegers,
    readVariables,
    romTitle,
} from "jsbeeb/src/basic-state";

const LineHeaderBytes = 4;
const DefaultPrintFormat = "&0000090A";
const ResidentFirstByte = 0x400;
const ResidentLastByte = 0x46b;
const ResidentBytes = 4;

const notAtStart = ({name, value}) => value !== (name === "@%" ? DefaultPrintFormat : "0");

/** The bit in the written-to word of the resident integer holding `address`: @% is bit 0, A% bit 1, up to Z%. */
const residentBit = address => 1 << (((address - ResidentFirstByte) / ResidentBytes) | 0);

/**
 * The resident integers worth showing: those the program has written to (a bit of `written`), however the value
 * came to be what it is, so `X%=1:X%=0` still shows `X%`.
 */
export const writtenResidentIntegers = (residents, written) =>
    residents.filter((_, index) => written & (1 << index));

export class BasicWatch {
    constructor() {
        this.language = null;
        this.cpu = null;
        this.hook = null;
        this.written = 0;
    }

    /**
     * Starts noting which resident integers get written, on `cpu`'s write hook (jsbeeb's own, which sends every write
     * the machine makes through a slower path while it is attached). A write to a resident integer is the program's:
     * the OS or BASIC set them all before the program starts, and RUN, CLEAR, NEW and CHAIN leave them be. Those
     * written before this call are unknown, so those not at their start value stand in for them (see restart).
     */
    track(cpu) {
        if (this.cpu === cpu) return;
        this.untrack();
        this.cpu = cpu;
        this.hook = cpu.debugWrite.add(address => {
            if (address >= ResidentFirstByte && address <= ResidentLastByte)
                this.written |= residentBit(address);
        });
        this.restart();
    }

    /** Stops noting writes, which takes the machine back to its fast path. */
    untrack() {
        this.hook?.remove();
        this.cpu = null;
        this.hook = null;
        this.written = 0;
    }

    /** The machine has started again, so what was written is forgotten, and those not at their start value stand in. */
    restart() {
        this.written = 0;
        if (!this.cpu) return;
        const residents = readResidentIntegers(address => this.cpu.peekmemAsLanguage(address));
        residents.forEach((resident, index) => {
            if (notAtStart(resident)) this.written |= 1 << index;
        });
    }

    /** The language ROM, looked at again only when the machine or the language changes. */
    currentLanguage(cpu) {
        const peek = address => cpu.peekmemAsLanguage(address);
        const bank = cpu.bankPagedBy(peek(LanguageRomNumber));
        const rom = cpu.romBank(bank);
        const title = romTitle(rom);
        const known = this.language;
        if (known?.cpu !== cpu || known.bank !== bank || known.title !== title)
            this.language = {cpu, bank, title, basic: basicRom(rom) !== null};
        return this.language;
    }

    /**
     * What BASIC is doing: {basic: false, title} when the language is not a BASIC; otherwise the line it is reading
     * ({number, bytes, offset}, the offset being into the line's bytes after its header) or null when it is not in the
     * program (at the prompt), and its variables.
     */
    read(cpu) {
        this.track(cpu);
        const {basic, title} = this.currentLanguage(cpu);
        if (!basic) return {basic, title};
        const peek = address => cpu.peekmemAsLanguage(address);
        const {page, reading} = readPointers(peek);
        const line = lineHolding(peek, page, reading);
        let running = null;
        if (line) {
            const text = line.start + LineHeaderBytes;
            const bytes = [];
            for (let at = text; at < line.end; ++at) bytes.push(peek(at));
            running = {number: line.number, bytes, offset: reading - text};
        }
        return {
            basic,
            title,
            line: running,
            residents: writtenResidentIntegers(readResidentIntegers(peek), this.written),
            ...readVariables(peek),
        };
    }
}
