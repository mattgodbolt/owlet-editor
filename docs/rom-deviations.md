# Where Owlet differs from the ROM on purpose

Owlet shows BBC BASIC in red where the ROM would stop with an error
([what red means](highlighting.md#what-red-means)), and code the ROM accepts is never red, with the exceptions on this
page: a few things that are red on purpose because they are almost always a mistake, and one thing a Model B's ROM
rejects that Owlet accepts. This is the full list, for anyone who wants to know exactly why a line is red and for
contributors adding to it; the [README](../README.md#deliberate-deviations-from-the-rom) has the short version. Each
stricter mark is a row of the recorded tables listed as stricter than the ROM in its test, and the ROM oracle reports
it as STRICTER, not as a false-invalid; the lenient one it reports as LENIENT
([checking against the ROM](highlighting.md#checking-against-the-rom)). Each entry is one bullet that stands alone,
with related cases as bullets under it.

## Deliberate deviations from the ROM

Text the ROM runs without error that is red on purpose, because it is almost always a mistake. Each has a hover
message that says what BASIC does, and shows as an error.

- **Anything but a comment after a complete assembler instruction** (`NOP PRINT`, `LDA #1 hello`, `NOP 5`,
  `LDA #1 ,X`, `LDA #1]`). BASIC ignores the rest of the statement up to the next `:`; the first thing there that is
  not a `\` comment is red (just that token), probably a comment missing its `\`. That includes `;`, which BASIC II
  ignores like any other junk (later BASICs, such as the ARM assembler in BASIC V, take it as a comment, so its fix
  replaces the `;` with a `\`). A `]` there is the commonest case. It does not close the block: BASIC ignores it like the rest and goes on assembling, so after
  `[LDA #1]` the next line `tax=1` is assembled as `TAX` followed by ignored junk, not run as an assignment
  (`[OPT0:NOP]:tax=1` assembles `EA AA`). A `]` after the colon closes it (`[OPT0:NOP]:]:P%=P%+5` runs the
  assignment), as `[LDA #1:]` does. The hover for a `]` says that a `:` is probably missing before it. Flagging the junk
  and the quick fixes, "Insert : before ]" for a `]`, "Replace ; with \" for a `;` and "Insert \ before the junk" for
  the rest, were suggested by Olly Betts on #174 and #327. The oracle takes these marks on trust as ignored text
  (cutting the statement there changes nothing, so it cannot test them) and lists them as STRICTER.
  - **A keyword straight after a mnemonic** (`STAH.,X`, `LDAUSR@%+GET`). BASIC tokenises a keyword only at the start of
    a word, so `STAH.` is the word `STAH`: `STA`, then the variable `H` (an undefined one reads as `P%` unless `OPT` has
    bit 1 set, when it is "No such variable"), and `.,X` is ignored; the same text with a space, `STA H.,X`, is
    `STA HIMEM,X`. Where a space would leave nothing red, the junk is red as before but the hover says that, and the
    fix is "Insert a space after STA" instead of the generic junk fix. A mnemonic that takes no operand
    (`NOPPAGE`) keeps the `\` fix. `STAPAGE` and `LDAGET` have no junk after the variable, so they are not red.
    Suggested by Olly Betts on #174.
- **A character in a mnemonic that is not a letter** (`LD89`, `ST89`, `CP8 5`, `SEC` spelt `3EC`). BASIC compares only
  the low five bits of each character, so it reads `8` as `X`, `9` as `Y`, `!` as `A` and so on: `LD89` is `LDX 9`, but
  is an easy typo for `LDA89`, `LDX89` or `LDY89`. Olly Betts suggested on #174 marking this, and marking the `LD` (in
  `LD89`, `ST!76`, `CP8 5`) rather than the character, since `LD` on its own is not an instruction and the register
  letter was probably left out; the hover says what BASIC reads the character as and which letters were probably
  meant. Where the character is not the third (`J-P`, `3EC`, `O2A`), no prefix is to blame, so just that character
  is red. Upper and lower case letters stay valid, and so does `LDA89` (`LDA` and the number 89). A control character
  (below 32) is read by its low five bits too, so U+0101 (byte 1) is an `A`. A byte of 0x80 or above is not: the ROM
  rejects it in a mnemonic (`ST` and byte 0x81), except the tokens AND (0x80), EOR (0x82) and OR (0x84) as the first,
  second or third character, which it reads as the mnemonic itself, dropping what comes before (`ST` and byte 0x80
  assembles `AND`). The dropped characters are red, with a hover that says so (recorded for #202).
- **`GCOL` with one argument** (`GCOL C`, `GC.1`). BASIC II and IV stop with `Missing ,` at the end of the statement
  (recorded on both ROMs); the hover says that BASIC V accepts one argument, with `GCOL C` meaning `GCOL 0,C` (from
  #340; BASIC V is not emulated here), and the quick fix is "Insert 0, before the argument", offered only where the
  statement then has no error (so not for `GCOL 1 2`). `GCOL 1,2,3` is a different error and has no fix.
- **An `ELSE` that no `IF` is waiting for** (`X%=6ELSE7`, `PRINT 1 ELSE PRINT 2`, and the second `ELSE` of
  `IF0ELSEPRINT"X"ELSEPRINT"Y"`). BASIC skips the rest of the line at any `ELSE` it runs into, which is right at the end
  of the `THEN` part of an `IF` (or after an `ON` list) and a quirk anywhere else. The `ELSE` is red and the text after
  it is not, since BASIC does not read it. BASIC does not nest `IF`: it scans forward for the first `ELSE`, so an `IF`
  or `ON` waits for one `ELSE` and the first it meets is its own. `IF A THEN IF B THEN x ELSE y ELSE z` has its second
  `ELSE` marked, as `IF0ELSEELSEPRINT"x"` does, but an `IF` or `ON` after an `ELSE` waits for another, so
  `IF A THEN x ELSE IF B THEN y ELSE z` is not marked. Suggested by Olly Betts on #319.
- **Text after a target in an `ON ... GOTO`, `GOSUB` or (BASIC IV) `PROC` list** (`ON X GOTO 20E1,30`, `ON X GOTO
  10,A+1JUNK`, `ON X PROCa JUNK`). BASIC counts commas to find the target it wants, evaluates it and jumps, so what
  follows a target up to the next comma, or to the `ELSE` or the end of the statement, is never read and is not an
  error. The first token of it is red, with a hover that says what BASIC does. A number straight after `GOTO` or
  `GOSUB`, and after a comma while every target so far has been a bare line number, is a line number token and ends
  the target there: `20E1` is line 20, not 200, and `5+5` is line 5, not 10. A target after an expression or after
  text that is ignored is read as an expression (`20E1,20,+.2E2JUNK` has two line numbers and two expressions), so
  BASIC's RENUMBER does not touch it. A keyword that runs into an exponent number (`ERL+2E1ELSE30`) is part of a name
  there, so the `ELSE` is not read and is red as the first of the ignored text, and where a space before it leaves
  nothing ignored (an `ON` or `IF` is waiting for the `ELSE`) the fix is "Insert a space before ELSE". A target after
  the first on `PROC` that does not start with `PROC`, or that does not parse, is left alone, as BASIC reads it only
  if it is the one it counts to. BASIC II counts commas in the raw text, so one inside a string splits a target there
  (`ON 3 GOTO 10,"x,y",30` reads `y"` as the third), and nothing after it is marked; BASIC IV reads a string as one item.
  Suggested by Olly Betts on #335; the rows recorded for it include the ones that must
  stay unmarked (`ON 5 GOTO 10ELSE30`, where the `ELSE` is read). The oracle takes the marks on trust as ignored text,
  as it does the assembler's, and lists them as STRICTER.
- **A string where BASIC wants a number, or the other way round** (`PRINT"X"DIV 2`, `X=1+"A"`, `X$="A"+1`, `X=LEN 5`,
  `PRINT STR$A$`, `X=EVAL 1`, `P.SPCA$`, `X=EOF#STR$1`, `P.?A$`, `P.$A$`, `P.-A$`). BASIC raises "Type mismatch" when it
  runs such a statement, not when it reads it, so a program that never gets there is fine. A binary operator
  (`- * / ^ MOD DIV AND OR EOR`) with a string on either side, and `+` or a comparison between a string and a number,
  are red at the operator. What is given to a function or a prefix operator is red at its own first token (the
  argument, not the function: `ABS` is fine in `X=ABS STR$1`, and `STR$` is red), as soon as that token is known to be
  the wrong type, so a word being typed is red whatever follows it, and completions do not offer `STR$` or `STRING$(`
  after `X=ABS S`, or `INT` and `INKEY` after `X=ASC I`. The functions `ASC`, `EVAL`, `LEN`, `VAL`, `OPENIN`, `OPENOUT`
  and `OPENUP` take a string; the other functions, `STR$`, `CHR$`, `SPC`, the channel of `BGET#`, `EOF#`, `EXT#` and
  `PTR#`, the operand of `?`, `!` and `$` (and the right of a binary `?` or `!`) and a unary `-` take a number. A value
  is a string if it is a string, a name ending in `$`, a function ending in `$`, `$X`, `TIME$` (BASIC IV, where `TIME`
  and the `$` after it are one word) or a bracket round one; a number if it is a number, any other name, any other
  function (`TIME` included), what `?` and `!` give, or an operator's result. Anything else, such as a `FN`'s result
  or the result of `EVAL`, is not known and is never marked, nor are the arguments of a `FN`, `LEFT$(`, `MID$(`,
  `INSTR(`, `STRING$(` and `TAB(`, assignments, or a condition that is itself the wrong type (`IF "A" THEN`). A unary
  `+` passes a string through (`P.+A$` runs), so it is not marked. The oracle cannot test these marks: a statement that
  stops with Type mismatch is inconclusive, and in one that does not run (`IF 0 THEN`) the mark is in text BASIC never
  reads. The rows recorded for #331 and in `type-follow-ups` are the other half, what BASIC runs without complaint
  (`PRINT"X"D`, `X$="A"+"B"`, `X=ASC GET$`, `P.A$?1`, `P.+A$`, `P.SPC1`), which must stay unmarked. Suggested by Olly
  Betts on #323, #331 and #334; because completions drop a word that makes the statement red, `PRINT"X"D` no longer
  offers `DIV`, `AND`, `OR`, `EOR` or `MOD`. While a line is typed in the editor `LEN(B` is red until the `$` is typed.
  - **Not a deviation, because BASIC stops on the line anyway**: a string constant after a sign (`PRINT -"A"`,
    `PRINT +"A"`, "No such variable") and `?` or `!` after a string variable (`X=A$?1`, `X=ASC A$?1`, "Syntax error";
    `A$?1=2` is a Mistake). They are red as errors, not marked as stricter. A string variable does not take a `?` or `!`,
    so `PRINT A$?1` is two items (`A$` then `?1`), which BASIC runs. The red is on the string after the sign, and
    on the `?` after the variable.

## The other way: lenient on purpose

One deviation goes the other way, accepting what a Model B's ROM rejects (and so is not red, and has no marker).
Olly Betts suggested it on #245: a program written for the Master with the US spelling `COLOR`, or run on a Model B
after being written on one, should still work.

- **`COLOR` is `COLOUR` on a Model B where that is all it can be.** BASIC II has no `COLOR` (`COLOR 7` is the variable
  `COLOR` and then a Mistake), and BASIC IV makes it the `COLOUR` token (`&FB`) wherever it is. On a Model B, Owlet reads a
  `COLOR` as `COLOUR` only when it starts a statement (after a colon, `THEN`, `ELSE`, `REPEAT`, `ON ERROR` or at the start
  of the line), what follows is one expression and then the end of the statement (the end of the line, a colon or
  `ELSE`), and the statement is not already valid as it is written. Anywhere else it stays the characters of a name.
  - Taken: `COLOR7`, `COLOR X`, `COLOR(1)`, `IFC%COLORC%ELSECOLORD%:NEXT`, `X=1:REP.COLORX:P.;X:X=X+1:U.X>7`,
    `ONERRORCOLOR7:GOTO1000`, and in `LETCOLOR=3:COLORCOLOR` only the second `COLOR`, which is a variable as the operand.
  - Not taken: `COLORS=7`, `COLOR=7`, `COLOR(1)=7` and `COLOR?1=7` (assignments, valid as written), `LETCOLOR=3`,
    `PRINT COLOR`, `X=COLOR` (not the start of a statement), `COLOR 1,2` and `COLOR 7 7` (not one expression, which
    BASIC II rejects as ever), `color 7` (keywords are upper case, on the Master too), and anything in a string, `REM`,
    `DATA` or `*` command, or on a line of an assembler block that an earlier line opened (the ROM tokenises each line on its
    own, and in a block `COLOR` is assembled text, so the tokeniser carries the block from line to line as the highlighter does).
    A `COLOR` alone at the end of the line is a variable still being typed and is not red.
    `COLORS` alone is read as `COLOUR S`, since that is a whole statement, and goes back to a variable at `COLORS=`.
  - The same reading makes the Model B's tokeniser write `&FB` for it, so the program that runs is the program that
    is shown. The Master is unchanged: there `COLOR` is a keyword everywhere, as its ROM has it.
  - The recorded rows for BASIC II are still the ROM's answer, and are checked against `BasicIIDialect`; the editor's
    Model B is `ModelBDialect`, BASIC II plus this, and the rows it is lenient on are `LenientThanRom` in
    `test/rom-tables.js`, which must have no mark. The oracle lists them apart as LENIENT, not as false-valids, wherever
    a `COLOR` was read as `COLOUR`.
