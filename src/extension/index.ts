import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { HEARTBEAT_INTERVAL_MS, removeHeartbeat, writeHeartbeat } from "../core";
import { DEFAULT_PORT, formatUrl, probeExisting, type StopOutcome, stopExisting } from "../server";
import { repoSlug } from "../update";
import type { OmpApi, OmpCtx, OmpNotifyLevel } from "./omp-api";
import { findInstalledPlugin, isDevLink, runInstall } from "./update";

const POLL_ATTEMPTS = 20;
const POLL_INTERVAL_MS = 100;

async function sendHeartbeat(ctx: OmpCtx, startedAt: number): Promise<void> {
	const sessionFile = ctx.sessionManager.getSessionFile();
	if (sessionFile === undefined) return;
	try {
		await writeHeartbeat({
			sessionId: ctx.sessionManager.getSessionId(),
			sessionFile,
			cwd: ctx.sessionManager.getCwd(),
			pid: process.pid,
			host: os.hostname(),
			startedAt,
		});
	} catch {
		// Best-effort: a missed heartbeat writing just means one stale window in the dashboard.
	}
}

export type MonitorAction = "start" | "stop" | "restart" | "update";

export type UpdateOutcome =
	| { kind: "not-installed"; slug: string }
	| { kind: "dev-link"; path: string }
	| { kind: "omp-missing"; slug: string }
	| { kind: "install-failed"; output: string }
	| { kind: "updated"; from: string; to: string; url: string; alive: boolean };

export function parseMonitorAction(args: string): MonitorAction | null {
	const value = args.trim().toLowerCase();
	if (value === "") return "start";
	if (value === "stop" || value === "restart" || value === "update") return value;
	return null;
}

export function formatMonitorResult(url: string, alive: boolean): { message: string; level: OmpNotifyLevel } {
	return alive
		? { message: `Dashboard available at: ${url}`, level: "info" }
		: { message: "Failed to start dashboard", level: "error" };
}

export function formatUnknownAction(raw: string): { message: string; level: OmpNotifyLevel } {
	return {
		message: `Unknown /monitor action "${raw.trim()}" — use: stop, restart, update`,
		level: "error",
	};
}

export function formatStopResult(outcome: StopOutcome): { message: string; level: OmpNotifyLevel } {
	if (outcome === "stopped") return { message: "Dashboard stopped", level: "info" };
	if (outcome === "not-running") return { message: "Dashboard is not running", level: "info" };
	return { message: "Failed to stop dashboard", level: "error" };
}

export function formatRestartResult(url: string, alive: boolean): { message: string; level: OmpNotifyLevel } {
	return alive
		? { message: `Dashboard restarted at: ${url}`, level: "info" }
		: { message: "Failed to restart dashboard", level: "error" };
}

export function formatUpdateResult(outcome: UpdateOutcome): { message: string; level: OmpNotifyLevel } {
	switch (outcome.kind) {
		case "not-installed":
			return {
				message: `omp-prompt-monitor is not an installed omp plugin; run: omp install github:${outcome.slug}`,
				level: "error",
			};
		case "dev-link":
			return {
				message: `Plugin is linked to a dev checkout at ${outcome.path}; update it with: git -C ${outcome.path} pull`,
				level: "warning",
			};
		case "omp-missing":
			return {
				message: `omp CLI not found on PATH; run: omp install github:${outcome.slug}`,
				level: "error",
			};
		case "install-failed":
			return {
				message: `Update failed: ${outcome.output.split("\n").find((line) => line.trim().length > 0)?.slice(0, 200) ?? "no output"}`,
				level: "error",
			};
		case "updated": {
			if (!outcome.alive) {
				return { message: `Updated ${outcome.from} → ${outcome.to}; failed to restart dashboard`, level: "error" };
			}
			if (outcome.from === outcome.to) {
				return { message: `Already up to date (${outcome.to}); dashboard restarted at: ${outcome.url}`, level: "info" };
			}
			return {
				message: `Updated ${outcome.from} → ${outcome.to}; dashboard restarted at: ${outcome.url} · restart omp to load the updated extension`,
				level: "info",
			};
		}
	}
}

async function startDashboard(): Promise<boolean> {
	let alive = await probeExisting("127.0.0.1", DEFAULT_PORT);
	if (alive) return true;

	// `new URL(..., import.meta.url).pathname` would per-cent-encode spaces
	// (breaking a plugin installed under e.g. `~/My Plugins/…`) and yield a
	// `/C:/…`-style path on Windows; `import.meta.dir` gives an OS-native path.
	const cliPath = path.join(import.meta.dir, "..", "cli.ts");
	try {
		// `process.execPath` is unusable here: inside a compiled omp binary host,
		// it points at that binary (which rejects `cli.ts --port ...` as unknown
		// argv), not at a JS runtime that can execute the script.
		const bunPath = Bun.which("bun") ?? "bun";
		Bun.spawn([bunPath, cliPath, "--port", String(DEFAULT_PORT)], {
			stdio: ["ignore", "ignore", "ignore"],
			detached: true,
		}).unref();
	} catch {
		// Fall through: the poll loop below reports failure via ctx.ui.notify.
	}
	for (let attempt = 0; attempt < POLL_ATTEMPTS && !alive; attempt++) {
		await Bun.sleep(POLL_INTERVAL_MS);
		alive = await probeExisting("127.0.0.1", DEFAULT_PORT);
	}
	return alive;
}

async function startMonitorHandler(ctx: OmpCtx): Promise<void> {
	const url = formatUrl("127.0.0.1", DEFAULT_PORT);
	const alive = await startDashboard();
	if (!ctx.hasUI) return;
	const result = formatMonitorResult(url, alive);
	ctx.ui.notify(result.message, result.level);
}

async function stopMonitorHandler(ctx: OmpCtx): Promise<void> {
	const outcome = await stopExisting("127.0.0.1", DEFAULT_PORT);
	if (!ctx.hasUI) return;
	const result = formatStopResult(outcome);
	ctx.ui.notify(result.message, result.level);
}

async function restartMonitorHandler(ctx: OmpCtx): Promise<void> {
	const url = formatUrl("127.0.0.1", DEFAULT_PORT);
	await stopExisting("127.0.0.1", DEFAULT_PORT);
	const alive = await startDashboard();
	if (!ctx.hasUI) return;
	const result = formatRestartResult(url, alive);
	ctx.ui.notify(result.message, result.level);
}

async function updateMonitorHandler(ctx: OmpCtx): Promise<void> {
	const url = formatUrl("127.0.0.1", DEFAULT_PORT);
	const slug = repoSlug() ?? "robwilde/omp-prompt-monitor";

	const notify = (outcome: UpdateOutcome) => {
		if (!ctx.hasUI) return;
		const result = formatUpdateResult(outcome);
		ctx.ui.notify(result.message, result.level);
	};

	if (Bun.which("omp") === null) {
		notify({ kind: "omp-missing", slug });
		return;
	}

	const entry = await findInstalledPlugin();
	if (entry === null) {
		notify({ kind: "not-installed", slug });
		return;
	}

	if (await isDevLink(entry.path)) {
		notify({ kind: "dev-link", path: await fs.promises.realpath(entry.path) });
		return;
	}

	const from = entry.version;
	await stopExisting("127.0.0.1", DEFAULT_PORT);

	const install = await runInstall(slug);
	if (!install.ok) {
		await startDashboard();
		notify({ kind: "install-failed", output: install.output });
		return;
	}

	let to = from;
	try {
		const pkg = (await Bun.file(path.join(entry.path, "package.json")).json()) as Record<string, unknown>;
		if (typeof pkg.version === "string") to = pkg.version;
	} catch {
		// A mid-update read failure must not throw out of the command; fall back to `from`.
	}

	const alive = await startDashboard();
	notify({ kind: "updated", from, to, url, alive });
}

export default function ompPromptMonitor(pi: OmpApi): void {
	pi.on("session_start", (_event, ctx) => {
		if (ctx.sessionManager.getSessionFile() === undefined) return;
		const startedAt = Date.now();
		void sendHeartbeat(ctx, startedAt);
		ctx.setInterval(() => {
			void sendHeartbeat(ctx, startedAt);
		}, HEARTBEAT_INTERVAL_MS);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		try {
			await removeHeartbeat(ctx.sessionManager.getSessionId());
		} catch {
			// Best-effort: teardown has a 2000ms budget; a stale heartbeat file self-expires anyway.
		}
	});

	pi.registerCommand("monitor", {
		description: "Open the session prompt dashboard (stop | restart | update)",
		handler: async (args, ctx) => {
			const action = parseMonitorAction(args);
			if (action === null) {
				if (!ctx.hasUI) return;
				const result = formatUnknownAction(args);
				ctx.ui.notify(result.message, result.level);
				return;
			}
			if (action === "start") return startMonitorHandler(ctx);
			if (action === "stop") return stopMonitorHandler(ctx);
			if (action === "restart") return restartMonitorHandler(ctx);
			return updateMonitorHandler(ctx);
		},
	});
}
