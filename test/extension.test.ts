import { describe, expect, test } from "bun:test";
import { formatMonitorResult } from "../src/extension";
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
