---
date: 2026-08-25T23:43:51+10:00
researcher: Claude
git_commit: 28f4cdb7e8c360c2480a733442814f5a52df0946
branch: main
repository: omp-prompt-monitor
topic: "omp-prompt-monitor — user-friendly report for a blog post"
tags: [research, codebase, omp-prompt-monitor, dashboard, oh-my-pi, blog-post]
status: complete
last_updated: 2026-08-25
last_updated_by: Claude
---

# Research: omp-prompt-monitor — a dashboard for developers running multiple Oh My Pi sessions

**Date**: 2026-08-25
**Researcher**: Claude
**Git Commit**: 28f4cdb7e8c360c2480a733442814f5a52df0946
**Branch**: main
**Repository**: robwilde/omp-prompt-monitor

## Research Question

Review all commits and `README.md` to create a user-friendly report of the application as a basis for a blog post introducing the new OMP tool for developers running multiple sessions.

## Summary

`omp-prompt-monitor` is a local dashboard for [Oh My Pi](https://github.com/can1357/oh-my-pi) (omp). It scans the session `.jsonl` files omp already writes, groups sessions by project, shows whether each session is live or recently active, and provides a searchable journal for the selected session.

The tool addresses a practical problem: once several agentic coding sessions are running across several repositories, the useful context is split across terminal tabs. The dashboard creates one browser view for answering three questions: which projects have active work, what each session is doing, and what was asked most recently.

It ships as a standalone CLI, a hosted installer, and an omp plugin. The plugin adds `/monitor`, starts the dashboard when needed, and writes heartbeat files so the dashboard can distinguish an active session from one that merely wrote to disk recently. The repository reached version 0.1.8 in 42 commits across 2026-08-24 and 2026-08-25.

## Detailed Findings

### What users see

- **Three-column dashboard**: projects, sessions, and a journal/detail pane ([client layout](https://github.com/robwilde/omp-prompt-monitor/blob/28f4cdb7e8c360c2480a733442814f5a52df0946/src/client/index.html#L79-L81); [responsive layout](https://github.com/robwilde/omp-prompt-monitor/blob/28f4cdb7e8c360c2480a733442814f5a52df0946/src/client/index.html#L173-L186)).
- **Project cards** show repository label, session count, live count, and relative last-activity time. Selecting a project filters the session list ([rendering and selection](https://github.com/robwilde/omp-prompt-monitor/blob/28f4cdb7e8c360c2480a733442814f5a52df0946/src/client/index.html#L274-L303)).
- **Session cards** show title, liveness, prompt count, repository label, and relative activity. Live, recent, and idle filters make a busy list manageable ([session rendering](https://github.com/robwilde/omp-prompt-monitor/blob/28f4cdb7e8c360c2480a733442814f5a52df0946/src/client/index.html#L306-L340)).
- **Journal detail** renders the selected session's prompts and replies as cards, newest first. Each entry is labeled You or Agent, skill invocations are marked, and entries include timestamps and character counts. Search and All/You/Agent role filters narrow the journal ([journal rendering](https://github.com/robwilde/omp-prompt-monitor/blob/28f4cdb7e8c360c2480a733442814f5a52df0946/src/client/index.html#L406-L459)).
- **Copy controls** put each journal entry on the clipboard, with a Clipboard API path and a fallback for restricted browser contexts. Success produces a temporary checkmark and accessible toast ([copy behavior](https://github.com/robwilde/omp-prompt-monitor/blob/28f4cdb7e8c360c2480a733442814f5a52df0946/src/client/index.html#L352-L404)).
- **Automatic refresh** runs immediately and then every 10 seconds, but skips work while the browser tab is hidden ([refresh loop](https://github.com/robwilde/omp-prompt-monitor/blob/28f4cdb7e8c360c2480a733442814f5a52df0946/src/client/index.html#L474-L488)).
- **Update notification** is checked no more than once every 30 minutes in the client and points users to `/monitor update` when a newer version is available ([client update check](https://github.com/robwilde/omp-prompt-monitor/blob/28f4cdb7e8c360c2480a733442814f5a52df0946/src/client/index.html#L217-L266)).
- **Branding** includes the OMP Prompt Monitor title, favicon, and header icon ([document and header](https://github.com/robwilde/omp-prompt-monitor/blob/28f4cdb7e8c360c2480a733442814f5a52df0946/src/client/index.html#L6-L7)).

Prompt and reply content is inserted using `textContent`, including the journal `<pre>` body, rather than `innerHTML`. That keeps arbitrary transcript text from being interpreted as markup ([DOM helper](https://github.com/robwilde/omp-prompt-monitor/blob/28f4cdb7e8c360c2480a733442814f5a52df0946/src/client/index.html#L243-L247); [journal body](https://github.com/robwilde/omp-prompt-monitor/blob/28f4cdb7e8c360c2480a733442814f5a52df0946/src/client/index.html#L456-L458)).

### How the application works

The application has a deliberately one-way pipeline:

1. **Reader** — `src/core/journal.ts` parses one session JSONL file. It recognizes an optional title slot and a required session header, counts malformed lines instead of aborting the parse, filters synthetic/steering/agent-attributed noise, and emits typed prompts, skill prompts, and optional non-empty assistant replies ([JSONL and header handling](https://github.com/robwilde/omp-prompt-monitor/blob/28f4cdb7e8c360c2480a733442814f5a52df0946/src/core/journal.ts#L122-L150); [message filtering](https://github.com/robwilde/omp-prompt-monitor/blob/28f4cdb7e8c360c2480a733442814f5a52df0946/src/core/journal.ts#L155-L202)). Titles fall back from title slot to header title to a 60-character first prompt and finally `Session <id8>` ([title selection](https://github.com/robwilde/omp-prompt-monitor/blob/28f4cdb7e8c360c2480a733442814f5a52df0946/src/core/journal.ts#L206-L224)).
2. **Incremental index** — `src/core/index-store.ts` scans only `<sessionsRoot>/*/*.jsonl`, intentionally excluding deeper subagent trees. It stores lightweight session metadata and user prompts in a versioned cache. If file size and mtime are unchanged, it reuses the cached entry; only changed files are read and parsed, with bounded parallelism ([discovery](https://github.com/robwilde/omp-prompt-monitor/blob/28f4cdb7e8c360c2480a733442814f5a52df0946/src/core/index-store.ts#L65-L71); [cache reuse and persistence](https://github.com/robwilde/omp-prompt-monitor/blob/28f4cdb7e8c360c2480a733442814f5a52df0946/src/core/index-store.ts#L75-L114)). Assistant replies are excluded from the persisted index cache; full replies are loaded only for the selected session.
3. **Liveness** — the extension writes a heartbeat every 20 seconds. Heartbeats older than 60 seconds, or associated with a dead same-host PID, are removed ([heartbeat constants and cleanup](https://github.com/robwilde/omp-prompt-monitor/blob/28f4cdb7e8c360c2480a733442814f5a52df0946/src/core/heartbeat.ts#L5-L6); [heartbeat scan](https://github.com/robwilde/omp-prompt-monitor/blob/28f4cdb7e8c360c2480a733442814f5a52df0946/src/core/heartbeat.ts#L43-L80)). The snapshot labels a session **live** when a valid heartbeat exists, **recent** when there is no heartbeat but activity occurred within 15 minutes, and **idle** otherwise ([liveness calculation](https://github.com/robwilde/omp-prompt-monitor/blob/28f4cdb7e8c360c2480a733442814f5a52df0946/src/core/view.ts#L12-L13)).
4. **Snapshot and server** — `view.ts` combines the index and heartbeats, enriches sessions with repository information, groups them by git root or working directory, and sorts by activity ([snapshot assembly](https://github.com/robwilde/omp-prompt-monitor/blob/28f4cdb7e8c360c2480a733442814f5a52df0946/src/core/view.ts#L92-L138)). `server.ts` serves the dashboard and JSON API, caches snapshot work for three seconds, strips prompts from the list endpoint, and reparses full detail only for `/api/session/:id` ([routes](https://github.com/robwilde/omp-prompt-monitor/blob/28f4cdb7e8c360c2480a733442814f5a52df0946/src/server.ts#L128-L165)).

A small but important operational detail is the identity header. Every response identifies the server with `x-omp-monitor: 1`; a new invocation probes `/healthz` for that header before attempting to bind. Running `omp-monitor` or `/monitor` a second time therefore reuses the existing dashboard instead of creating a second listener ([identity probe and startup](https://github.com/robwilde/omp-prompt-monitor/blob/28f4cdb7e8c360c2480a733442814f5a52df0946/src/server.ts#L17-L22), [reuse path](https://github.com/robwilde/omp-prompt-monitor/blob/28f4cdb7e8c360c2480a733442814f5a52df0946/src/server.ts#L106-L116)).

### The `/monitor` plugin experience

The omp extension is intentionally thin. On `session_start`, it writes an immediate heartbeat and schedules the 20-second interval. On `session_shutdown`, it removes the heartbeat on a best-effort basis; stale-heartbeat cleanup covers abnormal exits ([HEAD extension lifecycle](https://github.com/robwilde/omp-prompt-monitor/blob/28f4cdb7e8c360c2480a733442814f5a52df0946/src/extension/index.ts#L222-L238)).

Running `/monitor` checks whether the dashboard is already available. If not, it starts a detached Bun process on port 7333, redirects its output to a dashboard log, waits through up to 20 readiness checks, and reports the dashboard URL. `/monitor stop`, `/monitor restart`, and `/monitor update` are also supported ([HEAD process startup](https://github.com/robwilde/omp-prompt-monitor/blob/28f4cdb7e8c360c2480a733442814f5a52df0946/src/extension/index.ts#L113-L148); [HEAD stop/restart handlers](https://github.com/robwilde/omp-prompt-monitor/blob/28f4cdb7e8c360c2480a733442814f5a52df0946/src/extension/index.ts#L158-L172); [HEAD update handler](https://github.com/robwilde/omp-prompt-monitor/blob/28f4cdb7e8c360c2480a733442814f5a52df0946/src/extension/index.ts#L174-L220); [HEAD command dispatch](https://github.com/robwilde/omp-prompt-monitor/blob/28f4cdb7e8c360c2480a733442814f5a52df0946/src/extension/index.ts#L240-L255)).

### Installation and usage

The README documents three ways to use the tool:

- **Hosted installer**: `curl -fsSL https://get.mrwilde.dev/setup | bash`. The installer validates the platform, ensures Bun `>=1.3.14`, installs the application under `~/.local/share/omp-prompt-monitor`, creates an `omp-monitor` launcher under `~/.local/bin`, updates the shell PATH when needed, and can be rerun to upgrade.
- **Repository checkout**: `bun run src/cli.ts` runs the raw TypeScript directly; there is no build or bundler step.
- **omp plugin**: `omp plugin link .` for a local checkout, or `omp install github:robwilde/omp-prompt-monitor` from GitHub. Restart omp after installing the extension, then run `/monitor`.

The standalone CLI supports `--port`, `--host`, `--open`, and `--json`. The default server is `http://127.0.0.1:7333`; `--open` launches the platform browser opener; `--json` prints the complete snapshot to stdout without starting a server ([CLI parsing](https://github.com/robwilde/omp-prompt-monitor/blob/28f4cdb7e8c360c2480a733442814f5a52df0946/src/cli.ts#L29-L59)).

### Security posture

The server binds to `127.0.0.1` by default. Passing `--host` is an explicit choice to expose it on another interface. The list snapshot strips prompts, but `/api/session/:id` and `omp-monitor --json` expose full prompt text from the configured session directory. The README correctly treats that data as sensitive: anyone able to reach an intentionally exposed server can read the prompt history, and JSON output should not be piped into logs, chat tools, or other destinations where the prompts would be disclosed.

### The development story

The commit history shows a focused build sequence:

1. **Foundation**: the package was scaffolded, then the journal reader, incremental index, snapshot view, HTTP server, CLI, and omp extension were built in that order ([initial commits](https://github.com/robwilde/omp-prompt-monitor/commits/main?after=2d4fc1b)).
2. **Hardening**: the cache returned to version 1 while excluding assistant replies, full session detail was added to the API, UI responsiveness improved, and tests expanded ([cache/privacy decision](https://github.com/robwilde/omp-prompt-monitor/commit/f425e6d); [detail API](https://github.com/robwilde/omp-prompt-monitor/commit/e949102)).
3. **Usability**: role filtering, footer update status, the hosted installer, clipboard feedback, branding, favicon support, and the static icon route were added ([clipboard](https://github.com/robwilde/omp-prompt-monitor/commit/85953b6); [branding PR](https://github.com/robwilde/omp-prompt-monitor/pull/2)).
4. **Quality gates**: pinned lint/typecheck tooling and CI checks were added for tests, lint, typecheck, and version bumps. The version gate requires a PR's package version to be newer than the base branch ([CI workflow](https://github.com/robwilde/omp-prompt-monitor/blob/28f4cdb7e8c360c2480a733442814f5a52df0946/.github/workflows/ci.yml); [CI PR](https://github.com/robwilde/omp-prompt-monitor/pull/4)).
5. **Final UI polish**: the journal column was brought into visual parity with the project/session cards and switched to newest-first ordering ([journal issue](https://github.com/robwilde/omp-prompt-monitor/issues/5); [journal PR](https://github.com/robwilde/omp-prompt-monitor/pull/6)).

## Code References

- [`src/core/journal.ts`](https://github.com/robwilde/omp-prompt-monitor/blob/28f4cdb7e8c360c2480a733442814f5a52df0946/src/core/journal.ts) — JSONL parsing, noise filtering, titles, and tail status.
- [`src/core/index-store.ts`](https://github.com/robwilde/omp-prompt-monitor/blob/28f4cdb7e8c360c2480a733442814f5a52df0946/src/core/index-store.ts) — incremental cache and bounded file processing.
- [`src/core/view.ts`](https://github.com/robwilde/omp-prompt-monitor/blob/28f4cdb7e8c360c2480a733442814f5a52df0946/src/core/view.ts) — liveness, grouping, and snapshots.
- [`src/core/heartbeat.ts`](https://github.com/robwilde/omp-prompt-monitor/blob/28f4cdb7e8c360c2480a733442814f5a52df0946/src/core/heartbeat.ts) — heartbeat persistence and stale cleanup.
- [`src/core/paths.ts`](https://github.com/robwilde/omp-prompt-monitor/blob/28f4cdb7e8c360c2480a733442814f5a52df0946/src/core/paths.ts) — environment and XDG path resolution.
- [`src/server.ts`](https://github.com/robwilde/omp-prompt-monitor/blob/28f4cdb7e8c360c2480a733442814f5a52df0946/src/server.ts) — routes, instance reuse, and snapshot caching.
- [`src/extension/index.ts`](https://github.com/robwilde/omp-prompt-monitor/blob/28f4cdb7e8c360c2480a733442814f5a52df0946/src/extension/index.ts) — omp lifecycle hooks and `/monitor`.
- [`src/client/index.html`](https://github.com/robwilde/omp-prompt-monitor/blob/28f4cdb7e8c360c2480a733442814f5a52df0946/src/client/index.html) — complete frontend: CSS, markup, state, rendering, polling.
- [`src/cli.ts`](https://github.com/robwilde/omp-prompt-monitor/blob/28f4cdb7e8c360c2480a733442814f5a52df0946/src/cli.ts) — CLI options and server/JSON dispatch.
- [`setup`](https://github.com/robwilde/omp-prompt-monitor/blob/28f4cdb7e8c360c2480a733442814f5a52df0946/setup) — user-scoped installer and launcher creation.
- [`.github/workflows/ci.yml`](https://github.com/robwilde/omp-prompt-monitor/blob/28f4cdb7e8c360c2480a733442814f5a52df0946/.github/workflows/ci.yml) — test, lint, typecheck, and version gates.
- [`README.md`](https://github.com/robwilde/omp-prompt-monitor/blob/28f4cdb7e8c360c2480a733442814f5a52df0946/README.md) — install, usage, security, and architecture overview.

## Architecture Insights

- **Layered and serializable**: journal → index → snapshot → server/client. The snapshot boundary is intentionally reusable by a future remote collector, though no remote collector exists yet.
- **Privacy is structural**: list responses omit prompts, the index cache omits assistant replies, and full detail is reparsed only when requested.
- **Graceful bulk behavior**: one corrupt journal or unreadable heartbeat does not take down the whole dashboard, while startup and cache-write failures remain visible.
- **Bun-native simplicity**: the project uses Bun APIs, ships raw TypeScript, has no client framework, and avoids runtime dependencies.
- **Instance reuse without a PID file**: the identity-bearing health probe lets CLI and plugin entry points converge on one local server.

## Historical Context (from thoughts/)

No prior `thoughts/` documents were present. This report is the first research document in the repository.

## Related Research

None.

## Open Questions

- Commit `802313f` introduced a workflow described as an automatic version bump on main pushes, but the current repository contains only `ci.yml`, whose version job is PR-only and checks that the version is already newer. The blog post should describe current behavior as a manual bump plus PR gate unless the release process has changed outside this checkout.
- The working tree contained uncommitted changes to `src/extension/index.ts` and `test/extension.test.ts` during research. They were intentionally excluded from the shipped commit narrative and report claims.
