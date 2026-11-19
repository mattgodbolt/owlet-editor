// An empty, formatted DFS disc.
export function blankDisc() {
    const SingleSidedBytes = 200 * 1024;
    const SectorCount = 800;
    const disc = new Uint8Array(SingleSidedBytes);
    disc[0x106] = SectorCount >> 8;
    disc[0x107] = SectorCount & 0xff;
    return disc;
}
