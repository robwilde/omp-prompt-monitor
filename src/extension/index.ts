import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { HEARTBEAT_INTERVAL_MS, type HeartbeatInput, removeHeartbeat, resolveDashboardLogFile, writeHeartbeat } from "../core";
import { DEFAULT_PORT, formatUrl, probeExisting, type StopOutcome, stopExisting } from "../server";
import { repoSlug } from "../update";
import { createHeartbeatTracker } from "./heartbeat-tracker";
import type { OmpApi, OmpAutocompleteItem, OmpCtx, OmpNotifyLevel } from "./omp-api";
import { findInstalledPlugin, isDevLink, runInstall } from "./update";

const POLL_ATTEMPTS = 20;
const POLL_INTERVAL_MS = 100;

/** Captures the session identity synchronously so a queued write can never pick up a later session's id. */
function snapshotHeartbeat(ctx: OmpCtx, startedAt: number): HeartbeatInput | undefined {
	const sessionFile = ctx.sessionManager.getSessionFile();
	if (sessionFile === undefined) return undefined;
	return {
		sessionId: ctx.sessionManager.getSessionId(),
		sessionFile,
		cwd: ctx.sessionManager.getCwd(),
		pid: process.pid,
		host: os.hostname(),
		startedAt,
	};
}

const MONITOR_ACTIONS = [
	{ name: "start", description: "Start the dashboard if needed and show its URL (default)" },
	{ name: "stop", description: "Stop the running dashboard server" },
	{ name: "restart", description: "Restart the dashboard server" },
	{ name: "update", description: "Update the plugin and restart the dashboard" },
] as const satisfies readonly { name: string; description: string }[];

export type MonitorAction = (typeof MONITOR_ACTIONS)[number]["name"];

export type UpdateOutcome =
	| { kind: "not-installed"; slug: string }
	| { kind: "dev-link"; path: string; version: string; url: string; alive: boolean; logFile?: string }
	| { kind: "omp-missing"; slug: string }
	| { kind: "install-failed"; output: string }
	| { kind: "updated"; from: string; to: string; url: string; alive: boolean; logFile?: string };

export function parseMonitorAction(args: string): MonitorAction | null {
	const value = args.trim().toLowerCase();
	if (value === "") return "start";
	return MONITOR_ACTIONS.find(action => action.name === value)?.name ?? null;
}

/** Completes the first `/monitor` argument against the action table, mirroring omp's built-in sub-command completer. */
export function getMonitorCompletions(argumentPrefix: string): OmpAutocompleteItem[] | null {
	if (argumentPrefix.includes(" ")) return null;
	const lower = argumentPrefix.toLowerCase();
	const items = MONITOR_ACTIONS.filter(action => action.name.startsWith(lower)).map(action => ({
		value: `${action.name} `,
		label: action.name,
		description: action.description,
		hint: action.name.slice(lower.length) || undefined,
	}));
	return items.length > 0 ? items : null;
}

export function formatMonitorResult(url: string, alive: boolean, logFile?: string): { message: string; level: OmpNotifyLevel } {
	if (alive) return { message: `Dashboard available at: ${url}`, level: "info" };
	return {
		message: logFile ? `Failed to start dashboard; see ${logFile}` : "Failed to start dashboard",
		level: "error",
	};
}

export function formatUnknownAction(raw: string): { message: string; level: OmpNotifyLevel } {
	return {
		message: `Unknown /monitor action "${raw.trim()}" — use: ${MONITOR_ACTIONS.map(action => action.name).join(", ")}`,
		level: "error",
	};
}

export function formatStopResult(outcome: StopOutcome): { message: string; level: OmpNotifyLevel } {
	if (outcome === "stopped") return { message: "Dashboard stopped", level: "info" };
	if (outcome === "not-running") return { message: "Dashboard is not running", level: "info" };
	return { message: "Failed to stop dashboard", level: "error" };
}

export function formatRestartResult(url: string, alive: boolean, logFile?: string): { message: string; level: OmpNotifyLevel } {
	if (alive) return { message: `Dashboard restarted at: ${url}`, level: "info" };
	return {
		message: logFile ? `Failed to restart dashboard; see ${logFile}` : "Failed to restart dashboard",
		level: "error",
	};
}

export function formatUpdateResult(outcome: UpdateOutcome): { message: string; level: OmpNotifyLevel } {
	switch (outcome.kind) {
		case "not-installed":
			return {
				message: `omp-prompt-monitor is not an installed omp plugin; run: omp install github:${outcome.slug}`,
				level: "error",
			};
		case "dev-link": {
			const pullHint = `git -C ${outcome.path} pull`;
			if (!outcome.alive) {
				const detail = outcome.logFile ? `; see ${outcome.logFile}` : "";
				return {
					message: `Dev checkout at ${outcome.path} (v${outcome.version}); failed to restart dashboard${detail} · pull latest with: ${pullHint}`,
					level: "error",
				};
			}
			return {
				message: `Dev checkout at ${outcome.path} (v${outcome.version}); dashboard restarted at: ${outcome.url} · pull latest with: ${pullHint}`,
				level: "warning",
			};
		}
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
				const detail = outcome.logFile ? `; see ${outcome.logFile}` : "";
				return { message: `Updated ${outcome.from} → ${outcome.to}; failed to restart dashboard${detail}`, level: "error" };
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

async function startDashboard(): Promise<{ alive: boolean; logFile: string }> {
	const logFile = resolveDashboardLogFile();
	let alive = await probeExisting("127.0.0.1", DEFAULT_PORT);
	if (alive) return { alive, logFile };

	// `new URL(..., import.meta.url).pathname` would per-cent-encode spaces
	// (breaking a plugin installed under e.g. `~/My Plugins/…`) and yield a
	// `/C:/…`-style path on Windows; `import.meta.dir` gives an OS-native path.
	const cliPath = path.join(import.meta.dir, "..", "cli.ts");
	let logReady = false;
	try {
		await fs.promises.mkdir(path.dirname(logFile), { recursive: true });
		await Bun.write(logFile, "");
		logReady = true;
	} catch {}
	try {
		// `process.execPath` is unusable here: inside a compiled omp binary host,
		// it points at that binary (which rejects `cli.ts --port ...` as unknown
		// argv), not at a JS runtime that can execute the script.
		const bunPath = Bun.which("bun") ?? "bun";
		Bun.spawn([bunPath, cliPath, "--port", String(DEFAULT_PORT)], {
			stdio: ["ignore", "ignore", logReady ? Bun.file(logFile) : "ignore"],
			detached: true,
		}).unref();
	} catch (error) {
		try {
			const detail = error instanceof Error ? error.stack ?? error.message : String(error);
			await Bun.write(logFile, `${detail}\n`);
		} catch {}
	}
	for (let attempt = 0; attempt < POLL_ATTEMPTS && !alive; attempt++) {
		await Bun.sleep(POLL_INTERVAL_MS);
		alive = await probeExisting("127.0.0.1", DEFAULT_PORT);
	}
	return { alive, logFile };
}

type DashboardStart = () => Promise<{ alive: boolean; logFile: string }>;

export async function restartDashboard(
	stop: () => Promise<StopOutcome> = () => stopExisting("127.0.0.1", DEFAULT_PORT),
	start: DashboardStart = startDashboard,
): Promise<{ alive: boolean; logFile?: string }> {
	const stopOutcome = await stop();
	if (stopOutcome === "failed") return { alive: false };
	return start();
}

async function startMonitorHandler(ctx: OmpCtx): Promise<void> {
	const url = formatUrl("127.0.0.1", DEFAULT_PORT);
	const { alive, logFile } = await startDashboard();
	if (!ctx.hasUI) return;
	const result = formatMonitorResult(url, alive, logFile);
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
	const { alive, logFile } = await startDashboard();
	if (!ctx.hasUI) return;
	const result = formatRestartResult(url, alive, logFile);
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
		const devPath = await fs.promises.realpath(entry.path);
		const { alive, logFile } = await restartDashboard();
		notify({ kind: "dev-link", path: devPath, version: entry.version, url, alive, logFile });
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

	const { alive, logFile } = await startDashboard();
	notify({ kind: "updated", from, to, url, alive, logFile });
}

export default function ompPromptMonitor(pi: OmpApi): void {
	const tracker = createHeartbeatTracker({ write: writeHeartbeat, remove: removeHeartbeat });

	// Reads the live session identity on every beat: `session_start` fires once per session
	// runtime, while /new, /resume and fork swap the session under the same ctx.
	const beat = (ctx: OmpCtx): void => {
		tracker.beat(ctx.sessionManager.getSessionId(), (startedAt) => snapshotHeartbeat(ctx, startedAt));
	};

	pi.on("session_start", (_event, ctx) => {
		if (ctx.sessionManager.getSessionFile() === undefined) return;
		beat(ctx);
		ctx.setInterval(() => beat(ctx), HEARTBEAT_INTERVAL_MS);
	});

	pi.on("session_switch", (_event, ctx) => beat(ctx));
	pi.on("session_branch", (_event, ctx) => beat(ctx));

	pi.on("session_shutdown", (_event, ctx) => tracker.shutdown([ctx.sessionManager.getSessionId()]));

	pi.registerCommand("monitor", {
		description: `Open the session prompt dashboard (${MONITOR_ACTIONS.filter(action => action.name !== "start")
			.map(action => action.name)
			.join(" | ")})`,
		getArgumentCompletions: getMonitorCompletions,
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
