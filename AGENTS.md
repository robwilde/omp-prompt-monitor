# Repository Guidelines

## Project Overview

`omp-prompt-monitor` is a local dashboard for [Oh My Pi](https://github.com/can1357/oh-my-pi) (omp): it scans every top-level session `.jsonl` file under `~/.omp/agent/sessions` (or a configured agent dir), extracts user prompts and text-bearing agent replies, and serves a live-updating HTML dashboard grouped by project/repo. It ships both as a standalone CLI (`omp-monitor`) and as an omp plugin (`/monitor` command) that can auto-launch the dashboard server from inside a session.

Security-sensitive: the server binds `127.0.0.1` only, but `/api/session/:id` and `--json` output expose **full prompt and reply text**. Never widen the bind address or add auth-bypassing routes without treating this as a security-relevant change.

## Architecture & Data Flow

The pipeline is one-way; on-disk and API contracts are versioned explicitly (`v: 1` for heartbeat and API snapshot, `v: 2` for the index cache). The index cache stores list metadata and user prompts only; full assistant replies are parsed on demand for one selected session.

```
journal.ts          index-store.ts        view.ts              server.ts / extension
parseSessionText  →  createIndexStore  →  buildSnapshot       →  /api/snapshot, /api/session/:id
(one .jsonl file)    .refresh()           (SessionParse         (strips prompts from list view,
 → SessionParse|null  (glob + mtime/size    + git + heartbeat     keeps them in detail view)
                       cache, bounded        → MonitorSnapshot)
                       concurrency)                              extension/index.ts writes a
                                                                  heartbeat file per session and
                                                                  registers /monitor
```

- **`src/core/journal.ts`** — `parseSessionText(text)` parses one session's JSONL: an optional v1 title-slot record, then a session header (must have a string `id` or the whole parse returns `null`). Walks records for user-authored `PromptRow`s (`kind: "typed" | "skill"`) and text-bearing assistant replies (`kind: "reply"`) in one chronological timeline. Synthetic/agent-attributed/empty user entries and tool-only assistant entries are skipped; `steering: true` is **not** a filter (omp stamps the user's own mid-stream input with it and `attribution: "user"`; agent steers carry `attribution: "agent"`). Skill prompts additionally require `custom_message` + `customType === "skill-prompt"` + user attribution. Writable-collab `collab-prompt` custom messages are not surfaced. Title precedence: slot title → header title → first user prompt truncated to 60 chars → `Session <id8>`. `deriveTailStatus` inspects the last message to classify `complete | interrupted | aborted | error | pending | unknown` (mirrors omp's `session-listing.ts` `statusFromTailMessage`). Malformed JSON lines are counted (`malformedLines`), not thrown.
- **`src/core/index-store.ts`** — `createIndexStore({ sessionsRoot?, cacheFile?, concurrency? })` returns an `IndexStore` whose `refresh()` globs `*/*.jsonl` (exactly one directory level — **no subagent-tree recursion by design**), reuses cached `IndexedSession` entries when `size`+`mtimeMs` are unchanged, parses with replies disabled, and persists only user prompts in `{ v: CACHE_VERSION, entries }` to `<state dir>/index-cache.json` via `Bun.write` (skipped when nothing changed). **Bump `CACHE_VERSION` whenever `parseSessionText` output changes** — unchanged files reuse cached entries, so without a bump they keep the old parser's prompts; a version mismatch discards the cache. Per-file stat/read/parse failures are swallowed and filtered out; unexpected glob/write errors propagate.
- **`src/core/view.ts`** — `buildSnapshot({ sessionsRoot? })` runs the lightweight index refresh and `readHeartbeats()` in parallel, enriches each session with git info (`describeRepo`) and `liveness` (`live` if heartbeat present, else `recent` within `RECENT_WINDOW_MS` = 15 min, else `idle`), sorts sessions by last activity, and groups them into `ProjectGroup`s keyed by `repoRoot ?? cwd`. `loadSessionPrompts(session)` re-parses one source file on demand for the full typed/skill/reply timeline and falls back to the indexed prompts if that file is unavailable.
- **`src/core/heartbeat.ts`** / **`src/core/paths.ts`** — heartbeat files live at `resolveHeartbeatDir()/<sessionId>.json`, written every 20s, considered stale after 60s; `readHeartbeats()` opportunistically unlinks stale or dead-same-host entries. `paths.ts` resolves all directories from env (`PI_CODING_AGENT_DIR`, `OMP_PROFILE`/`PI_PROFILE`, `PI_CONFIG_DIR`, `XDG_DATA_HOME`, `XDG_STATE_HOME`) with a strict precedence order — read this file before changing where anything is stored. `resolveSessionsRoot` mirrors omp's `DirResolver` (`packages/utils/src/dirs.ts`): a named profile ignores `PI_CODING_AGENT_DIR`; XDG applies whenever the agent dir equals the default (including an explicit equal override), keyed on `$XDG_DATA_HOME/omp/profiles/<name>` for profiles; invalid profile names fall back to default. `resolveHistoryDb` mirrors omp's `getHistoryDbPath` as `dirname(resolveSessionsRoot())/history.db` (omp resolves both through `agentSubdir(..., "data")`, so they always share a parent).
- **`src/core/recap.ts`** — `loadLatestRecap(sessionId, { dbPath? })` reads omp's idle-recap journal: table `session_recaps` in `history.db` (append-only; keyed by the session header `id`; `created_at` is unix **seconds**). Opens the db `{ readonly: true }` per call (never `create`, never sets `journal_mode` — omp owns the WAL db and may quarantine/recreate it, so no long-lived handle), sets `busy_timeout`, runs omp's guarded query (`typeof` guards, `ORDER BY created_at DESC, id DESC LIMIT 1`), and returns `{ text, createdAt /* ms */ } | null`. Any failure (missing db/table, lock, corruption) yields `null`. The full recap lives only here: omp's CLI truncates it on screen and never writes it to the session `.jsonl`.
- **`src/core/git.ts`** — `describeRepo(cwd)` shells out to `git` via `Bun.spawn` with a 2s `AbortSignal.timeout`, memoized per-`cwd` for the process lifetime (including failed lookups); any git error/non-zero exit yields `null`, never a throw.
- **`src/server.ts`** — `startServer({ port?, hostname? })` first probes for an already-running instance via `/healthz` + the `x-omp-monitor` identity header (so a second `omp-monitor` invocation reuses it instead of double-binding); otherwise starts `Bun.serve`. In-flight snapshots are cached for 3s (`createSnapshotCache`) to absorb bursty polling. `/api/snapshot` returns the list with `prompts: []` stripped per session (privacy for the list view) and **never** carries a recap; `/api/session/:id` returns `{ session: { ...SessionRow, prompts, recap } }` — the one session's full prompt and reply timeline by re-parsing that source file on demand, plus `recap: SessionRecap | null` from `loadLatestRecap(session.id)`.
- **`src/extension/index.ts`** + **`src/extension/heartbeat-tracker.ts`** — the omp plugin: on `session_start` it writes a heartbeat immediately and every `HEARTBEAT_INTERVAL_MS` via `ctx.setInterval`; `session_switch`/`session_branch` (`/new`, `/resume`, fork, `/btw`) re-key the heartbeat to the new session id and remove the previous one (`session_start` fires once per session runtime — main session, each in-process subagent, each ACP session — not on in-process switches; the tracker is created inside the plugin factory closure, never at module scope). `createHeartbeatTracker({ write, remove })` runs all heartbeat writes and removals through one promise queue in call order, with the session identity captured synchronously, so a pending write can never recreate a removed file; `session_shutdown` stops further beats, enqueues removal of every tracked id and waits for the queue, bounded by `DRAIN_TIMEOUT_MS` (1500ms, inside omp's 2000ms teardown budget) — best-effort, a leftover file self-expires. The `write`/`remove` injection exists so tests can hold a write in flight deterministically. `pi.registerCommand("monitor", …)` takes its sub-commands (`start` — the default for an empty argument — `stop`, `restart`, `update`) from one `MONITOR_ACTIONS` table that also drives `parseMonitorAction`, `formatUnknownAction`, the command description and `getMonitorCompletions`; the latter is wired as `getArgumentCompletions` so omp's TUI lists the actions (with descriptions) after `/monitor ` and on Tab, like the built-in `/mcp` (item `value` replaces the whole argument text, so it carries a trailing space; the callback is synchronous). The `start` action spawns `Bun.spawn([bun, cli.ts, "--port", DEFAULT_PORT], { stdio: "ignore" }).unref()` detached if no server is already reachable, then polls up to 20×100ms before reporting the result via `ctx.ui.notify` (transcript output, matching `/stats`'s `Dashboard available at:` line — not a persistent status-bar entry). `src/extension/omp-api.ts` is a **hand-maintained structural slice** of the omp plugin API (deliberately avoids depending on `@oh-my-pi/pi-coding-agent`) — extend it, don't replace it with a real import, unless that dependency decision changes project-wide.
- **`src/client/index.html`** — the entire frontend: one static file, inline CSS + vanilla JS, no framework/build step. Polls `/api/snapshot` every 10s (skipped while `document.hidden`), fetches `/api/session/:id` on demand for prompt detail, renders via `createElement`/`textContent` (prompts go into `<pre>` via `textContent`, not `innerHTML` — preserve this to avoid XSS via prompt content). In the Journal section, `renderPrompts()` shows a "Latest recap" block (timestamp + full text in a `<pre>`) directly under the session heading when `sessionDetail.recap` is set; it is not part of the prompt list and not counted in `section-count`.
- **`src/cli.ts`** — parses `--port`, `--host`, `--open`, `--json`, `--help` with `node:util` `parseArgs` (strict, no positionals). `--json` builds a full snapshot and prints it, bypassing the server entirely.

## Key Directories

- `src/core/` — pure, Bun-only, no HTTP/UI: journal parsing, incremental indexing, git/heartbeat lookups, recap lookup, snapshot assembly. Barrel `src/core/index.ts` re-exports everything (`git`, `heartbeat`, `index-store`, `journal`, `paths`, `portable-prompt`, `recap`, `view`); tests import concrete modules directly, not the barrel.
- `src/server.ts` — HTTP layer (Bun.serve), including route handling, default-port reuse probing, snapshot caching, and HTML bundling.
- `src/extension/` — omp plugin glue (`index.ts`) plus the standalone API type slice (`omp-api.ts`).
- `src/client/` — single static `index.html` dashboard, served inline by `server.ts`.
- `src/cli.ts` — process entry point / arg parsing / stdout JSON mode.
- `test/` — `bun:test` specs (`*.test.ts`) plus `test/fixtures/*.jsonl` used as literal journal input.

## Development Commands

There is **no `scripts` field in `package.json`** — invoke Bun directly:

```bash
bun run src/cli.ts                       # start dashboard, default port 7333
bun run src/cli.ts --port 8080 --open    # custom port, opens browser
bun run src/cli.ts --json > snapshot.json   # print full snapshot, no server
bun test                                 # run all specs in test/
bun test test/journal.test.ts            # run one spec file
```

There is **no local typecheck command**: `typescript` is not a dependency (`bun.lock` only resolves `@types/bun` → `bun-types` → `@types/node`/`undici-types`), and no `tsc` binary is installed. Bun transpiles/runs `.ts` directly without type-checking. Don't invent a `tsc`/typecheck step; if strict type safety needs enforcing in CI, that requires adding `typescript` as a devDependency first — flag this rather than assuming `bunx tsc --noEmit` works out of the box.

Local plugin development/testing inside omp itself:

```bash
omp plugin link ./omp-prompt-monitor
# restart omp (required — /reload-plugins does not rebuild initialized extensions)
# then run /monitor inside a session
```

## Code Conventions & Common Patterns

- **No classes.** Everything is factory functions returning closures (e.g. `createIndexStore(...)` returns `{ refresh }`) or plain exported functions/types.
- **Naming**: kebab-case filenames (`index-store.ts`), camelCase functions/locals, PascalCase interfaces/types, `SCREAMING_SNAKE_CASE` constants (`RECENT_WINDOW_MS`, `DEFAULT_PORT`, `MONITOR_HEADER`).
- **Versioned serializable contracts**: the heartbeat and API snapshot shapes carry `v: 1`, the persisted cache carries `CACHE_VERSION` (currently `2`; bump it when parser output changes); assistant reply text is intentionally excluded from the persisted cache and loaded only for session detail.
- **Error handling is deliberately asymmetric**: per-item work (one journal file, one heartbeat file, one git probe) fails silently and is filtered out — a single corrupt session must never take down indexing. Top-level operations (server bind, unexpected filesystem/glob errors, cache writes) are allowed to throw/reject and surface as actionable errors (e.g. `startServer` throws `'Failed to bind ... Pass --port'`). Preserve this split when adding new I/O — don't let one bad file abort a bulk operation, but don't swallow genuine startup/config errors either.
- **Async style**: `async`/`await` throughout, `Promise.all` for independent fan-out (e.g. `view.ts` running index refresh and heartbeat read in parallel), a hand-rolled bounded worker pool (`mapWithConcurrency` in `index-store.ts`) instead of a dependency for concurrency limiting.
- **Bun-native APIs preferred over Node equivalents**: `Bun.Glob`, `Bun.write`, `Bun.file`, `Bun.spawn`, `Bun.which`, `Bun.serve`. Only reach for `node:*` modules (`node:os`, `node:path`, `node:util`) when Bun has no equivalent.
- **No runtime schema validation** on parsed JSON (journal records, heartbeat files, cache files) — shapes are cast, not validated with e.g. zod. Match this style rather than introducing a new validation dependency for one call site.
- **Privacy boundary lives in the route handler, not the model**: `MonitorSnapshot`/`SessionRow` always carries full data; `server.ts`'s `/api/snapshot` handler is what strips `prompts: []`. If you add a new "list" endpoint exposing session data, strip prompts there too — don't change the shared `view.ts` types to do it. Recap text (a summary of session content) is attached only in the `/api/session/:id` handler and is deliberately not a `SessionRow`/`MonitorSnapshot` field, so it can never leak through the list endpoint or `--json`.
- **Client renders via DOM APIs, not string concatenation**: prompt text goes into `<pre>` via `.textContent`. Keep any client-side change consistent with this (no `innerHTML` with user-controlled text).

## Important Files

- `src/core/journal.ts` — journal parsing rules; read this fully before touching prompt-extraction logic.
- `src/core/paths.ts` — all filesystem-location resolution/precedence (env vars, XDG, platform branching); read before changing where state/cache/heartbeats live.
- `src/core/view.ts` — the snapshot contract (`MonitorSnapshot`, `SessionRow`, `ProjectGroup`) consumed by both the server and the client.
- `src/server.ts` — HTTP routes, identity-header reuse mechanism, snapshot caching.
- `src/extension/index.ts` + `src/extension/omp-api.ts` — omp plugin integration surface.
- `src/client/index.html` — the entire frontend.
- `package.json` — no `scripts`, no runtime dependencies; `exports`/`bin`/`omp.extensions` define the three consumption modes (library import, CLI bin, omp plugin).
- `tsconfig.json` — `strict: true`, `noUncheckedIndexedAccess: true`, `noEmit: true` (ships raw `.ts`), `moduleResolution: "bundler"`.

## Runtime/Tooling Preferences

- **Bun only** (`engines.bun >= 1.3.14`). No Node-specific build/runtime path exists or should be added.
- **ESM only** (`"type": "module"`), `isolatedModules: true` — every file must be a valid standalone module.
- No bundler/build step: TypeScript source ships and runs as-is (`bin`/`exports` point straight at `.ts` files).
- No linter/formatter config present in the repo — match existing style by hand rather than introducing a new tool config unasked.

## Testing & QA

- Framework: Bun's built-in `bun:test` (`describe`, `test`, `expect`) — no Jest/Vitest.
- Convention: `test/**/*.test.ts`, fixtures as literal `.jsonl` files under `test/fixtures/`, loaded via `Bun.file(new URL('./fixtures/....jsonl', import.meta.url)).text()`.
- Run: `bun test` (auto-discovers) or `bun test test/paths.test.ts test/journal.test.ts`.
- Current coverage is narrow: `test/paths.test.ts` covers the env-precedence branches of `resolveSessionsRoot` and `resolveHistoryDb`; `test/recap.test.ts` covers `loadLatestRecap` against temp dbs built with omp's exact `session_recaps` DDL (latest-row/tiebreak selection, session isolation, seconds→ms, missing db/table/rows → `null`); `test/journal.test.ts` covers only a subset of `parseSessionText` (title-slot precedence, noise skipping, malformed-line counting, legacy title derivation, invalid input). **Untested**: `index-store.ts` (cache load/write, glob filtering, concurrency, incremental refresh), `view.ts` (`buildSnapshot`, grouping, liveness), `heartbeat.ts` (write/remove/read, staleness), `git.ts` (`describeRepo`, timeout, memoization), and most `tailStatus`/timestamp-fallback branches in `journal.ts`. When touching any of these, add tests for the new behavior following the existing fixture-file pattern rather than assuming prior coverage exists.
