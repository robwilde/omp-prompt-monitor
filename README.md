# omp-prompt-monitor

A local dashboard for [Oh My Pi](https://github.com/can1357/oh-my-pi) sessions: every session across every project, grouped by project, with each user prompt and its timestamp.

## Security

- The dashboard server binds `127.0.0.1` only. It is never exposed to the network.
- The snapshot it serves (`/api/snapshot`, `/api/session/:id`) contains **full prompt text** read from `~/.omp/agent/sessions` (or your configured agent directory). Anything you typed to omp is readable through this server for as long as it runs.
- `omp-monitor --json` prints the same data to stdout. Treat its output as sensitive — do not pipe it into logs, chat tools, or anywhere else you wouldn't paste your prompt history.

## Usage

```bash
bunx omp-prompt-monitor
# Dashboard available at: http://127.0.0.1:7333
```

```bash
omp-monitor --port 8080 --open   # custom port, opens your browser
omp-monitor --json > snapshot.json
```

## Install as an omp extension

Local development:

```bash
omp plugin link ./omp-prompt-monitor
```

Restart omp (newly installed extension modules require a restart — `/reload-plugins` does not rebuild initialized extensions), then run `/monitor` inside a session. It starts the standalone dashboard server if one isn't already running, and marks the current session `live` via a periodic heartbeat file until you exit.

Share with other developers:

```bash
omp install github:<owner>/omp-prompt-monitor
```

Direct `omp install omp-prompt-monitor` works once this package is published to npm.

## How it works

- **Reader** (`src/core/journal.ts`): parses one session `.jsonl` file — title slot, header, and every real user prompt (typed messages and skill invocations), skipping synthetic/steering/agent-attributed noise.
- **Index** (`src/core/index-store.ts`): incrementally re-parses only files whose size/mtime changed since the last run, cached at `<state dir>/index-cache.json`.
- **Snapshot** (`src/core/view.ts`): the reader → snapshot boundary. Pure and serializable, so a future remote collector can reuse it without restructuring anything upstream.
- **Server** (`src/server.ts`): serves the snapshot and the HTML client over `/api/snapshot` and `/api/session/:id`, with an identity header so a second `omp-monitor` invocation detects and reuses an already-running instance instead of binding a second port.
- **Extension** (`src/extension/index.ts`): a thin omp plugin that writes a heartbeat file for the current session (so the dashboard can distinguish "live" from merely "recently active") and adds the `/monitor` command.

Scope is deliberately top-level sessions only (`<sessionsRoot>/*/*.jsonl`) — it does not recurse into subagent/advisor session trees.
