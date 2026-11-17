// What BBC BASIC is doing, read from the emulated machine's memory with jsbeeb's reading of BASIC's workspace.
import {
    basicRom,
    findLine,
    holds,
    LanguageRomNumber,
    lineHolding,
    listStatements,
    readPointers,
    readResidentIntegers,
    readVariables,
    romTitle,
} from "jsbeeb/src/basic-state";

const LineHeaderBytes = 4;
const TextPointerOffset = 0x0a;
const TextPointerHigh = 0x0c;
const InputBufferPage = 0x07;
// BASIC starts each statement with LDY &0A: INC &0A, then reads its first character with the LDA (&0B),Y that is this
// many bytes before jsbeeb's statementStart, so a write to &0A that leaves the CPU there is a statement starting.
const StatementReadBeforeStart = 6;
// BASIC's workspace beyond what jsbeeb reads: https://8bs.com/basic/memory.htm
const ErrorLine = 0x08;
const ExpressionPointerBase = 0x19;
const ExpressionPointerOffset = 0x1b;
// The OS's BRK handler leaves the address of the error block (its number, then its message up to a zero) here, writing
// the low byte first.
const ErrorBlock = 0xfd;
const ErrorBlockHigh = 0xfe;
// The text BASIC runs on an error: an ON ERROR's, or after ON ERROR OFF and at the prompt, its own handler in its ROM.
const ErrorHandler = 0x16;
const HandledErrorsKept = 8;
const PlacesKept = 64;
// Only the extent of each statement listStatements finds is wanted, not its text.
const NoKeywords = new Map();
const RomStart = 0x8000;
const RomEnd = 0xc000;
const MostMessageBytes = 255;
const FirstToken = 0x80;
// BASIC IV keeps "Missing " in its messages as a token of its own, which is not a keyword.
const MissingToken = 0x8d;
const Colon = 0x3a;
const Space = 0x20;
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

const word = (peek, address) => peek(address) | (peek(address + 1) << 8);
const reading = (peek, base, offset) => (word(peek, base) + peek(offset) - 1) & 0xffff;

const inRom = address => address >= RomStart && address < RomEnd;

function messageBytes(peek, block) {
    const bytes = [];
    for (let at = block + 1; at <= block + MostMessageBytes; ++at) {
        const code = peek(at & 0xffff);
        if (code === 0) break;
        bytes.push(code);
    }
    return bytes;
}

/** The message `bytes` of an error block, with their tokens spelt out as REPORT prints them. */
const spelt = (bytes, keywords) =>
    bytes
        .map(code => {
            if (code >= FirstToken)
                return code === MissingToken ? "Missing " : (keywords.get(code) ?? ".");
            return code >= Space ? String.fromCharCode(code) : ".";
        })
        .join("");

/**
 * The error BASIC has come back to its prompt from: its own error handler, which reports an error that no ON ERROR
 * has taken (or any error numbered 0, such as STOP), is BASIC text in its ROM, and the last text BASIC read until the
 * next command is typed. Its line is 0 for an error in a command typed at the prompt.
 */
function reportedError(peek, keywords) {
    if (!inRom(word(peek, ExpressionPointerBase))) return null;
    const block = word(peek, ErrorBlock);
    return {
        number: peek(block),
        message: spelt(messageBytes(peek, block), keywords),
        lineNumber: word(peek, ErrorLine),
    };
}

/**
 * Whether BASIC's text pointer, in page `high`, is in the program, rather than in a command typed at the prompt or in
 * BASIC's own error handler.
 */
const inProgram = high => high !== InputBufferPage && high < RomStart >> 8;

/** Where BASIC's two text pointers are reading: the statement's, and the expression's within it. */
const textPointers = peek => ({
    statement: readPointers(peek).reading,
    expression: reading(peek, ExpressionPointerBase, ExpressionPointerOffset),
});

/**
 * The offset into `line`'s text of the statement BASIC raised an error in, from its text pointers as they were then,
 * or null where they do not show it. The statement pointer can be on the colon between two statements: BASIC reads it
 * before a statement that does not start with a keyword, as an assignment does not, and then reads that through the
 * expression pointer; and after one it has finished, with the expression pointer left behind it. After an EVAL, the
 * expression pointer is not in the program at all.
 */
function errorOffset(peek, line, {statement, expression}) {
    if (!holds(line, statement)) return null;
    const text = line.start + LineHeaderBytes;
    let colon = statement;
    while (peek(colon) === Space && colon > text) --colon;
    if (peek(colon) !== Colon) return statement - text;
    if (!holds(line, expression)) return null;
    if (expression < colon) return colon - text;
    let next = colon + 1;
    while (peek(next) === Space) ++next;
    return next - text;
}

function lineBytes(peek, line) {
    const bytes = [];
    for (let at = line.start + LineHeaderBytes; at < line.end; ++at) bytes.push(peek(at));
    return bytes;
}

/** Which of the parts of `line` between colons holds the byte at `offset` into its text, or null for a null offset. */
function part(peek, line, offset) {
    if (offset === null) return null;
    const at = line.start + LineHeaderBytes + offset;
    return listStatements(peek, line, NoKeywords).findIndex(({to}) => at <= to);
}

/**
 * The errors ON ERROR handlers have taken: the last few different ones, each kept once with the number of times it was
 * raised, the latest last; and the number taken in all. Where each was raised is worked out once for each place, as
 * BASIC's text pointers can be a byte apart for the same statement.
 */
class HandledErrors {
    constructor() {
        this.clear();
    }

    clear() {
        this.kept = new Map();
        this.places = new Map();
        this.total = 0;
    }

    note(peek, {number, bytes, raised, handler}) {
        const where = this.place(peek, raised, handler);
        const key = `${number} ${bytes} ${where.key}`;
        const known = this.kept.get(key) ?? {number, bytes, ...where, count: 0};
        ++known.count;
        ++this.total;
        this.kept.delete(key);
        this.kept.set(key, known);
        if (this.kept.size > HandledErrorsKept) this.kept.delete(this.kept.keys().next().value);
    }

    /**
     * Where an error was raised: its line, as the running one is, found from the text pointer as BASIC finds ERL (so a
     * line numbered 0 is not taken for the prompt, where BASIC's own handler is always set); the line number of the ON
     * ERROR that took it; each null where it is not in the program; and a key, the same for the same statement. The
     * text pointer can be a byte further into a line reached by GOTO than one reached from the line before, so the
     * key has the part of the line between colons rather than the offset.
     */
    place(peek, raised, handler) {
        const at = `${raised.statement} ${raised.expression} ${handler}`;
        const known = this.places.get(at);
        if (known) return known;
        const {page} = readPointers(peek);
        const found = lineHolding(peek, page, raised.statement);
        const line = found && {
            number: found.number,
            bytes: lineBytes(peek, found),
            offset: errorOffset(peek, found, raised),
        };
        const handlerLine = lineHolding(peek, page, handler)?.number ?? null;
        const where = {
            line,
            handler: handlerLine,
            key: `${line?.number} ${line && part(peek, found, line.offset)} ${handlerLine}`,
        };
        if (this.places.size >= PlacesKept) this.places.clear();
        this.places.set(at, where);
        return where;
    }

    latestFirst() {
        return [...this.kept.values()].reverse();
    }
}

export class BasicWatch {
    constructor() {
        this.language = null;
        this.cpu = null;
        this.hook = null;
        this.written = 0;
        this.programLast = false;
        this.raised = null;
        this.stopped = null;
        this.handled = new HandledErrors();
    }

    /**
     * Starts noting which resident integers get written, on `cpu`'s write hook (jsbeeb's own, which sends every write
     * the machine makes through a slower path while it is attached). A write to a resident integer is the program's:
     * the OS or BASIC set them all before the program starts, and RUN, CLEAR, NEW and CHAIN leave them be. Those
     * written before this call are unknown, so those not at their start value stand in for them (see restart). It also
     * notes BASIC's text pointers as each error is raised, before BASIC's error handler moves them to its ON ERROR text,
     * and whether a statement of the program had started since BASIC last pointed it at its input buffer, which tells an
     * error in a line numbered 0 from one typed at the prompt; and keeps each error an ON ERROR handler takes, which is
     * gone from BASIC's workspace once the handler runs.
     */
    track(cpu) {
        if (this.cpu === cpu) return;
        this.untrack();
        this.cpu = cpu;
        const peek = address => cpu.peekmemAsLanguage(address);
        this.hook = cpu.debugWrite.add((address, value) => {
            if (address >= ResidentFirstByte && address <= ResidentLastByte)
                this.written |= residentBit(address);
            else if (address === ErrorBlockHigh)
                this.noteError(peek, peek(ErrorBlock) | (value << 8));
            else if (address === TextPointerOffset && cpu.pc === this.language?.statementRead)
                this.noteStatement(peek(TextPointerHigh));
            else if (address === TextPointerHigh && value === InputBufferPage)
                this.programLast = false;
        });
        this.restart();
    }

    /** Stops noting writes, which takes the machine back to its fast path. */
    untrack() {
        this.hook?.remove();
        this.cpu = null;
        this.hook = null;
        this.written = 0;
        this.forgetErrors();
    }

    /**
     * A statement is starting in the page `high`. The program running again after the prompt, as RUN, GOTO or a PROC
     * typed there make it, is a new run.
     */
    noteStatement(high) {
        const wasProgram = this.programLast;
        this.programLast = inProgram(high);
        if (!this.programLast) return;
        this.stopped = null;
        if (!wasProgram) this.handled.clear();
    }

    /**
     * The OS is handing BASIC the error whose block is at `block`. BASIC's own handler takes it when no ON ERROR is
     * set, and takes every error numbered 0 (STOP) whatever is set; an ON ERROR handler takes the rest.
     */
    noteError(peek, block) {
        this.raised = {...textPointers(peek), inProgram: this.programLast};
        const number = peek(block);
        const handler = word(peek, ErrorHandler);
        if (number === 0 || inRom(handler)) return;
        this.handled.note(peek, {
            number,
            bytes: messageBytes(peek, block),
            raised: this.raised,
            handler,
        });
    }

    forgetErrors() {
        this.programLast = false;
        this.raised = null;
        this.stopped = null;
        this.handled.clear();
    }

    /** The machine has started again, so what was written is forgotten, and those not at their start value stand in. */
    restart() {
        this.written = 0;
        this.forgetErrors();
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
        if (known?.cpu !== cpu || known.bank !== bank || known.title !== title) {
            const basic = basicRom(rom);
            this.language = {
                cpu,
                bank,
                title,
                basic: basic !== null,
                keywords: basic?.keywords,
                statementRead: basic && basic.statementStart - StatementReadBeforeStart,
            };
        }
        return this.language;
    }

    /**
     * What BASIC is doing: {basic: false, title} when the language is not a BASIC; otherwise the line it is reading
     * ({number, bytes, offset}, the offset being into the line's bytes after its header) or null when it is not in the
     * program (at the prompt), the error it is at the prompt after (see errorAtPrompt) or null, the errors ON ERROR
     * handlers have taken in this run (see handledErrors), and its variables.
     */
    read(cpu) {
        this.track(cpu);
        const {basic, title, keywords} = this.currentLanguage(cpu);
        if (!basic) return {basic, title};
        const peek = address => cpu.peekmemAsLanguage(address);
        const {page, reading} = readPointers(peek);
        const line = lineHolding(peek, page, reading);
        return {
            basic,
            title,
            line: line && {
                number: line.number,
                bytes: lineBytes(peek, line),
                offset: reading - line.start - LineHeaderBytes,
            },
            error: line ? null : this.errorAtPrompt(peek, page, keywords),
            handled: this.handledErrors(keywords),
            residents: writtenResidentIntegers(readResidentIntegers(peek), this.written),
            ...readVariables(peek),
        };
    }

    /**
     * At the prompt, the error the program last stopped with, which is kept until a statement of the program runs
     * again (as RUN, GOTO or a PROC typed at the prompt make one, and LIST does not), or else an
     * error in a command typed at the prompt while it is the last thing BASIC did: {number, message, line}, the line
     * being as the running one is, with a null offset where the statement is not known, or null at the prompt.
     */
    errorAtPrompt(peek, page, keywords) {
        const error = reportedError(peek, keywords);
        if (!error) return this.stopped;
        const {lineNumber, ...shown} = error;
        const inProgram = this.raised ? this.raised.inProgram : lineNumber !== 0;
        if (!inProgram) return this.stopped ?? {...shown, line: null};
        const found = findLine(peek, page, lineNumber);
        const offset = found && this.raised ? errorOffset(peek, found, this.raised) : null;
        this.stopped = {
            ...shown,
            line: {number: lineNumber, bytes: found ? lineBytes(peek, found) : [], offset},
        };
        return this.stopped;
    }

    /**
     * The errors ON ERROR handlers have taken since the program last started, as {total, errors}: the number taken,
     * and the last few different ones, the latest first, each {number, message, line, handler, count}, the line and
     * handler being as HandledErrors.place gives them and the count the times it was raised.
     */
    handledErrors(keywords) {
        const errors = this.handled.latestFirst().map(({number, bytes, line, handler, count}) => ({
            number,
            message: spelt(bytes, keywords),
            line,
            handler,
            count,
        }));
        return {total: this.handled.total, errors};
    }
}
