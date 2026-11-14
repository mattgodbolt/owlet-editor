## Owlet Editor🦉 ![Owlet CI and CD](https://github.com/mattgodbolt/owlet-editor/workflows/Owlet%20CI%20and%20CD/badge.svg)
A simple, intuitive creative coding tool for BBC BASIC inspired by [BBC Micro Bot](https://mastodon.me.uk/@bbcmicrobot)


Try the beta now at [bbcmic.ro](https://bbcmic.ro) and get coding!

## A modern editor for a classic language

* Fast, intuitive web-based editor (autocomplete, highlighting)
* Linked to 1000 BBC BASIC code examples from the [bbcmicrobot community](https://www.bbcmicrobot.com/)
* Based on Monaco editor

## BBC Micro emulator for instant feedback

* Integrated with JSbeeb emulator
* Sound, which starts off: use the Sound button under the emulator to turn it on
* Share your entire program as a URL
* Export to external emulator for interactive use

### Links that ask for sound

Browsers only allow a page to make sound after a click or key press, so a link can't turn it on by itself.
Adding `?sound` to the address (for example `https://bbcmic.ro/?sound#...`) makes the Sound button flash, and the
first click or key press anywhere on the page turns sound on. Without it sound is off, so every existing link stays
quiet. The Share dialog adds `?sound` to the link it makes when sound was on. The setting isn't remembered between
visits.

## Share your creations with the BBC Micro Bot Mastodon community

* One button tweet to share code (not yet updated for Mastodon)
* Automatic code golfing tools - byte token encode/decode



## To develop

```
$ make run   # Starts the Vite development server
$ npm run build   # Build for production
$ npm run preview   # Preview the production build locally
```

Then visit http://localhost:8080

## Build System

Owlet Editor uses Vite as its build system. The project was migrated from webpack to Vite to align with the jsbeeb dependency, which also uses Vite.

## Highlighting: what red means

Red means that BBC BASIC II would stop with an error at that statement if it ran it, and that no more typing at the end
of the line could change that. The colours are a function of the text alone, wherever the cursor is.

- **Red runs to the end of the statement** (`?parser=new`): BASIC stops at the first token that cannot continue a
  statement and never reads the rest of it, so that token and everything after it up to the end of the statement is red,
  where only the stop token used to be. `I am a badger` is `I` as a variable and `am a badger` red; `GOTO 20 30:PRINT 5`
  is red on `30` only, since the statement ends at the colon and `PRINT 5` is judged on its own. A statement ends at a
  colon or an `ELSE` outside a string, or at the end of the line, and in an assembler block also at the `]` that closes
  it. A `REM` or `DATA` after the stop point, its comment or items, and a `*` command are not code and keep their own
  colours. Red text never takes part in bracket matching. A line that is only unfinished is not red at all.

- **Never red on code the ROM accepts.** The number of false-invalids (the ROM runs a statement, the editor shows it
  red) must be 0 on the recorded tables, the ROM oracle and the saved programs.
- **Text that is not code is never red:** a comment after `REM`, the items after `DATA`, a `*` command, and the rest
  of a line after an `ELSE` that starts a statement or a `DEF` that is not `DEF FN` or `DEF PROC`, and an `ON ... GOTO`
  list after its first target, all of which BASIC skips.
- **Unfinished is not red** (`?parser=new`): a line that BASIC rejects only because something is still to be typed keeps
  its ordinary colours, so a line can be typed a key at a time. Something is still to be typed where the line ends:
  `G`, `GOTO`, `GOTO `, `FOR I=1 TO`, `PRINT (1+`, `PRINT "HI` (a string with no closing quote yet) and `[LDA` are
  unfinished, including a name or keyword that could grow into a longer keyword (`FOR I=1 T`, `X=1 AN`, `ENDP`, `MOD`
  for `MODE`, `A=TO` for `TOP`) or a mnemonic (`[LD`). One more shape is unfinished: a statement that stops at a `)`
  when something typed just before it would make the statement valid (a missing operand, argument or trailing `,`, or
  the rest of a word before it). That is what an editor that closes brackets shows while a call is typed:
  `A$=LEFT$()`, `A$=LEFT$(B)`, `A$=LEFT$(B$,)`, `PRINT (1+)`, `PRINT TAB(1,)` and `DIM a()`. Monaco closes only `(` and `"`, and
  an open `"` is unfinished already. The recogniser tries a short list of fillers (a value, `,1`, `1,1`...) at the `)`,
  and the completion of the word before it, and asks whether the statement is then valid. `A$=LEFT$(X$)` is also
  unfinished, though it is one argument short as written, because it is what the editor shows at `LEFT$(X$|)` and
  cannot be told apart from the finished text. The colour cannot know the cursor, so a line that stays like that in a
  finished program is shown by a marker instead, below. Everything else that stops short is red, with no allowance
  for text typed in front of what is already there: no typing at the end of the text mends it, and the ROM rejects it
  as written. `GOTO:PRINT`, `FOR I=1 TO:NEXT`, `IF PRINT 2` and `X=1+:PRINT X` are red, and so are `GOTO 20 30`, `PRINT )`,
  `A=1'`, `X=1+*` and `PRINT (1+2))`. A line typed in front of existing text is therefore red at the keys where the
  statement is not yet finished (`FOR I=1 TO 10` in front of `:PRINT I:NEXT` is red from `F` to `FOR I=1 TO `, and not
  red once the `10` is there). Words typed straight against the word after them with no space (`IF A=1 TPRINT 2`,
  which is a name, `TPRINT`, and a number) are red until the space is typed.
- **Markers** (`?parser=new`): about half a second after the last edit (the old markers stay, and move with the text,
  until then), a statement BASIC would stop at gets an error squiggle from the token where it stops to the end of the statement, and a line that is unfinished gets a warning
  squiggle: at its end, or at the token where the statement stopped when something is missing from the middle. Both
  come from the recogniser that colours the text. The message is the ROM's own error text (`Mistake`, `Syntax error`,
  `No TO`, `Missing ,`, `Missing "` and so on) where the recogniser knows it; the recorded rows in
  `test/rom-verdicts.json` are checked against it, and where a site is worded differently by context (a call's
  arguments) there is no text rather than a guess. Markers may depend on the cursor, unlike the colours: the line the
  cursor is on is not marked as unfinished (it would blink with every key), and is marked as soon as the cursor
  leaves it. An assembler block that is never closed is one error on its `[` in place of one per later line (the
  later lines are coloured as before). A syntax marker is left out where a warning already covers the same text
  (`x == 3` has the warning about `==`), and quick fixes are offered only for the warnings, never for a syntax marker.
- **Code is red if it would stop BASIC when run, even where it cannot run** (on purpose):
  - the branch of an `IF` whose condition is false, which BASIC skips;
  - the body of a `DEF FN` or `DEF PROC`, which BASIC skips on its way through the program and runs only when called;
  - statements after `GOTO`, `END`, `ENDPROC`, `RETURN`, `STOP` or a function's `=` on the same line, which can
    never run. Acorn's Welcome disc has one: `IF CHAR=2 THEN=45:FORCE -` (line 7310 of `W.KEYBD`) is red, and its
    `FORCE -` can never run.
- **False-valids are measured, not gated.** Where the ROM rejects a statement and nothing is red, that is reported by
  the oracle, but it is never a reason to fail a change.
- **The oracle reads only the stop token as evidence.** The red after it is text BASIC never read, so the oracle
  asks the ROM about each red run in turn and drops the ones it never reads, as it does for any text BASIC skips; a
  statement's verdict is as before.
- **Unfinished is a third answer in the oracle.** A statement the ROM rejects and the recogniser calls unfinished is
  neither a false-valid nor a false-invalid; the oracle counts it as agreement and lists it apart, and also lists
  any such statement that the ROM accepts (there must be none), outside the text BASIC skips. Where a statement is
  unfinished at a `)`, some insertion there should make the ROM accept it; the oracle does not check that, so
  check it by hand with the ROM when the fillers in `src/parser/recogniser.js` change.
- **Stricter than the ROM only on purpose.** The exceptions are the list below; each is a row of the recorded table
  listed as stricter than the ROM in its test, and the oracle reports them as STRICTER, apart from the false-invalids.

### Deliberate deviations from the ROM

Text the ROM runs without error that is red on purpose, because it is almost always a mistake. Each has a hover
message that says what BASIC does, and shows as an error.

- **A keyword after a complete assembler instruction** (`NOP PRINT`, `LDA #1 FOR`). BASIC ignores the rest of the
  statement; text there that is not a `;` or `\` comment is probably a comment missing its `;`.
- **A character in a mnemonic that is not a letter** (`LD89`, `ST89`, `CP8 5`, `SEC` spelt `3EC`), suggested by Olly
  Betts on #174. BASIC compares only the low five bits of each character, so it reads `8` as `X`, `9` as `Y`, `!` as `A`
  and so on (`LD89` is `LDX 9`, but is an easy typo for `LDA89`, `LDX89` or `LDY89`). The character is red and the hover
  says what BASIC reads it as. Upper and lower case letters stay valid, and so does `LDA89` (`LDA` and the number 89).

Adding `?parser=new` to the address tries the tokenizer in `src/parser` in place of the Monarch grammar in
`src/bbcbasic.js`: a port of the ROM's tokeniser, a recogniser that marks the token at which BASIC would stop with an
error and the rest of that statement, and the assembler. The default is still the Monarch grammar. Bracket colouring and matching work with it as they do
with Monarch (an unclosed `(` is not red while its line is unfinished).

Expected values come from the ROM, not from beliefs about it. `node tools/rom-oracle/record.mjs 'X=Y.5'` runs a
statement on BBC BASIC II and appends its verdict (the error's name or `ok`) to `test/rom-verdicts.json`, and
`--tokens` appends the ROM's tokenisation of a line to `test/rom-tokens.json`; nobody types a verdict.
`--source '#149'` ends each row with the issue it comes from, so that a report seen before is one search of the tables
away. Before a change to highlighting, `node tools/rom-oracle/oracle.mjs` compares the highlighter with the ROM on
generated statements (see the comment at its top).

## Known Issues

- With the default tokenizer (not `?parser=new`), an abbreviated function opener typed straight after another keyword, such as `PRINTLE.A$,1)` (`LE.` is `LEFT$(`), leaves its closing `)` painted red, though the line is valid. Monaco merges neighbouring same-coloured tokens and then misses the opener. Adding a space (`PRINT LE.A$,1)`) or spelling the keyword out avoids it.
- In assembler, a statement keyword after a complete instruction, as in `LDA #1 FOR` or `NOP PRINT`, is highlighted as invalid on purpose. BBC BASIC ignores the rest of the statement, but text there that is not a `;` or `\` comment is almost always a mistake, such as a comment missing its `;`.
- When running tests, you may see warnings about missing source maps for Monaco Editor. This is a [known issue with Monaco Editor 0.52.0+](https://github.com/microsoft/monaco-editor/issues/4712) and doesn't affect functionality.
