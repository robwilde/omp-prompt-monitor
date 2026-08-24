import { describe, expect, test } from "bun:test";
import {
	formatMonitorResult,
	formatRestartResult,
	formatStopResult,
	formatUnknownAction,
	formatUpdateResult,
	parseMonitorAction,
} from "../src/extension";
import type { OmpNotifyLevel } from "../src/extension/omp-api";

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

describe("formatUnknownAction", () => {
	test("bogus action", () => {
		expect(formatUnknownAction("bogus")).toEqual({
			message: 'Unknown /monitor action "bogus" — use: stop, restart, update',
			level: "error",
		});
	});
});

describe("formatUpdateResult", () => {
	test("not-installed", () => {
		expect(formatUpdateResult({ kind: "not-installed", slug: "robwilde/omp-prompt-monitor" })).toEqual({
			message: "omp-prompt-monitor is not an installed omp plugin; run: omp install github:robwilde/omp-prompt-monitor",
			level: "error",
		});
	});
	test("dev-link", () => {
		expect(formatUpdateResult({ kind: "dev-link", path: "/dev/checkout" })).toEqual({
			message: "Plugin is linked to a dev checkout at /dev/checkout; update it with: git -C /dev/checkout pull",
			level: "warning",
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
