import * as os from "node:os";
import * as path from "node:path";
import { HEARTBEAT_INTERVAL_MS, removeHeartbeat, writeHeartbeat } from "../core";
import { DEFAULT_PORT, formatUrl, probeExisting } from "../server";
import type { OmpApi, OmpCtx, OmpNotifyLevel } from "./omp-api";

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

export function formatMonitorResult(url: string, alive: boolean): { message: string; level: OmpNotifyLevel } {
	return alive
		? { message: `Dashboard available at: ${url}`, level: "info" }
		: { message: "Failed to start dashboard", level: "error" };
}

async function startMonitorHandler(ctx: OmpCtx): Promise<void> {
	const url = formatUrl("127.0.0.1", DEFAULT_PORT);

	let alive = await probeExisting("127.0.0.1", DEFAULT_PORT);
	if (!alive) {
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
	}

	if (!ctx.hasUI) return;
	const result = formatMonitorResult(url, alive);
	ctx.ui.notify(result.message, result.level);
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
		description: "Open the session prompt dashboard",
		handler: async (_args, ctx) => {
			await startMonitorHandler(ctx);
		},
	});
}
