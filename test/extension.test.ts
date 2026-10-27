import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import ompPromptMonitor, {
	formatMonitorResult,
	formatRestartResult,
	formatStopResult,
	formatUnknownAction,
	formatUpdateResult,
	getMonitorCompletions,
	parseMonitorAction,
	restartDashboard,
} from "../src/extension";
import { createHeartbeatTracker } from "../src/extension/heartbeat-tracker";
import type { OmpCtx, OmpNotifyLevel } from "../src/extension/omp-api";

describe("formatMonitorResult", () => {
	test("success payload matches the /stats dashboard line", () => {
		expect(formatMonitorResult("http://127.0.0.1:7333", true)).toEqual({
			message: "Dashboard available at: http://127.0.0.1:7333",
			level: "info",
		});
	});

	test("failure payload routes through the error channel", () => {
		expect(formatMonitorResult("http://127.0.0.1:7333", false)).toEqual({
			message: "Failed to start dashboard",
			level: "error",
		});
	});

	test("failure payload includes the diagnostic log path", () => {
		expect(formatMonitorResult("http://127.0.0.1:7333", false, "/tmp/omp-prompt-monitor/dashboard.log")).toEqual({
			message: "Failed to start dashboard; see /tmp/omp-prompt-monitor/dashboard.log",
			level: "error",
		});
	});
});

describe("ctx.ui.notify contract", () => {
	test("a UI-enabled stub captures the exact message/level pairs, with no setStatus member", () => {
		const calls: Array<{ message: string; level?: OmpNotifyLevel }> = [];
		const ui = {
			notify(message: string, level?: OmpNotifyLevel) {
				calls.push({ message, level });
			},
		};

		expect("setStatus" in ui).toBe(false);

		const success = formatMonitorResult("http://127.0.0.1:7333", true);
		ui.notify(success.message, success.level);

		const failure = formatMonitorResult("http://127.0.0.1:7333", false);
		ui.notify(failure.message, failure.level);

		expect(calls).toEqual([
			{ message: "Dashboard available at: http://127.0.0.1:7333", level: "info" },
			{ message: "Failed to start dashboard", level: "error" },
		]);
	});
});

describe("parseMonitorAction", () => {
	test.each([
		["", "start"],
		["start", "start"],
		["  ", "start"],
		[" STOP ", "stop"],
		["restart", "restart"],
		["update", "update"],
		["bogus", null],
	] as const)("parseMonitorAction(%j) -> %j", (args, expected) => {
		expect(parseMonitorAction(args)).toBe(expected);
	});
});

describe("formatStopResult", () => {
	test("stopped", () => {
		expect(formatStopResult("stopped")).toEqual({ message: "Dashboard stopped", level: "info" });
	});
	test("not-running", () => {
		expect(formatStopResult("not-running")).toEqual({ message: "Dashboard is not running", level: "info" });
	});
	test("failed", () => {
		expect(formatStopResult("failed")).toEqual({ message: "Failed to stop dashboard", level: "error" });
	});
});

describe("formatRestartResult", () => {
	test("alive", () => {
		expect(formatRestartResult("http://127.0.0.1:7333", true)).toEqual({
			message: "Dashboard restarted at: http://127.0.0.1:7333",
			level: "info",
		});
	});
	test("not alive", () => {
		expect(formatRestartResult("http://127.0.0.1:7333", false)).toEqual({
			message: "Failed to restart dashboard",
			level: "error",
		});
	});
});

describe("restartDashboard", () => {
	test("does not start when stopping the old dashboard fails", async () => {
		let starts = 0;
		const result = await restartDashboard(
			async () => "failed",
			async () => {
				starts += 1;
				return { alive: true, logFile: "/tmp/dashboard.log" };
			},
		);

		expect(starts).toBe(0);
		expect(result).toEqual({ alive: false });
	});
});

describe("formatUnknownAction", () => {
	test("bogus action", () => {
		expect(formatUnknownAction("bogus")).toEqual({
			message: 'Unknown /monitor action "bogus" — use: start, stop, restart, update',
			level: "error",
		});
	});
});

describe("getMonitorCompletions", () => {
	test("empty prefix lists every action in table order with trailing-space values", () => {
		const items = getMonitorCompletions("");
		expect(items?.map(item => item.value)).toEqual(["start ", "stop ", "restart ", "update "]);
		expect(items?.map(item => item.label)).toEqual(["start", "stop", "restart", "update"]);
		expect(items?.every(item => item.description !== undefined && item.description !== "")).toBe(true);
	});

	test("prefix narrows the list", () => {
		expect(getMonitorCompletions("st")?.map(item => item.label)).toEqual(["start", "stop"]);
	});

	test("prefix match is case-insensitive", () => {
		expect(getMonitorCompletions("RE")?.map(item => item.label)).toEqual(["restart"]);
	});

	test("hint is the remainder of the action name", () => {
		expect(getMonitorCompletions("re")?.[0]?.hint).toBe("start");
		expect(getMonitorCompletions("restart")?.[0]?.hint).toBeUndefined();
	});

	test("returns null once past the action token", () => {
		expect(getMonitorCompletions("stop ")).toBeNull();
	});

	test("returns null when nothing matches", () => {
		expect(getMonitorCompletions("x")).toBeNull();
	});
});

describe("formatUpdateResult", () => {
	test("not-installed", () => {
		expect(formatUpdateResult({ kind: "not-installed", slug: "robwilde/omp-prompt-monitor" })).toEqual({
			message: "omp-prompt-monitor is not an installed omp plugin; run: omp install github:robwilde/omp-prompt-monitor",
			level: "error",
		});
	});
	test("dev-link with restarted dashboard", () => {
		expect(
			formatUpdateResult({
				kind: "dev-link",
				path: "/dev/checkout",
				version: "0.1.8",
				url: "http://127.0.0.1:7333",
				alive: true,
			}),
		).toEqual({
			message:
				"Dev checkout at /dev/checkout (v0.1.8); dashboard restarted at: http://127.0.0.1:7333 · pull latest with: git -C /dev/checkout pull",
			level: "warning",
		});
	});
	test("dev-link with failed dashboard restart", () => {
		expect(
			formatUpdateResult({
				kind: "dev-link",
				path: "/dev/checkout",
				version: "0.1.8",
				url: "http://127.0.0.1:7333",
				alive: false,
				logFile: "/tmp/omp-prompt-monitor/dashboard.log",
			}),
		).toEqual({
			message:
				"Dev checkout at /dev/checkout (v0.1.8); failed to restart dashboard; see /tmp/omp-prompt-monitor/dashboard.log · pull latest with: git -C /dev/checkout pull",
			level: "error",
		});
	});
	test("omp-missing", () => {
		expect(formatUpdateResult({ kind: "omp-missing", slug: "robwilde/omp-prompt-monitor" })).toEqual({
			message: "omp CLI not found on PATH; run: omp install github:robwilde/omp-prompt-monitor",
			level: "error",
		});
	});
	test("install-failed", () => {
		expect(formatUpdateResult({ kind: "install-failed", output: "\nboom\nmore" })).toEqual({
			message: "Update failed: boom",
			level: "error",
		});
	});

	test("updated, not alive, includes diagnostic log path", () => {
		expect(
			formatUpdateResult({
				kind: "updated",
				from: "0.1.0",
				to: "0.2.0",
				url: "http://127.0.0.1:7333",
				alive: false,
				logFile: "/tmp/omp-prompt-monitor/dashboard.log",
			}),
		).toEqual({
			message: "Updated 0.1.0 → 0.2.0; failed to restart dashboard; see /tmp/omp-prompt-monitor/dashboard.log",
			level: "error",
		});
	});
	test("updated, not alive", () => {
		expect(
			formatUpdateResult({ kind: "updated", from: "0.1.0", to: "0.2.0", url: "http://127.0.0.1:7333", alive: false }),
		).toEqual({
			message: "Updated 0.1.0 → 0.2.0; failed to restart dashboard",
			level: "error",
		});
	});
	test("updated, alive, already up to date", () => {
		expect(
			formatUpdateResult({ kind: "updated", from: "0.1.0", to: "0.1.0", url: "http://127.0.0.1:7333", alive: true }),
		).toEqual({
			message: "Already up to date (0.1.0); dashboard restarted at: http://127.0.0.1:7333",
			level: "info",
		});
	});
	test("updated, alive, version bumped", () => {
		expect(
			formatUpdateResult({ kind: "updated", from: "0.1.0", to: "0.2.0", url: "http://127.0.0.1:7333", alive: true }),
		).toEqual({
			message:
				"Updated 0.1.0 → 0.2.0; dashboard restarted at: http://127.0.0.1:7333 · restart omp to load the updated extension",
			level: "info",
		});
	});
});

describe("heartbeat session tracking", () => {
	test("/new swaps the heartbeat to the new session id immediately and shutdown leaves none behind", async () => {
		const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "omp-monitor-hb-"));
		const previousState = process.env.XDG_STATE_HOME;
		process.env.XDG_STATE_HOME = stateDir;
		try {
			const handlers = new Map<string, (event: unknown, ctx: OmpCtx) => unknown>();
			ompPromptMonitor({
				on: (event, handler) => void handlers.set(event, handler),
				registerCommand: () => {},
			});
			let sessionId = "session-a";
			const ctx: OmpCtx = {
				ui: { notify: () => {} },
				hasUI: false,
				sessionManager: {
					getSessionId: () => sessionId,
					getSessionFile: () => `/tmp/${sessionId}.jsonl`,
					getCwd: () => "/tmp",
				},
				setInterval: () => undefined,
			};
			const heartbeatDir = path.join(stateDir, "omp-prompt-monitor", "heartbeats");
			const files = () => (fs.existsSync(heartbeatDir) ? fs.readdirSync(heartbeatDir).sort() : []);
			// Heartbeat writes/removals are fire-and-forget; yield to real I/O until the directory reaches the expected state.
			const settleTo = async (expected: string[]) => {
				for (let i = 0; i < 500 && files().join() !== expected.join(); i++) await fs.promises.stat(stateDir);
				expect(files()).toEqual(expected);
			};

			handlers.get("session_start")?.({}, ctx);
			await settleTo(["session-a.json"]);

			sessionId = "session-b";
			handlers.get("session_switch")?.({}, ctx);
			await settleTo(["session-b.json"]);

			await handlers.get("session_shutdown")?.({}, ctx);
			expect(files()).toEqual([]);
		} finally {
			if (previousState === undefined) delete process.env.XDG_STATE_HOME;
			else process.env.XDG_STATE_HOME = previousState;
			fs.rmSync(stateDir, { recursive: true, force: true });
		}
	});

	test("a write for the previous session held in flight across a switch cannot recreate its file", async () => {
		const files = new Set<string>();
		const log: string[] = [];
		const gate = Promise.withResolvers<void>();
		const started = Promise.withResolvers<void>();
		const tracker = createHeartbeatTracker({
			write: async (hb) => {
				log.push(`write:${hb.sessionId}:start`);
				if (hb.sessionId === "a") {
					started.resolve();
					await gate.promise; // hold A's write in flight
				}
				files.add(hb.sessionId);
				log.push(`write:${hb.sessionId}:done`);
			},
			remove: async (id) => {
				files.delete(id);
				log.push(`remove:${id}`);
			},
		});
		const build = (id: string) => (startedAt: number) => ({
			sessionId: id,
			sessionFile: `/tmp/${id}.jsonl`,
			cwd: "/tmp",
			pid: 1,
			host: "h",
			startedAt,
		});

		tracker.beat("a", build("a"));
		await started.promise; // A's write is now blocked
		tracker.beat("b", build("b")); // switch: remove-A and write-B queue behind A's write
		expect(log).toEqual(["write:a:start"]);
		gate.resolve();
		// B's heartbeat is the observable signal that the switch finished; only B remains.
		for (let i = 0; i < 100 && !files.has("b"); i++) await Promise.resolve();
		expect(log).toEqual(["write:a:start", "write:a:done", "remove:a", "write:b:start", "write:b:done"]);
		expect([...files]).toEqual(["b"]);

		await tracker.shutdown([]);
		expect(log.at(-1)).toBe("remove:b");
		expect([...files]).toEqual([]);
	});

	test("shutdown stops waiting after the drain timeout when a write hangs", async () => {
		const hung = Promise.withResolvers<void>();
		const tracker = createHeartbeatTracker({ write: () => hung.promise, remove: async () => {} }, 20);
		tracker.beat("a", (startedAt) => ({ sessionId: "a", sessionFile: "/tmp/a.jsonl", cwd: "/tmp", pid: 1, host: "h", startedAt }));

		const began = performance.now();
		await tracker.shutdown([]);

		expect(performance.now() - began).toBeLessThan(1000);
		hung.resolve();
	});
});
