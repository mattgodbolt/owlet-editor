# Developing Owlet

Running, building and testing Owlet on your own machine, for anyone changing Owlet itself rather than writing BASIC
with it (the [README](../README.md) is for that). Changes to the highlighting also record what the real ROM does; see
[checking against the ROM](highlighting.md#checking-against-the-rom).

## To develop

```
$ make run   # Starts the Vite development server
$ npm run build   # Build for production
$ npm run preview   # Preview the production build locally
$ npm run e2e   # Build, then drive the built page in a browser (first: npx playwright install chromium)
```

Then visit http://localhost:8080

The `make` targets first install the npm packages and fetch the GXR ROM, which is not kept in the repository: it is
downloaded once into `.cache/roms`, checked against its hash, and copied into jsbeeb's ROMs.

## Build System

Owlet builds with Vite. It moved from webpack to match its jsbeeb dependency, which also uses Vite.

## Tests and checks

- `make test` (or `npm run test`) runs the unit tests in `test/` with Vitest; `npx vitest run test/file_name_test.js`
  runs one file.
- `make lint` checks the code with ESLint, and `make lint-fix` fixes what it can.
- `make check` runs the tests and `lint-fix`, before committing.
- `make ci-check` is what CI runs: the tests, lint, `prettier --check` and the build, failing rather than fixing.
- `make e2e` (or `npm run e2e`) runs the browser tests, Playwright in `e2e/` (`*.e2e.js`): it builds the page and
  serves it with `vite preview` on port 4791, and needs a browser (`npx playwright install chromium`). CI runs them
  after `make ci-check`.
- `OWLET_CORPUS=programs.json npx vitest run test/completions_test.js` runs the completions test over a corpus of saved
  programs that cannot be checked in (a JSON array of `{id, text}`). CI runs the same check over our own programs (the
  examples and the ROM oracle's generator with a fixed seed) without it.

The pre-commit hook runs lint-staged: ESLint and Prettier on the staged files, and the tests related to the staged
code. Commit messages follow the Conventional Commits style of the history (`feat:`, `fix:`, `test:`, `docs:`,
`refactor:`, `chore:`).

Tests may warn about missing source maps for Monaco Editor: a
[known issue with Monaco Editor 0.52.0+](https://github.com/microsoft/monaco-editor/issues/4712) that does no harm.

## Machines in saved programs and shared links

The machine chosen under the emulator ([machines](../README.md#machines)) is kept in the program's state. A link made
for the Master has `"model":"Master"` in its state; a link without it, as every link made before there was a choice,
runs on the Model B. "Model B (no GXR)" is kept as `"gxr":false` (and as `B-no-GXR` in the browser), written only for
that machine, so every other link is unchanged; an older Owlet ignores the field and runs the Model B with the GXR.

## Changing the highlighting

What is red, and why, is in [highlighting](highlighting.md). Expected values come from the ROM: rows are recorded
with `tools/rom-oracle/record.mjs` (always with `--source`), never typed, and `tools/rom-oracle/oracle.mjs` compares
the highlighter with the ROM before a change. A mark that is stricter than the ROM on purpose, or more lenient, is a
bullet of its own in [deliberate deviations from the ROM](rom-deviations.md).
