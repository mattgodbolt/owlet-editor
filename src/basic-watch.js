// What BBC BASIC is doing, read from the emulated machine's memory with jsbeeb's reading of BASIC's workspace.
import {
    basicRom,
    ErrorBlockPointer,
    findLine,
    holds,
    LanguageRomNumber,
    lineHolding,
    readPointers,
    readReportedError,
    readResidentIntegers,
    readVariables,
    readWait,
    romTitle,
    TextPointerBase,
    TextPointerOffset,
} from "jsbeeb/src/basic-state";
import {totalCycles} from "./cycles";
import {keywords} from "./tokens";

const LineHeaderBytes = 4;
const TextPointerHigh = TextPointerBase + 1;
const InputBufferPage = 0x07;
// The OS's BRK handler writes the error block's address low byte first, so a write to its high byte is an error raised,
// from the MOS ROM (at &DC3A on the Model B and &E5BB on the Master), where a program cannot write.
const ErrorBlockHigh = ErrorBlockPointer + 1;
const MosStart = 0xc000;
const MostMessageBytes = 255;
const FirstToken = 0x80;
const MissingToken = 0x8d;
// The text BASIC runs on an error: an ON ERROR's, or after ON ERROR OFF and at the prompt, its own handler in its ROM.
const ErrorHandler = 0x16;
const StackPointer = 0x04;
const HandledErrorsKept = 8;
const PlacesKept = 64;
const RomStart = 0x8000;
const Colon = 0x3a;
const Space = 0x20;
const Return = 0x0d;
const Quote = 0x22;
const tokenOf = word => keywords.find(({keyword}) => keyword === word).token;
const ElseToken = tokenOf("ELSE");
const ThenToken = tokenOf("THEN");
const FnToken = tokenOf("FN");
const DefToken = tokenOf("DEF");
const IfToken = tokenOf("IF");
const ProcToken = tokenOf("PROC");
const RepeatToken = tokenOf("REPEAT");
const OpenBracket = 0x28;
const CloseBracket = 0x29;
const DefaultPrintFormat = "&0000090A";
// Longer than BASIC takes between the writes that move its text pointer, which it makes one byte at a time, and longer
// than the OS takes over an interrupt, which can come between them.
const PointerWritingCycles = 32;
const InterruptCycles = 4000;
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

/** Where BASIC's text pointer reads, as readPointers has it, with its offset `offset`. */
const textReading = (peek, offset) => (word(peek, TextPointerBase) + offset - 1) & 0xffff;

const inRom = address => address >= RomStart && address < MosStart;

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
 * Whether BASIC's text pointer, in page `high`, is in the program, rather than in a command typed at the prompt or in
 * BASIC's own error handler.
 */
const inProgram = high => high !== InputBufferPage && high < RomStart >> 8;

/**
 * The offset into `line`'s text of the statement BASIC raised an error in, from its text pointers as they were then,
 * or null where they do not show it. A keyword statement leaves the statement pointer on its token or further into it.
 * An assignment leaves it on the byte before the assignment (a colon or space, THEN, ELSE, REPEAT, or the end of an
 * IF's condition or a DEF's name), or on its first byte when reached by GOTO or ON ERROR, and reads on through the
 * expression pointer, which is then not behind it. A statement BASIC has finished leaves it on the colon, ELSE or return
 * after it. Between two statements, the expression pointer says which: not behind, the one after. In an EVAL, the
 * expression pointer reads the EVAL's string where EVAL copied it, on BASIC's stack, and the statement pointer is as
 * the statement left it, so the EVAL is ahead of it.
 */
function errorOffset(peek, line, {statement, expression, inEval}) {
    if (!holds(line, statement)) return null;
    const text = line.start + LineHeaderBytes;
    const ahead = inEval || (holds(line, expression) && expression >= statement);
    let end = statement;
    while (peek(end) === Space && end > text) --end;
    const code = end < text ? null : peek(end);
    if (code === Return) return end - text - 1;
    if (code !== Colon && code !== ElseToken) return statement - text + (ahead ? 1 : 0);
    if (!ahead) return holds(line, expression) ? end - text - 1 : null;
    let next = end + 1;
    while (peek(next) === Space) ++next;
    return next - text;
}

function lineBytes(peek, line) {
    const bytes = [];
    for (let at = line.start + LineHeaderBytes; at < line.end; ++at) bytes.push(peek(at));
    return bytes;
}

// After PROC or FN the ROM takes @ anywhere in a name.
const isNameCharacter = code => /[\w`@]/.test(String.fromCharCode(code));

/** The address of the last byte of the name, and any parameters, of a DEF PROC or FN at `at`, or null. */
function definedNameEnd(peek, at, end) {
    let next = at + 1;
    while (peek(next) === Space) ++next;
    if (peek(next) !== ProcToken && peek(next) !== FnToken) return null;
    do ++next;
    while (next < end && isNameCharacter(peek(next)));
    const nameEnd = next - 1;
    while (peek(next) === Space) ++next;
    if (peek(next) !== OpenBracket) return nameEnd;
    while (next < end && peek(next) !== CloseBracket) ++next;
    return next;
}

/**
 * The address of the last byte of each statement of `line` that its bytes alone show: up to a colon, THEN, REPEAT or
 * a DEF's name and parameters, or the byte before an ELSE or IF, and the last up to the return that ends the line. A
 * statement after an implicit THEN is not told from the IF before it unless it is another IF, as that needs the
 * condition parsed. A colon in a REM, DATA or star command ends a statement here though not for BASIC, which is no
 * matter, as no error is raised past its start.
 */
function statementEnds(peek, line) {
    const found = [];
    let quoted = false;
    for (let at = line.start + LineHeaderBytes; at < line.end; ++at) {
        const code = peek(at);
        if (code === Quote) quoted = !quoted;
        if (quoted) continue;
        const named = code === DefToken ? definedNameEnd(peek, at, line.end) : null;
        if (named !== null) at = named;
        if (named !== null || code === Colon || code === ThenToken || code === RepeatToken)
            found.push(at);
        else if (code === ElseToken || code === IfToken) found.push(at - 1);
    }
    found.push(line.end);
    return found;
}

/** Which statement of `line`, as statementEnds tells them, holds the byte `offset` into its text, or null for null. */
function part(peek, line, offset) {
    if (offset === null) return null;
    const at = line.start + LineHeaderBytes + offset;
    return statementEnds(peek, line).findIndex(end => at <= end);
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
     * key has the statement of the line (see statementEnds) rather than the offset.
     */
    place(peek, raised, handler) {
        const at = `${raised.statement} ${raised.expression} ${raised.inEval} ${handler}`;
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
        this.interruptHook = null;
        this.written = 0;
        this.programLast = false;
        this.raised = null;
        this.stopped = null;
        this.handled = new HandledErrors();
        this.forgetMoving();
        this.forgetPointer();
    }

    /**
     * Starts noting which resident integers get written, on `cpu`'s write hook (jsbeeb's own, which sends every write
     * the machine makes through a slower path while it is attached). A write to a resident integer is the program's:
     * the OS or BASIC set them all before the program starts, and RUN, CLEAR, NEW and CHAIN leave them be. Those
     * written before this call are unknown, so those not at their start value stand in for them (see restart). It also
     * notes BASIC's text pointers as each error is raised, before BASIC's error handler moves them to its ON ERROR text,
     * and whether a statement of the program had started since BASIC last pointed it at its input buffer, which tells an
     * error in a line numbered 0 from one typed at the prompt; keeps each error an ON ERROR handler takes, which is
     * gone from BASIC's workspace once the handler runs; notes where its text pointer was last whole (see settled); and
     * notes whether BASIC has moved on through the program, which it does by writing its text pointer at each statement.
     */
    track(cpu) {
        if (this.cpu === cpu) return;
        this.untrack();
        this.cpu = cpu;
        const peek = address => cpu.peekmemAsLanguage(address);
        this.hook = cpu.debugWrite.add((address, value) => {
            if (address >= ResidentFirstByte && address <= ResidentLastByte)
                this.written |= residentBit(address);
            else if (address === ErrorBlockHigh && cpu.pc >= MosStart)
                this.noteError(peek, peek(ErrorBlockPointer) | (value << 8));
            else if (address >= TextPointerOffset && address <= TextPointerHigh)
                this.notePointer(cpu, peek, address, value);
        });
        this.interruptHook = cpu.debugInterrupt.add(() => this.noteInterrupt(cpu));
        this.restart();
    }

    /** Stops noting writes, which takes the machine back to its fast path. */
    untrack() {
        this.hook?.remove();
        this.interruptHook?.remove();
        this.cpu = null;
        this.hook = null;
        this.interruptHook = null;
        this.written = 0;
        this.forgetErrors();
        this.forgetPointer();
    }

    notePointer(cpu, peek, address, value) {
        const cycles = totalCycles(cpu);
        if (cycles - this.pointerWritten > PointerWritingCycles && !this.mayBeTorn(cycles))
            this.lastWhole = textReading(peek, peek(TextPointerOffset));
        this.pointerWritten = cycles;
        this.interruptedAt = null;
        if (address === TextPointerOffset) this.movedOn = true;
        if (address === TextPointerOffset && cpu.pc === this.language?.statementRead) {
            this.lastWhole = textReading(peek, value);
            this.noteStatement(peek(TextPointerHigh));
        } else if (address === TextPointerHigh && value === InputBufferPage)
            this.programLast = false;
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
        const {reading: statement, expression, himem} = readPointers(peek);
        const inEval = expression >= word(peek, StackPointer) && expression < himem;
        this.raised = {statement, expression, inEval, inProgram: this.programLast};
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

    forgetMoving() {
        this.movedOn = true;
        this.stalled = false;
        this.readAt = null;
        this.waiting = null;
    }

    /** An interrupt is starting, which may have come between BASIC's writes to its text pointer. */
    noteInterrupt(cpu) {
        const cycles = totalCycles(cpu);
        if (this.mayBeTorn(cycles) || cycles - this.pointerWritten <= PointerWritingCycles)
            this.interruptedAt = cycles;
    }

    /** Whether an interrupt came so soon after BASIC wrote its text pointer that the write may be half done. */
    mayBeTorn(cycles) {
        return this.interruptedAt !== null && cycles - this.interruptedAt <= InterruptCycles;
    }

    forgetPointer() {
        this.lastWhole = null;
        this.pointerWritten = null;
        this.interruptedAt = null;
    }

    /**
     * The machine has started again, so what was written, and what BASIC was waiting for, are forgotten, and those not
     * at their start value stand in.
     */
    restart() {
        this.written = 0;
        this.forgetErrors();
        this.forgetPointer();
        this.forgetMoving();
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
                statementRead: basic?.statementRead,
            };
        }
        return this.language;
    }

    /**
     * What BASIC is doing: {basic: false, title} when the language is not a BASIC; otherwise the line it is reading
     * ({number, bytes, offset}, the offset being into the line's bytes after its header) or null when it is not in the
     * program (at the prompt), what the program in that line is waiting for (see waitFor) or null, the error it is
     * at the prompt after (see errorAtPrompt) or null, the errors ON ERROR handlers have taken in this run (see
     * handledErrors), and its variables.
     */
    read(cpu) {
        this.track(cpu);
        const {basic, title, keywords} = this.currentLanguage(cpu);
        if (!basic) return {basic, title};
        const peek = address => cpu.peekmemAsLanguage(address);
        const {page, reading: sampled} = readPointers(peek);
        const reading = this.settled(cpu, sampled);
        const line = lineHolding(peek, page, reading);
        const stalled = this.stalledSinceLastRead(cpu);
        return {
            basic,
            title,
            line: line && {
                number: line.number,
                bytes: lineBytes(peek, line),
                offset: reading - line.start - LineHeaderBytes,
            },
            wait: line && this.waitFor(readWait(cpu, line, keywords), stalled),
            error: line ? null : this.errorAtPrompt(peek, page, keywords),
            handled: this.handledErrors(keywords),
            residents: writtenResidentIntegers(readResidentIntegers(peek), this.written),
            ...readVariables(peek),
        };
    }

    /**
     * What the program is waiting for, {kind, keyword} from jsbeeb's readWait (`wait`), or null while it is running:
     * in the vsync loop it is waiting, and elsewhere only while BASIC has `stalled`, as a program that reads the
     * keyboard with INKEY(0) passes through the OS's keyboard read without waiting. A wait lasts while BASIC stays
     * stalled, through a frame that ends in an interrupt, which readWait cannot place.
     */
    waitFor(wait, stalled) {
        if (wait && (wait.kind === "vsync" || stalled)) this.waiting = wait;
        else if (!stalled || this.waiting?.kind === "vsync") this.waiting = null;
        return this.waiting;
    }

    /**
     * Whether BASIC has not moved on since the last read that came after the machine had run, as it does not while it
     * waits; as it was then while the machine has not run since, as while it is paused.
     */
    stalledSinceLastRead(cpu) {
        const cycles = totalCycles(cpu);
        if (cycles !== this.readAt) {
            this.stalled = !this.movedOn;
            this.movedOn = false;
            this.readAt = cycles;
        }
        return this.stalled;
    }

    /**
     * Where BASIC is reading the program: where its text pointer is (`sampled`), or, where that may be torn, where it
     * last was whole. BASIC moves the pointer with separate writes to its base and its offset (at the end of a
     * statement, and in BASIC IV's GOTO), and a frame that ends between them leaves it past the statement, often in
     * another line or past the end of the program. So it is taken as whole once BASIC has gone on for a while without
     * writing it, unless an interrupt came soon after it last did, which can be between two of the writes, until BASIC
     * writes it again or the interrupt is surely over; and, as the hooks note, just before BASIC starts writing it
     * again after a while with no such interrupt, and as a statement starts.
     */
    settled(cpu, sampled) {
        const cycles = totalCycles(cpu);
        const whole =
            cycles - this.pointerWritten > PointerWritingCycles && !this.mayBeTorn(cycles);
        return whole ? sampled : (this.lastWhole ?? sampled);
    }

    /**
     * At the prompt, the error the program last stopped with, which is kept until a statement of the program runs
     * again (as RUN, GOTO or a PROC typed at the prompt make one, and LIST does not), or else an
     * error in a command typed at the prompt while it is the last thing BASIC did: {number, message, line}, the line
     * being as the running one is, with a null offset where the statement is not known, or null at the prompt.
     */
    errorAtPrompt(peek, page, keywords) {
        const error = readReportedError(peek, keywords);
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
