// A range of the emulated machine's memory, given as BASIC expressions, read as the program or the video sees it, and
// the text the Save memory dialog puts on the clipboard for it.
import {readPointers, readResidentIntegers, readVariables} from "jsbeeb/src/basic-state";
import {
    AndyView,
    bankName,
    describeBank,
    MainView,
    PagedView,
    peekViewed,
    ShadowView,
    viewedBank,
    viewsFor,
} from "jsbeeb/src/paging";
import {evaluate, ExpressionError} from "./memory-expression";

export const ProgramView = PagedView;
export const AddressSpace = 0x10000;
const LineFeed = 0x0a;
const CarriageReturn = 0x0d;
const ShadowStart = 0x3000;
const ShadowEnd = 0x8000;
const ResidentName = /^[A-Z]%$/;
const NoBank = "empty";

export const hex = (value, digits = 4) =>
    `${value < 0 ? "-" : ""}&${Math.abs(value).toString(16).toUpperCase().padStart(digits, "0")}`;

/** The bytes a line of a BASIC program cannot hold as they are. */
export const breaksLine = byte => byte === LineFeed || byte === CarriageReturn;

/**
 * A function giving the number `PAGE`, `TOP`, `HIMEM`, `LOMEM`, a resident integer `A%` to `Z%` or one of the
 * program's numeric variables names, from BASIC's workspace as `peek` reads it, or undefined for any other name.
 */
export function basicNames(peek) {
    const {page, top, himem, lomem} = readPointers(peek);
    const named = new Map([
        ["PAGE", page],
        ["TOP", top],
        ["HIMEM", himem],
        ["LOMEM", lomem],
    ]);
    // Every resident integer exists, as 0 until written; other variables only once the program has made them.
    for (const {name, value} of readResidentIntegers(peek))
        if (ResidentName.test(name)) named.set(name, Number(value));
    for (const {name, value} of readVariables(peek).variables)
        if (!name.endsWith("$") && !name.endsWith(")")) named.set(name, Number(value));
    return name => named.get(name);
}

function viewLabel(cpu, view) {
    switch (view) {
        case ProgramView:
            return "As the program sees it";
        case AndyView:
            return "ANDY, &8000 to &8FFF";
        case MainView:
            return "Main RAM, &3000 to &7FFF";
        case ShadowView:
            return "Shadow RAM (the screen in a shadow mode), &3000 to &7FFF";
        default: {
            const bank = viewedBank(view);
            const holds = describeBank(cpu, bank);
            const unused = holds === NoBank || cpu.romBank(bank).every(byte => byte === 0);
            return unused ? null : `Bank ${bankName(bank)} (${holds}), &8000 to &BFFF`;
        }
    }
}

/**
 * The views of memory the dialog offers on `cpu`'s machine, as {view, label}: the program's, then each sideways bank
 * with a ROM or anything but zeros in it, then on a Master ANDY and the main and shadow RAM.
 */
export function memoryViews(cpu) {
    return viewsFor(cpu.model).flatMap(view => {
        const label = viewLabel(cpu, view);
        return label ? [{view, label}] : [];
    });
}

/**
 * The byte at `address` as `view` shows it, without side effects. Outside the part of memory a view covers it reads as
 * the program does: on a Master, &3000 to &7FFF is main or shadow RAM by where the code reading it is, and the program's
 * code is not the OS's VDU driver, which may be what the CPU was running when the frame ended.
 */
export function peekView(cpu, view, address) {
    address &= AddressSpace - 1;
    const screenRam = address >= ShadowStart && address < ShadowEnd;
    if (view === MainView || view === ShadowView || (view !== ProgramView && !screenRam))
        return peekViewed(cpu, view, address);
    return cpu.peekmemAsLanguage(address);
}

/** The bytes from `start` to `end` as `view` shows them. */
export const readRange = (cpu, view, {start, end}) =>
    Uint8Array.from({length: end - start + 1}, (_, i) => peekView(cpu, view, start + i));

/** Whether the video is showing shadow RAM, which the program's view does not read, over some of `start` to `end`. */
export const screenIsShadow = (cpu, {start, end}) =>
    cpu.model.isMaster && !!cpu.videoDisplayPage && start < ShadowEnd && end >= ShadowStart;

/**
 * The text the clipboard gets for `bytes`: each as the character BBC BASIC shows it as, which for the control codes and
 * 127 to 160 is the one 256 higher, as Owlet takes program text.
 */
export function clipboardText(bytes) {
    let text = "";
    for (const byte of bytes)
        text += String.fromCodePoint(
            byte < 32 || (byte >= 127 && byte < 161) ? byte + 0x100 : byte,
        );
    return text;
}

function evaluateIn(what, text, context) {
    try {
        const value = evaluate(text, context);
        if (!Number.isFinite(value)) throw new ExpressionError("Not a finite number");
        return value;
    } catch (e) {
        if (e instanceof ExpressionError) throw new ExpressionError(`${what}: ${e.message}`);
        throw e;
    }
}

/**
 * The range {start, end} that `first`, and `second` as the last address or (with `byLength`) the length, give with
 * `context` (see evaluate). Throws an ExpressionError saying what is wrong where they do not give one inside memory.
 */
export function resolveRange({first, second, byLength}, context) {
    const start = evaluateIn("Start", first, context);
    const other = evaluateIn(byLength ? "Length" : "End", second, context);
    if (start < 0 || start >= AddressSpace)
        throw new ExpressionError(`The start, ${hex(start)}, is not an address (&0000 to &FFFF)`);
    if (byLength && other < 1) throw new ExpressionError(`The length is ${other}`);
    const end = byLength ? start + other - 1 : other;
    if (end < start) throw new ExpressionError(`The end, ${hex(end)}, is before the start`);
    if (end >= AddressSpace) throw new ExpressionError(`The range runs past &FFFF, to ${hex(end)}`);
    return {start, end};
}
