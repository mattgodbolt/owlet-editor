import {peekViewed, screenView} from "jsbeeb/src/paging";
import {AcornDFSdisc} from "./DFS";

// Every mode's screen, scrolled or not, is in &3000 to &7FFF: in main RAM, or on a Master in a shadow mode in the
// shadow RAM at the same addresses.
export const ScreenStart = 0x3000;
export const ScreenEnd = 0x8000;
const ScreenLoadAddress = 0xffff3000;
const BasicPage = 0x1900;

/** &3000 to &7FFF as the video reads it, which on a Master in a shadow mode is shadow RAM whatever the CPU pages. */
export function screenDump(cpu) {
    const bytes = [];
    for (let address = ScreenStart; address < ScreenEnd; ++address)
        bytes.push(peekViewed(cpu, screenView(cpu, address), address));
    return bytes;
}

/** The exported disc: the tokenised `program`, booted with SHIFT+BREAK, and the screen `cpu` shows. */
export function discImage(program, cpu) {
    const disc = new AcornDFSdisc();
    disc.save("README", "Created by Owlet https://bbcmic.ro\r", 0x0000, 0x0000);
    disc.save("PROGRAM", program, BasicPage, BasicPage);
    disc.save("SCREEN", screenDump(cpu), ScreenLoadAddress, 0x0000);
    disc.save("!BOOT", 'CHAIN"PROGRAM"\r', BasicPage, BasicPage);
    return disc.image;
}
