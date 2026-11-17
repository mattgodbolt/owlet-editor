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

/** The resident integers that are not as BASIC starts them: @% other than its default, and A% to Z% other than 0. */
export const setResidentIntegers = residents =>
    residents.filter(({name, value}) => value !== (name === "@%" ? DefaultPrintFormat : "0"));

export class BasicWatch {
    constructor() {
        this.language = null;
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
            residents: setResidentIntegers(readResidentIntegers(peek)),
            ...readVariables(peek),
        };
    }
}
