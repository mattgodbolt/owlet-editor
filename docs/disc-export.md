# Disc export

What the Disc button in the Share dialog puts in `owletExport.ssd`. The [README](../README.md#disc-export) has the short
version. The disc holds `PROGRAM`, a `!BOOT` that runs it on SHIFT+BREAK, and `SCREEN`, described here.

## The `PROGRAM` file

`PROGRAM` is catalogued as a real machine's BASIC `SAVE "PROGRAM"` would catalogue it: the load address is `PAGE` of the
machine running, read from the emulator when the button is pressed, with the top word set (`FFFF`, the I/O processor),
and the exec address is the BASIC ROM's entry. Checked with a real `SAVE` on each machine Owlet offers:

| Machine                        | `PAGE` | Load       | Exec       |
| ------------------------------ | ------ | ---------- | ---------- |
| Model B with the GXR (default) | &1C00  | `FFFF1C00` | `FFFF8023` |
| Model B without the GXR        | &1900  | `FFFF1900` | `FFFF8023` |
| Master 128                     | &E00   | `FFFF0E00` | `FFFF802B` |

The Tape button's UEF file is headed with the same load and exec addresses (`tapeImage` in `src/tape-export.js` takes them
from `basicSaveAddresses` too), so that `*LOAD` and `*RUN` of the tape file place and enter the program as the disc's do.
The tape filing system displays them too: after `*TAPE` and `*OPT1,2`, `LOAD""` prints the file's name, block number, length,
load address and exec address as it read them from the header. The test checks that display on each machine. A real tape
`SAVE` has not been compared, as jsbeeb cannot record to tape.

`CHAIN` loads at the current `PAGE` whatever the file's addresses say, so `!BOOT` does not depend on them; `!BOOT` itself
is catalogued at &1900 for both. `!BOOT` is `*BASIC` then `CHAIN"PROGRAM"`, so it selects BASIC first and also works
when another language ROM is the current language.

## The `SCREEN` file

`SCREEN` is the screen as the emulator was showing it when the button was pressed. It is the size of the current mode's
screen memory and loads at the start of that memory in the I/O processor:

| Mode      | Size    | Load address |
| --------- | ------- | ------------ |
| 0, 1, 2   | `&5000` | `&3000`      |
| 3         | `&4000` | `&4000`      |
| 4, 5      | `&2800` | `&5800`      |
| 6         | `&2000` | `&6000`      |
| 7         | `&400`  | `&7C00`      |

The size comes from the video's wrap state (1K when the CRTC start address has MA13 set, which is how the video picks
teletext), not from the MOS mode number. The same applies on the Model B, the Master and the shadow modes (`MODE 128`
to `135`). Exec is 0.

The first byte is the one the video shows at the top left, followed by the screen in display order, wrapped at `&8000`
back to the start of the mode's screen memory as the video wraps it. A screen that has been hardware scrolled (the CRTC
start address in R12 and R13 moved) is therefore saved unscrolled, and `MODE 5:*LOAD SCREEN` shows it as it appeared,
likewise in any mode the disc was taken in.

## What is not in it

It is screen memory only: the mode, the CRTC start address and any colours changed with `VDU 19` are not saved. Only the
R12 and R13 values at the moment of export are used, so a program that changes the start address mid-frame or scrolls
part of the screen is not captured.

## Shadow modes on the Master

In a shadow mode (`MODE 128` to `135`) `SCREEN` is the shadow RAM the picture is in, whatever the program has paged in
for the CPU; on the Model B, and on the Master in any other mode, it is main RAM. `*LOAD` puts a file in main RAM, so to
see a shadow mode's picture again use the same mode without the shadow (`MODE 1` for `MODE 129`). That was checked on
jsbeeb's Master (MOS 3.20, DFS), not on a real one.
