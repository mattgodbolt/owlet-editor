# Highlighting and the ROM

How Owlet decides what is red, in full: the rules, characters above U+007F, where the Master's BASIC IV differs from
BASIC II, and how the highlighter is checked against the real ROM. The
[README](../README.md#highlighting-what-red-means) has the short version; what is red (or not) on purpose although the
ROM disagrees is in [deliberate deviations from the ROM](rom-deviations.md).

## What red means

Red means that BBC BASIC II (BASIC IV on a Master 128, [below](#basic-iv-the-master)) would stop with an error at that
statement if it ran it, and that no more typing at the end of the line could change that. The colours depend on the
text alone, apart from the statement being typed (below).

- **Red runs to the end of the statement**: BASIC stops at the first token that cannot continue a statement and never
  reads the rest, so that token and the rest of the statement are red. `I am a badger` is `I` as a variable and
  `am a badger` red; `GOTO 20 30:PRINT 5` is red on `30` only, since the statement ends at the colon and `PRINT 5` is
  judged on its own. A statement ends at a colon or an `ELSE` outside a string, at the end of the line, and in an
  assembler block at the `]` that closes it. A `REM` or `DATA` after the stop point, its comment or items, and a `*`
  command are not code and keep their own colours. Red text never takes part in bracket matching.

- **Never red on code the ROM accepts.** The number of false-invalids (the ROM runs a statement, the editor shows it
  red) must be 0 on the recorded tables, the ROM oracle and the saved programs.
- **Text that is not code is never red:** a comment after `REM`, the items after `DATA`, a `*` command, and the rest
  of a line after an `ELSE` that starts a statement or a `DEF` that is not `DEF FN` or `DEF PROC`, and an `ON ... GOTO`
  list after its first target, all of which BASIC skips.
- **Unfinished is not red**: a line that BASIC rejects only because something is still to be typed at its end keeps
  its ordinary colours, so a line can be typed a key at a time. `G`, `GOTO`, `GOTO `, `FOR I=1 TO`, `PRINT (1+`,
  `PRINT "HI` (no closing quote yet) and `[LDA` are unfinished, as is a name or keyword that could grow into a longer
  keyword (`FOR I=1 T`, `X=1 AN`, `ENDP`, `MOD` for `MODE`, `A=TO` for `TOP`) or a mnemonic (`[LD`). So is a statement
  that stops at a `)` where something typed just before it (an operand, argument or trailing `,`) would make it valid,
  which is what an editor that closes brackets shows while a call is typed: `A$=LEFT$()`, `A$=LEFT$(B)`,
  `A$=LEFT$(B$,)`, `PRINT (1+)`, `PRINT TAB(1,)` and `DIM a()`. Monaco closes only `(` and `"`, and an open `"` is
  unfinished already. The recogniser tries a short list of fillers (a value, `,1`, `1,1`...) at the `)` and asks
  whether the statement is then valid. `A$=LEFT$(X$)` is unfinished too, though one argument short, because the editor
  shows it at `LEFT$(X$|)` and the two cannot be told apart. This does not depend on the cursor, so a line left like
  that in a finished program gets a marker instead (below). Everything else that stops short is red: no typing at the
  end mends it, and the ROM rejects it as written. `GOTO:PRINT`, `FOR I=1 TO:NEXT`, `IF PRINT 2` and `X=1+:PRINT X` are
  red, and so are `GOTO 20 30`, `PRINT )`, `A=1'`, `X=1+*` and `PRINT (1+2))`. Text typed in front of existing text
  other than a `:` (next) gets no allowance, so it is red until its statement is finished (`IF A=1 THEN ` in front of
  `PRINT 2`). Words typed against the next word with no space (`IF A=1 TPRINT 2`, which is a name, `TPRINT`, and a
  number) are red until the space is typed.
- **The statement being typed**: after an edit, the line the cursor is on is read as if it ended at the cursor, where
  nothing but closing brackets comes between the cursor and a `:` or the end of the line, until the cursor leaves the
  line (moving along it keeps that reading). So a statement typed in front of a `:` is not red while it is unfinished
  (`FOR I=1 TO 10` in front of `:PRINT I:NEXT`, from `F` to `FOR I=1 TO `), nor is one typed before a `)` the editor
  closed for you (`IF (X A`, where `A` could become `AND`, though `IF (X A)` is red). Once the cursor leaves the line
  it is read as written, and red if it is still wrong. Suggested by Olly Betts on #200.
- **Markers**: about half a second after the last edit (until then the old markers stay, moving with the text), a
  statement BASIC would stop at gets an error squiggle on its red text, and an unfinished line gets a warning squiggle:
  at its end, or at the token where the statement stopped when something is missing from the middle. Both come from the
  recogniser that colours the text. The message is the ROM's own error text (`Mistake`, `Syntax error`, `No TO`,
  `Missing ,`, `Missing "` and so on) where the recogniser knows it; the recorded rows in `test/rom/verdicts` are
  checked against it, and where the ROM's wording depends on context (a call's arguments) there is no text rather than
  a guess. Markers depend on the cursor more than the colours do: the line the cursor is on is not marked as
  unfinished (it would blink with every key) until the cursor leaves it, and the statement being typed is read as the
  colours read it. An assembler block that is never closed is one error on
  its `[`, not one per later line (the later lines are coloured as before). A syntax marker is left out where a warning
  already covers the same text (`x == 3` has the warning about `==`). Quick fixes are offered only for warnings, never
  for a syntax marker, apart from an index register that BASIC II reads only in capitals (`LDA 42,x`, `STA (42),y`):
  "Replace x with X", offered only where the statement in capitals has no error and does not end too soon (not for
  `ASL 42,y`, as `ASL` takes only `X`, nor for `LDA (42,x`, which is still missing its `)`). The same goes for `ORa` on
  BASIC II, which reads the `A` of `ORA` only in capitals: "Replace ORa with ORA", on the same condition. An
  instruction that only BASIC IV's assembler has (`BRA`, `CLR`, `DEA`, `INA`, `PHX`, `PHY`, `PLX`, `PLY`, `STZ`, `TRB`
  and `TSB`, found by trying every three-letter word on both ROMs) is said to be a BASIC IV instruction when BASIC II
  stops at it, naming just the mnemonic. Suggested by Olly Betts on #291 and #311.
- **Line number markers**: after the same delay, an error squiggle on a `GOTO`, `GOSUB`, `THEN`,
  `ELSE` (and so `ON ... GOTO` lists) or `RESTORE` that names a line the program does not have (BASIC's `No such line`),
  and on any line number above 32767, which BASIC cannot have: the program ends at the first such line, so BASIC never
  runs it. That includes a line without a number that the editor would number above 32767, in a program of over
  3276 lines. A `GOTO`, `GOSUB`, `RESTORE` or `TRACE` number of 65536 or more is marked too: the ROM keeps only its
  bottom 16 bits (`TRACE 65536` is `TRACE 0`) and says `Too big` from 2147483648. `THEN` and `ELSE` say `Syntax error`
  above 32767. `LIST`, `DELETE`, `AUTO` and `RENUMBER` are not marked, and a `TRACE` is not marked as missing, as
  their numbers need not be lines. A reference on the line the cursor is on is not marked as missing until the cursor
  leaves it.
- **Line numbers follow the edits of a program without them**: the editor numbers such a program 10, 20, 30... and
  rewrites each `GOTO`, `GOSUB`, `THEN`, `ELSE` and `RESTORE` as lines are added and removed. A `TRACE` limit that is
  not a line keeps its place between the same two lines (the number just above the one below it). A reference to a
  line that does not exist is otherwise left as it is, so placeholders such as `GOTO 11` do not collapse together.
- **Code is red if it would stop BASIC when run, even where it cannot run** (on purpose):
  - the branch of an `IF` whose condition is false, which BASIC skips;
  - the body of a `DEF FN` or `DEF PROC`, which BASIC skips on its way through the program and runs only when called;
  - statements after `GOTO`, `END`, `ENDPROC`, `RETURN`, `STOP` or a function's `=` on the same line, which can
    never run. Acorn's Welcome disc has one: in `IF CHAR=2 THEN=45:FORCE -` (line 7310 of `W.KEYBD`), `FORCE -` is
    red.

## Characters above U+007F

BASIC keeps only the low eight bits of each character the bot or the emulator's tokeniser gives it, so a character is
the byte it ends in: U+00A2 and U+01A2 are both `&A2`, U+0141 is `A` and U+0122 is a quote. The highlighter reads each
line that way (`byteView` in `src/parser/lexer.js`), so programs that spell a token byte differently still highlight
as they run. Offsets do not change, since the view is the same length, and a control byte (U+0100 to U+011F) is left
alone because U+010A is data and not a line break. Shrink writes each token byte as one visible character: the byte
itself, or the one 0x100 above it for the control bytes, `&7F` to `&9F`, and `&A0` and `&AD`, which would otherwise be
a non-breaking space and a soft hyphen.

## BASIC IV (the Master)

With the Master chosen, the parser follows BASIC IV. `src/parser/dialect.js` holds the setting, which the lexer,
recogniser and assembler read as each line is made; highlighting, markers, warnings and completions all follow it, and
changing machine colours the text again. Each difference below was checked on the Master's ROM in jsbeeb; the rows are
in `test/rom/verdicts-master` and `test/rom/tokens-master`, and the tests check each row against its own machine's
rules.

- **Keywords:** `COLOR` is `COLOUR` (the same token) and `EDIT` is a command (token `&CE`, which BASIC II does not
  have), but only at the prompt: wherever a program starts a statement with it (`EDITED=FALSE` reads as `EDIT` then
  `ED=FALSE`, and `ED.` and `EDIT 10` are the same), BASIC stops with `Syntax error`, so that is red; in an expression
  (`PRINT EDIT`) it is a missing variable, as for any keyword. Otherwise the tokeniser is BASIC II's (checked by
  `lexfuzz.mjs --master`), apart from dropping the spaces at the end of a line as it stores it.
- **`VDU`:** a `|` ends an item as `,` and `;` do, and sends nine zeros, so `VDU 23,255,255|` is valid. A `|` straight
  after `VDU`, `,`, `;` or another `|` is still an error, as is a `,` or `;` after one, and a `|` anywhere else.
- **`EXT#`** is a statement (`EXT#X=0`), read as `PTR#` is; `EXT` without the `#` says `Missing #`.
- **`TIME$`**, with the `$` straight after `TIME`, is a string value and can be assigned to (`TIME$="..."`).
- **`ON ... PROC`:** the list can name procedures as well as lines.
- **Assembler:** the 65C12's `BRA`, `PHX`, `PHY`, `PLX`, `PLY`, `INA`, `DEA`, `STZ` (zero page or absolute, with `,X`),
  `TRB` and `TSB` (no index); `BIT` takes `#` and `,X`; `INC A` and `DEC A`; `(&70)` as a zero page address for
  `ADC AND CMP EOR LDA ORA SBC STA` (BASIC ignores what follows the `)` unless it is a comma, which must be `Y`), and
  `JMP (&1234,X)`. The index register, the `a` of an accumulator operand, the `a` of `ORa` and the size of an `EQU`
  are read in either case. `ST:` reads as `STZ`, as the third character of a mnemonic is compared in its low five bits
  (the aliasing rule in [deliberate deviations](rom-deviations.md#deliberate-deviations-from-the-rom)), so it needs an
  operand. `RMB`, `SMB`, `BBR`, `BBS`, `WAI` and `STP` are not there.
- **Errors:** `Bad Hex` for BASIC IV's `Bad HEX`. `ERROR 5,"x"` is a syntax error, as on BASIC II.

Not covered: `LIST IF`, and BASIC IV's own message wording beyond `Bad Hex`.
`node tools/rom-oracle/oracle.mjs --master` runs the oracle on the Master with extra statements for BASIC IV
(`generate-iv.mjs`); `record.mjs --master` and `lexfuzz.mjs --master` do the same for the tables and the tokeniser.

## How the highlighter works

The highlighter is the tokenizer in `src/parser`: a port of the ROM's tokeniser, a recogniser that marks the token at
which BASIC would stop with an error and the rest of that statement, and the assembler. Bracket colouring and matching
work as for any Monaco language (an unclosed `(` is not red while its line is unfinished).

## Checking against the ROM

Expected values come from the ROM, not from beliefs about it. `node tools/rom-oracle/record.mjs 'X=Y.5'` runs a
statement on BBC BASIC II and records its verdict (the error's name or `ok`) in `test/rom/verdicts`, and
`--tokens` records the ROM's tokenisation of a line in `test/rom/tokens`; nobody types a verdict. A byte of 0x80
or above cannot go through the shell, so `--hex '53 54 8d 20 39'` takes the statement as hex bytes (also for each
`--file` line); the row's text is those bytes as Owlet shows them, U+0100 plus the byte below 0xA0.
`--source` ends each row with where it came from, so a report seen before is one search of the tables away, and keeps
the row in the table's file of that name: each table is a directory with a file per source (rows without one go in
`unsourced.json`), so pull requests that record rows do not conflict. Name the topic in lowercase words joined by
hyphens: `--source else-without-if-319` records into the table's `else-without-if-319.json`. Existing files are named
`<topic>-<issue>.json`, after the issue or pull request the topic began with, and their rows end with `#319`:
`--source '#319'` finds that topic's file in whichever table it is, or makes `319.json` if there is none. A topic's
files in the four tables share a name. Always give `--source`, and do not edit the files by hand; a test fails if a row
is in the wrong file.
Before a change to highlighting, `node tools/rom-oracle/oracle.mjs` compares the highlighter with the ROM on
generated statements (see the comment at its top).

The oracle and the tests hold the highlighter to these rules:

- **False-valids are measured, not gated.** Where the ROM rejects a statement and nothing is red, the oracle reports
  it, but it never fails a change.
- **The oracle reads only the stop token as evidence.** The red after it is text BASIC never read, so the oracle
  asks the ROM about each red run in turn and drops the ones it never reads, as it does for any text BASIC skips; a
  statement's verdict is as before.
- **Unfinished is a third answer in the oracle.** A statement the ROM rejects and the recogniser calls unfinished is
  neither a false-valid nor a false-invalid; the oracle counts it as agreement and lists it apart, and also lists
  any such statement that the ROM accepts (there must be none), outside the text BASIC skips. Where a statement is
  unfinished at a `)`, some insertion there should make the ROM accept it; the oracle does not check that, so check
  it with the ROM by hand when the fillers in `src/parser/recogniser.js` change.
- **Stricter than the ROM only on purpose.** The exceptions are
  [the deliberate deviations](rom-deviations.md#deliberate-deviations-from-the-rom); each is a row of the recorded
  tables listed as stricter than the ROM in its test, and the oracle reports them as STRICTER, apart from the
  false-invalids. The one place Owlet is more lenient is `COLOR` on a Model B
  ([lenient on purpose](rom-deviations.md#the-other-way-lenient-on-purpose)), which the oracle reports as LENIENT.

The tools are in `tools/rom-oracle`; `oracle.mjs` and `lexfuzz.mjs` are not run by `npm test`:

- `oracle.mjs`: the differential test of the highlighter against BBC BASIC II (or, with `--master`, BASIC IV), with
  its options in the comment at its top. It caches the ROM's verdicts in `.cache/rom-oracle/`, so a rerun after a
  change to `src/parser` only runs the highlighter.
- `record.mjs`: records rows in the tables under `test/rom`, as above.
- `lexfuzz.mjs`: compares `src/parser/lexer.js` with BBC BASIC II's own tokeniser on random lines, and prints the
  lines where the bytes differ.
- `generate.mjs` and `generate-iv.mjs`: the statements the oracle runs, the second adding the places where BASIC IV
  differs.
- `unread.mjs`: the parts of a statement that BASIC never reads when it runs it, found from BASIC II's own
  tokenisation of it, so that the oracle does not take a statement that runs without error as vouching for them.
- `rom.mjs`: runs statements in immediate mode on BASIC II in jsbeeb's headless BBC B (or BASIC IV in its Master).
- `tables.mjs`: the tables of recorded rows, a directory each under `test/rom` with one file per source.

See also [developing Owlet](development.md) for running the tests.
