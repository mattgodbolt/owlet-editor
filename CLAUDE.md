# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build, Lint, Test Commands
- Build: `npm run build` or `make build`
- Start dev server: `npm run dev` or `make run`
- Preview production build: `npm run preview`
- Lint: `npm run lint` or `make lint`
- Lint & fix: `npm run lint-fix` or `make lint-fix`
- Run all tests: `npm run test` or `make test`
- Run specific test: `npx vitest run test/file_name_test.js`
- Run the completions test over a corpus of saved programs that cannot be checked in (a JSON array of `{id, text}`):
  `OWLET_CORPUS=programs.json npx vitest run test/completions_test.js`. CI runs the same check over our own programs
  (the examples and the ROM oracle's generator with a fixed seed) without it
- Run the browser tests: `npm run e2e` or `make e2e` (Playwright in `e2e/`, `*.e2e.js`; builds the page and serves it
  with `vite preview` on port 4791; needs a browser, `npx playwright install chromium`). CI runs them after
  `make ci-check`
- Run all checks: `make check` (tests + lint-fix)
- What CI runs: `make ci-check` (tests, lint, `prettier --check` and the build, failing rather than fixing)

## Code Style
- Use ESLint + Prettier configuration
- 4-space indentation for JS, 2-space for JSON/YAML/LESS
- camelCase variables/functions, PascalCase for classes
- Use `let`/`const` (not `var`)
- Prefer named ES6 imports
- Add appropriate error handling for file operations
- Follow existing patterns in the codebase

Always run linters before committing to fix formatting issues automatically.