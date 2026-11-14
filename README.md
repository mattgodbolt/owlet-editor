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

Red means that BBC BASIC II would stop with an error at that statement if it ran it.

- **Never red on code the ROM accepts.** The number of false-invalids (the ROM runs a statement, the editor shows it
  red) must be 0 on the recorded tables, the ROM oracle and the saved programs.
- **Text that is not code is never red:** a comment after `REM`, the items after `DATA`, a `*` command, and the rest
  of a line after an `ELSE` that starts a statement or a `DEF` that is not `DEF FN` or `DEF PROC`, and an `ON ... GOTO`
  list after its first target, all of which BASIC skips.
- **Code is red if it would stop BASIC when run, even where it cannot run** (on purpose):
  - the branch of an `IF` whose condition is false, which BASIC skips;
  - the body of a `DEF FN` or `DEF PROC`, which BASIC skips on its way through the program and runs only when called;
  - statements after `GOTO`, `END`, `ENDPROC`, `RETURN`, `STOP` or a function's `=` on the same line, which can
    never run. Acorn's Welcome disc has one: `IF CHAR=2 THEN=45:FORCE -` (line 7310 of `W.KEYBD`) is red, and its
    `FORCE -` can never run.
- **False-valids are measured, not gated.** Where the ROM rejects a statement and nothing is red, that is reported by
  the oracle, but it is never a reason to fail a change.
- **Stricter than the ROM only on purpose.** Each other deliberate exception, such as text after a complete assembler
  instruction, is a row of the recorded table listed as stricter than the ROM in its test.

Adding `?parser=new` to the address tries the tokenizer in `src/parser` in place of the Monarch grammar in
`src/bbcbasic.js`: a port of the ROM's tokeniser, a recogniser that marks the token at which BASIC would stop with an
error, and the assembler. The default is still the Monarch grammar.

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
