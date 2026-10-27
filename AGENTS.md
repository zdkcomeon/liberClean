# Repository Guidelines

## Project Structure & Module Organization

LiberClean is a macOS uTools plugin wrapping the Mole CLI.

- `src/`: React/TypeScript pages, bridge contracts (`api.ts`, `types.ts`), preview fixtures, and CSS.
- Root runtime files: `preload.js` manages uTools integration and tasks; `maintenance.js`, `maintenance-helper.sh`, and `mole-update.js` handle maintenance and updates.
- `tests/`: backend and shell-adapter tests (`*.test.cjs`).
- `public/` and `logo.png`: assets; `docs/`: screenshots and release notes.
- `plugin.json`: plugin configuration; `vite.config.mts`: bundling and packaging. Generated `dist/` is ignored.

## Build, Test, and Development Commands

Use Node.js 22.12+ and pnpm.

- `pnpm install`: install dependencies.
- `pnpm dev`: serve at `http://127.0.0.1:5174`.
- `pnpm test`: run all Node.js tests.
- `node --test tests/maintenance.test.cjs`: run one suite.
- `pnpm build`: type-check with `tsc --noEmit` and assemble the installable `dist/` plugin.

For native development, import root `plugin.json` into uTools developer tools. Restart the plugin after changing root runtime scripts. Import `dist/plugin.json` to check production output.

## Coding Style & Naming Conventions

Follow existing two-space indentation, single quotes, and semicolons in JavaScript/TypeScript. Keep simple assignments and calls on one line; preserve blank lines between logical blocks. Use PascalCase for React components and interfaces, camelCase for functions and variables. Keep bridge contracts synchronized across `src/api.ts`, `src/types.ts`, and runtime implementations. Root JavaScript uses CommonJS; frontend code uses ES modules. TypeScript strict mode is enabled; no dedicated formatter or linter is configured.

## Testing Guidelines

Tests use `node:test` and `node:assert/strict`, with descriptive behavior names. Add focused regression cases for changed behavior; mock system APIs and use temporary fixtures instead of invoking installed Mole. No coverage threshold is configured. Run affected suites while iterating, then `pnpm test` and `pnpm build` for code changes.

Check UI changes at `http://127.0.0.1:5174/?preview=1`; use `?preview=stress` for edge cases. Preview uses sample data without modifying local files.

## Commit & Pull Request Guidelines

History mixes imperative English subjects with prefixes such as `feat(ui):` and `chore:`. Keep commits focused. PRs should describe behavior changes, validation, and relevant issues; include screenshots for UI changes. Update documentation when usage changes.

## Agent & Safety Guidelines

When `.codegraph/` exists, use `codegraph_explore` or `codegraph explore` before searching or reading code. Keep changes and verification proportional to the task. Preserve maintenance previews, confirmations, and path validation. Use stable ASCII log events with task/request identifiers; never log passwords, tokens, or credentials.
