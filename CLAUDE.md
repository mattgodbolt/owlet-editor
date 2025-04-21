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
- Run all checks: `make check` (tests + lint-fix)

## Code Style
- Use ESLint + Prettier configuration
- 4-space indentation for JS, 2-space for JSON/YAML/LESS
- camelCase variables/functions, PascalCase for classes
- Use `let`/`const` (not `var`)
- Prefer named ES6 imports
- Add appropriate error handling for file operations
- Follow existing patterns in the codebase

Always run linters before committing to fix formatting issues automatically.