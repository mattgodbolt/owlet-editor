# Where Owlet differs from the ROM on purpose

Owlet shows BBC BASIC in red where the ROM would stop with an error
([what red means](highlighting.md#what-red-means)), and never on code the ROM accepts, except for what is on this page:
a few things that are red on purpose because they are almost always a mistake, and one thing a Model B's ROM rejects
that Owlet accepts. The [README](../README.md#deliberate-deviations-from-the-rom) has the short version; how the tests
and the ROM oracle treat these is in [checking against the ROM](highlighting.md#checking-against-the-rom). Each entry
is one bullet that stands alone, with related cases as bullets under it.

## Deliberate deviations from the ROM

Text the ROM runs without error that is red because it is almost always a mistake. Each has a hover that says what
BASIC does, and shows as an error.

- **Anything but a comment after a complete assembler instruction** (`NOP PRINT`, `LDA #1 hello`, `NOP 5`,
  `LDA #1 ,X`, `LDA #1]`). BASIC ignores the rest of the statement up to the next `:`; the first token there that is
  not a `\` comment is red, as it is probably a comment missing its `\`. That includes `;`: BASIC II ignores it like
  any other junk, but later BASICs (such as the ARM assembler in BASIC V) take it as a comment, so its fix replaces the
  `;` with a `\`. The commonest case is a `]`, which does not close the block: BASIC ignores it and goes on
  assembling, so after `[LDA #1]` the next line `tax=1` is assembled as `TAX` and ignored junk, not run as an
  assignment (`[OPT0:NOP]:tax=1` assembles `EA AA`). A `]` after a colon does close it, as in `[LDA #1:]`
  (`[OPT0:NOP]:]:P%=P%+5` runs the assignment); the hover for a `]` says a `:` is probably missing before it. The
  fixes are "Insert : before ]" for a `]`, "Replace ; with \" for a `;` and "Insert \ before the junk" for the rest;
  Olly Betts suggested the marks and fixes on #174 and #327. The oracle cannot test these marks (cutting the statement
  there changes nothing), so it takes them on trust as ignored text and lists them as STRICTER.
  - **A keyword straight after a mnemonic** (`STAH.,X`, `LDAUSR@%+GET`). BASIC tokenises a keyword only at the start of
    a word, so `STAH.` is the word `STAH`: `STA`, then the variable `H` (an undefined one reads as `P%` unless `OPT` has
    bit 1 set, when it is "No such variable"), and `.,X` is ignored; with a space, `STA H.,X` is `STA HIMEM,X`. Where a
    space would leave nothing red, the junk is still red but the hover says so, and the fix is "Insert a space after
    STA" in place of the generic junk fix. A mnemonic that takes no operand (`NOPPAGE`) keeps the `\` fix. `STAPAGE`
    and `LDAGET` have no junk after the variable, so they are not red. Suggested by Olly Betts on #174.
- **A character in a mnemonic that is not a letter** (`LD89`, `ST89`, `CP8 5`, `SEC` spelt `3EC`). BASIC compares only
  the low five bits of each character, so it reads `8` as `X`, `9` as `Y`, `!` as `A` and so on: `LD89` is `LDX 9`, but
  is an easy typo for `LDA89`, `LDX89` or `LDY89`. The `LD` is red (in `LD89`, `ST!76`, `CP8 5`) rather than the
  character, since `LD` alone is not an instruction and the register letter was probably left out; the hover says what
  BASIC reads the character as and which letters were probably meant (both suggested by Olly Betts on #174). Where the
  character is not the third (`J-P`, `3EC`, `O2A`), no prefix is to blame, so just the character is red. Letters in
  either case stay valid, and so does `LDA89` (`LDA` and the number 89). A control character (below 32) is read by its
  low five bits too, so U+0101 (byte 1) is an `A`. A byte of 0x80 or above is not: the ROM rejects it in a mnemonic
  (`ST` and byte 0x81), except the tokens AND (0x80), EOR (0x82) and OR (0x84) as the first, second or third
  character, which it reads as that mnemonic, dropping what comes before (`ST` and byte 0x80 assembles `AND`). The
  dropped characters are red, with a hover that says so (recorded for #202).
- **`GCOL` with one argument** (`GCOL C`, `GC.1`). BASIC II and IV stop with `Missing ,` at the end of the statement
  (recorded on both ROMs); the hover says that BASIC V, which is not emulated here, accepts one argument, with
  `GCOL C` meaning `GCOL 0,C` (from #340). The fix, "Insert 0, before the argument", is offered only where the
  statement then has no error (so not for `GCOL 1 2`). `GCOL 1,2,3` is a different error and has no fix.
- **BASIC V statements** (`OFF`, `ON`, `MOVE BY`, `DRAW BY`, `POINT`, `POINT BY`, `ORIGIN`, `LINE`, `CIRCLE`,
  `CIRCLE FILL`). BASIC II and IV stop at each with the error it has always had (`Syntax error`, `No such variable`,
  `Missing ,` or `Mistake`; recorded on both ROMs). The hover says that BASIC V accepts it (BASIC V is not emulated here)
  and the quick fix replaces the statement with the one that does the same, as listed in #348: `OFF` and `ON` become
  `VDU 23,1,0;0;0;0;` and `VDU 23,1,1;0;0;0;`, `MOVE BY X,Y` becomes `PLOT0,X,Y`, `ORIGIN X,Y` becomes `VDU29,X;Y;`,
  `LINE X,Y,X2,Y2` becomes `MOVE X,Y:DRAW X2,Y2`, and so on (the table is in `src/parser/basic-v.js`). The fix is
  offered only where the arguments split at commas outside brackets into the right number, and the line with the
  replacement has no error. `CIRCLE` and `CIRCLE FILL` use the circle codes of PLOT (`&91` and `&99`), which the Master
  has and a Model B has with the GXR ROM fitted (checked by drawing on both, as on the Master), so they have a fix on
  BASIC IV and on a Model B with the GXR (the machine menu's default), and none on a Model B without it, where nothing
  is drawn. `ModelBDialect` is the Model B with the GXR and `ModelBNoGxrDialect` is without it; `dialectFor` picks one.
  - `BY` is the BASIC V word only where the ROM stops. In BASIC II and IV it is a variable, so `MOVE BY -1,2`,
    `MOVE BY+1,2`, `MOVE BY!1,2`, `MOVE BY?1,2`, `MOVE BY(1),2` (an array element) and the same with `*`, `/`, `^`, `<`,
    `>`, `=`, `AND`, `OR`, `EOR`, `DIV` or `MOD` run on both ROMs, as does `DRAW BY`; they have no error and so no fix (but see the warning for `-` below).
    A space before `!`, `?`, `$` or `(`, or a number or name after a space, makes the ROM stop with `Missing ,`, and
    the fix is offered. `BY1` and `BY$` are other variables. `POINT` is no statement of either ROM (`Mistake`), so
    `POINT BY -1,2`, `POINT BY+1,2` and `POINT -1,2` have the fix whatever follows `BY`. Each is a recorded row in
    `basic-v-fixes-348`.
  - `MOVE BY-40,40` and `DRAW BY-40,40` (a `-` right after `BY`, with or without a space) are ROM-valid but stop at run
    time with `No such variable` on both ROMs unless the program sets `BY`, which most programs do not, and a relative
    move is very often negative (suggested by Olly Betts on #354). So, as an extension, they get a warning (never an
    error, and not counted against the ROM) with the same fix, "Replace MOVE BY-40,40 with PLOT0,-40,40", but only when
    nothing in the whole program may give the numeric variable `BY` a value: a `BY=` (or `BY+=` and the like) anywhere,
    whatever comes before it (a statement can start after a line number, `:`, `THEN`, `ELSE`, `REPEAT`, `ON ERROR`, an
    `IF` condition with no `THEN`, as in `IF1BY=1`, and an `ON ... GOTO ... ELSE`, each checked in the ROM, so the scan
    does not look at what precedes), which also means a comparison such as `IF BY=1 THEN` or `PRINT BY=1` counts as
    setting it; `LET BY=`, or `LOCAL`, `FOR`, `INPUT`, `READ`, `DIM`, a `DEF` parameter, `RETURN` or `SYS` naming `BY`; and
    an assembler label `.BY`. (`[LDA#BY=1]` sets nothing, but is a `BY=` too, so it counts.)
    Where it cannot tell it does not warn, since a missed warning costs less than a false one. The other operators
    (`BY+1`, `BY!1`, `BY AND 1` and so on) get none, and neither does `BY(1)`. An array `BY(`, `BY%`, `BY$` and `BYE`
    are other variables, so they do not count as setting `BY`. The program is searched once, and only when it has such
    a move.
  - `ELLIPSE`, `FILL` and `RECTANGLE` have none, as they cannot be written without repeating
  an argument or leaving the graphics cursor elsewhere.
- **An `ELSE` that no `IF` is waiting for** (`X%=6ELSE7`, `PRINT 1 ELSE PRINT 2`, and the second `ELSE` of
  `IF0ELSEPRINT"X"ELSEPRINT"Y"`). BASIC skips the rest of the line at any `ELSE` it runs into: right at the end of the
  `THEN` part of an `IF` (or after an `ON` list), a quirk anywhere else. The `ELSE` is red; the text after it is not,
  since BASIC does not read it. BASIC does not nest `IF`: it scans forward for the first `ELSE`, so an `IF` or `ON`
  waits for one `ELSE` and the first it meets is its own. `IF A THEN IF B THEN x ELSE y ELSE z` has its second `ELSE`
  marked, as `IF0ELSEELSEPRINT"x"` does, but an `IF` or `ON` after an `ELSE` waits for another, so
  `IF A THEN x ELSE IF B THEN y ELSE z` is not marked. Suggested by Olly Betts on #319.
- **Text after a target in an `ON ... GOTO`, `GOSUB` or (BASIC IV) `PROC` list** (`ON X GOTO 20E1,30`,
  `ON X GOTO 10,A+1JUNK`, `ON X PROCa JUNK`). BASIC counts commas to find the target it wants, evaluates it and jumps,
  so the text after a target, up to the next comma, the `ELSE` or the end of the statement, is never read and is not an
  error. Its first token is red, with a hover that says what BASIC does. A number straight after `GOTO` or `GOSUB`, or
  after a comma while every target so far has been a bare line number, is a line number token and ends the target:
  `20E1` is line 20, not 200, and `5+5` is line 5, not 10. A target after an expression or after ignored text is read
  as an expression (`20E1,20,+.2E2JUNK` has two line numbers and two expressions), so BASIC's RENUMBER does not touch
  it. A keyword that runs into an exponent number (`ERL+2E1ELSE30`) is part of a name there, so the `ELSE` is not read
  and is red as the first ignored token; where a space before it leaves nothing ignored (an `ON` or `IF` is waiting for
  the `ELSE`), the fix is "Insert a space before ELSE". In a `PROC` list, a target after the first that does not start
  with `PROC`, or does not parse, is left alone, as BASIC reads it only if it is the one it counts to. BASIC II counts
  commas in the raw text, so a comma inside a string splits a target there (`ON 3 GOTO 10,"x,y",30` reads `y"` as the
  third), and nothing after it is marked; BASIC IV reads a string as one item. Suggested by Olly Betts on #335; its
  recorded rows include ones that must stay unmarked (`ON 5 GOTO 10ELSE30`, where the `ELSE` is read). As with the
  assembler's, the oracle takes these marks on trust as ignored text and lists them as STRICTER.
- **A string where BASIC wants a number, or the other way round** (`PRINT"X"DIV 2`, `X=1+"A"`, `X$="A"+1`, `X=LEN 5`,
  `PRINT STR$A$`, `X=EVAL 1`, `P.SPCA$`, `X=EOF#STR$1`, `P.?A$`, `P.$A$`, `P.-A$`). BASIC raises "Type mismatch" when it
  runs such a statement, not when it reads it, so a program that never gets there is fine. A binary operator
  (`- * / ^ MOD DIV AND OR EOR`) with a string on either side, and `+` or a comparison between a string and a number,
  is red at the operator. What is given to a function or a prefix operator is red at its own first token (the
  argument, not the function: `ABS` is fine in `X=ABS STR$1`, and `STR$` is red), as soon as that token is known to be
  the wrong type, so a word being typed is red whatever follows it, and completions do not offer `STR$` or `STRING$(`
  after `X=ABS S`, or `INT` and `INKEY` after `X=ASC I`. The functions `ASC`, `EVAL`, `LEN`, `VAL`, `OPENIN`, `OPENOUT`
  and `OPENUP` take a string; the other functions, `STR$`, `CHR$`, `SPC`, the channel of `BGET#`, `EOF#`, `EXT#` and
  `PTR#`, the operand of `?`, `!` and `$` (and the right of a binary `?` or `!`) and a unary `-` take a number. A value
  is a string if it is a string constant, a name or function ending in `$`, `$X`, `TIME$` (BASIC IV, where `TIME` and
  the `$` after it are one word) or a bracket round one; a number if it is a number, any other name or function
  (`TIME` included), what `?` and `!` give, or an operator's result. Anything else, such as the result of a `FN` or of
  `EVAL`, is not known and is never marked; nor are the arguments of a `FN`, `LEFT$(`, `MID$(`, `INSTR(`, `STRING$(`
  and `TAB(`, assignments, or a condition that is itself the wrong type (`IF "A" THEN`). A unary `+` passes a string
  through (`P.+A$` runs), so it is not marked. The oracle cannot test these marks: a statement that stops with Type
  mismatch is inconclusive, and in one that does not run (`IF 0 THEN`) the mark is in text BASIC never reads. The other
  half is the rows recorded for #331 and in `type-follow-ups`: what BASIC runs without complaint (`PRINT"X"D`,
  `X$="A"+"B"`, `X=ASC GET$`, `P.A$?1`, `P.+A$`, `P.SPC1`), which must stay unmarked. Suggested by Olly Betts on #323,
  #331 and #334. Because completions drop a word that makes the statement red, `PRINT"X"D` no longer offers `DIV`,
  `AND`, `OR`, `EOR` or `MOD`. While a line is typed, `LEN(B` is red until the `$` is typed.
  - **Not a deviation, because BASIC stops on the line anyway**: a string constant after a sign (`PRINT -"A"`,
    `PRINT +"A"`, "No such variable") and `?` or `!` after a string variable (`X=A$?1`, `X=ASC A$?1`, "Syntax error";
    `A$?1=2` is a Mistake). These are red as errors, on the string after the sign and on the `?` after the variable,
    not marked as stricter. (`PRINT A$?1` runs: a string variable does not take a `?` or `!`, so it is two items, `A$`
    then `?1`.)

## The other way: lenient on purpose

One deviation goes the other way, accepting what a Model B's ROM rejects (so it is neither red nor marked). Olly Betts
suggested it on #245: a program written for (or on) the Master with the US spelling `COLOR` should still work on a
Model B.

- **`COLOR` is `COLOUR` on a Model B where that is all it can be.** BASIC II has no `COLOR` (`COLOR 7` is the variable
  `COLOR` and then a Mistake), and BASIC IV makes it the `COLOUR` token (`&FB`) wherever it is. On a Model B, Owlet
  reads a `COLOR` as `COLOUR` only when it starts a statement (at the start of the line, or after a colon, `THEN`,
  `ELSE`, `REPEAT` or `ON ERROR`), what follows is one expression and then the end of the statement (the end of the
  line, a colon or `ELSE`), and the statement is not already valid as written. Anywhere else it is part of a name.
  - Taken: `COLOR7`, `COLOR X`, `COLOR(1)`, `IFC%COLORC%ELSECOLORD%:NEXT`, `X=1:REP.COLORX:P.;X:X=X+1:U.X>7`,
    `ONERRORCOLOR7:GOTO1000`, and in `LETCOLOR=3:COLORCOLOR` only the second `COLOR`, which is a variable as the
    operand.
  - Not taken: `COLORS=7`, `COLOR=7`, `COLOR(1)=7` and `COLOR?1=7` (assignments, valid as written), `LETCOLOR=3`,
    `PRINT COLOR`, `X=COLOR` (not the start of a statement), `COLOR 1,2` and `COLOR 7 7` (not one expression, which
    BASIC II rejects as ever), `color 7` (keywords are upper case, on the Master too), and anything in a string, `REM`,
    `DATA` or `*` command, or on a line of an assembler block that an earlier line opened (the ROM tokenises each line
    on its own, and in a block `COLOR` is assembled text, so the tokeniser carries the block from line to line as the
    highlighter does). A `COLOR` alone at the end of the line is a variable still being typed and is not red. `COLORS`
    alone is read as `COLOUR S`, since that is a whole statement, and goes back to a variable at `COLORS=`.
  - The same reading makes the Model B's tokeniser write `&FB` for it, so the program that runs is the one shown. The
    Master is unchanged: there `COLOR` is a keyword everywhere, as its ROM has it.
  - The recorded rows for BASIC II are still the ROM's answer, and are checked against `BasicIIDialect`; the editor's
    Model B is `ModelBDialect`, BASIC II plus this, and the rows it is lenient on are `LenientThanRom` in
    `test/rom-tables.js`, which must have no mark. The oracle lists them apart as LENIENT, not as false-valids,
    wherever a `COLOR` was read as `COLOUR`.
