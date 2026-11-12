// Runs statements in immediate mode on BBC BASIC II in jsbeeb's headless BBC B (or BASIC IV in its Master), and reports
// the error each raised.
// Each statement starts from the same snapshot, taken at the prompt after the prelude, so none can affect another.
// Lines are handed to BASIC by a WORDV handler in RAM rather than typed, which is what makes this fast.
import {MachineSession} from "jsbeeb/machine-session";
import {keywords} from "../../src/tokens.js";

const SupportProgram = [
    "10 END",
    "20 DEF PROCp:ENDPROC",
    "30 DEF PROCq(A):ENDPROC",
    "40 DEF FNf=1",
    "50 DEF FNg(A)=A",
    "60 DATA 1,2,3",
].join("\n");
const Prelude = 'X=1:Y=2:Z=3:A=1:I=1:X%=1:A%=1:X$="a":A$="a":DIM X(3),X%(3),X$(3),D 20';

// Syntax errors from BBC BASIC II; any other error is raised while running a statement and stops BASIC reading it.
// No such variable is here because the prelude defines every name the generator uses: BASIC reports it when what
// should be a value is not one, as in PRINT STR$~~1, or for a name with nothing after it, as in CALL.
export const SyntaxErrors = new Map([
    [4, "Mistake"],
    [5, "Missing ,"],
    [9, 'Missing "'],
    [16, "Syntax error"],
    [26, "No such variable"],
    [27, "Missing )"],
    [28, "Bad HEX"],
    [36, "No TO"],
    [39, "ON syntax"],
    [45, "Missing #"],
]);

const ReadLineHook = 0x0a00;
const ReadLine = 0x0a08;
const LineLength = 0x0a7f;
const OldWordv = 0x0a7d;
const ReadCharHook = 0x0a20;
const Wordv = 0x20c;
const Rdchv = 0x210;
const ErrorPointer = 0xfd;
const InputBuffer = 0x700;
const MaxLineLength = 238;
const TimeoutSecs = 0.3;
const MaxInputs = 3;

const tokenNames = new Map(keywords.map(kw => [kw.token, kw.keyword]));
const word = bytes => bytes[0] + 256 * bytes[1];

export async function createRom(model = "B-DFS1.2") {
    const session = new MachineSession(model);
    await session.initialise();
    await session.boot(10);
    await session.loadBasic(SupportProgram);
    session.writeMemory(OldWordv, [...session.readMemory(Wordv, 2)]);
    // CMP #0: BEQ ReadLine: JMP (OldWordv): NOP; ReadLine: LDY LineLength: CLC: RTS. ReadLine's breakpoint fills
    // the buffer, so every OSWORD 0 (line input) is answered without the keyboard.
    // prettier-ignore
    session.writeMemory(ReadLineHook, [0xc9, 0, 0xf0, 3, 0x6c, OldWordv & 0xff, OldWordv >> 8, 0xea,
        0xac, LineLength & 0xff, LineLength >> 8, 0x18, 0x60]);
    session.writeMemory(Wordv, [ReadLineHook & 0xff, ReadLineHook >> 8]);
    await session.type(Prelude);

    const nextLineRead = async () => {
        await session.runUntilAddress(ReadLine, TimeoutSecs);
        const {x, y, s} = session.registers();
        return {
            buffer: word(session.readMemory(x + 256 * y, 2)),
            caller: word(session.readMemory(0x101 + s, 2)),
        };
    };
    const answer = (buffer, text) => {
        session.writeMemory(buffer, [...Buffer.from(`${text}\r`, "latin1")]);
        session.writeMemory(LineLength, [text.length]);
    };
    const {caller: promptCaller} = await nextLineRead();
    // GET and friends read "A" at once: LDA #65: CLC: RTS.
    session.writeMemory(ReadCharHook, [0xa9, 0x41, 0x18, 0x60]);
    session.writeMemory(Rdchv, [ReadCharHook & 0xff, ReadCharHook >> 8]);
    session.writeMemory(ErrorPointer, [0, 0]);
    session.drainOutput();
    const atPrompt = session.snapshot({includeRoms: false});

    // Returns {error, message} for the error the statement raised, or {error: null}; {timeout: true} if it was
    // still running (or waiting for input) after TimeoutSecs.
    const run = async text => {
        if (text.length > MaxLineLength) throw new Error(`Statement too long for BASIC: ${text}`);
        session.restore(atPrompt);
        answer(InputBuffer, text);
        try {
            for (let inputs = 0; ; ++inputs) {
                const {buffer, caller} = await nextLineRead();
                // BASIC reads the prompt and its INPUT statements through the same routine; only the buffer differs.
                if (caller === promptCaller && buffer === InputBuffer) break;
                if (inputs === MaxInputs) return {timeout: true};
                answer(buffer, "1");
            }
        } catch (e) {
            return {timeout: true};
        } finally {
            session.drainOutput();
        }
        const block = word(session.readMemory(ErrorPointer, 2));
        if (!block) return {error: null};
        const bytes = [...session.readMemory(block, 64)];
        const message = bytes
            .slice(1, bytes.indexOf(0, 1))
            .map(b => tokenNames.get(b) || String.fromCharCode(b))
            .join("");
        return {error: bytes[0], message};
    };
    return {run, destroy: () => session.destroy()};
}
