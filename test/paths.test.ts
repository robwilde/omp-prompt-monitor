import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { resolveHistoryDb, resolveSessionsRoot } from "../src/core/paths";

const home = os.homedir();

describe("resolveSessionsRoot", () => {
	test("PI_CODING_AGENT_DIR overrides the agent dir", () => {
		expect(resolveSessionsRoot({ PI_CODING_AGENT_DIR: "/custom" })).toBe(path.join("/custom", "sessions"));
	});

	test("OMP_PROFILE selects a profile-scoped agent dir", () => {
		expect(resolveSessionsRoot({ OMP_PROFILE: "work" })).toBe(
			path.join(home, ".omp", "profiles", "work", "agent", "sessions"),
		);
	});

	test("PI_CONFIG_DIR renames the default config dir", () => {
		expect(resolveSessionsRoot({ PI_CONFIG_DIR: ".ompdev" })).toBe(path.join(home, ".ompdev", "agent", "sessions"));
	});

	test("empty env resolves the plain default", () => {
		expect(resolveSessionsRoot({})).toBe(path.join(home, ".omp", "agent", "sessions"));
	});

	test("OMP_PROFILE=default resolves identically to no profile, matching where omp writes sessions", () => {
		expect(resolveSessionsRoot({ OMP_PROFILE: "default" })).toBe(path.join(home, ".omp", "agent", "sessions"));
	});

	test("whitespace-only OMP_PROFILE resolves identically to no profile", () => {
		expect(resolveSessionsRoot({ OMP_PROFILE: "   " })).toBe(path.join(home, ".omp", "agent", "sessions"));
	});

	test("a custom PI_CODING_AGENT_DIR survives a bypassed PI_PROFILE when OMP_PROFILE selects default", () => {
		expect(resolveSessionsRoot({ OMP_PROFILE: "", PI_PROFILE: "work", PI_CODING_AGENT_DIR: "/custom" })).toBe(
			path.join("/custom", "sessions"),
		);
	});

	test("PI_CODING_AGENT_DIR is ignored when a named profile is active", () => {
		expect(resolveSessionsRoot({ OMP_PROFILE: "work", PI_CODING_AGENT_DIR: "/custom" })).toBe(
			path.join(home, ".omp", "profiles", "work", "agent", "sessions"),
		);
	});

	test("a profile-derived PI_CODING_AGENT_DIR is dropped when OMP_PROFILE explicitly selects default", () => {
		const derived = path.join(home, ".omp", "profiles", "work", "agent");
		expect(resolveSessionsRoot({ OMP_PROFILE: "", PI_PROFILE: "work", PI_CODING_AGENT_DIR: derived })).toBe(
			path.join(home, ".omp", "agent", "sessions"),
		);
	});

	test("an invalid profile name falls back to the default profile instead of joining into a path", () => {
		expect(resolveSessionsRoot({ OMP_PROFILE: "../x" })).toBe(path.join(home, ".omp", "agent", "sessions"));
	});

	test("a Windows reserved device name is rejected like omp does, falling back to the default profile", () => {
		expect(resolveSessionsRoot({ OMP_PROFILE: "nul" })).toBe(path.join(home, ".omp", "agent", "sessions"));
	});

	describe.skipIf(process.platform !== "linux" && process.platform !== "darwin")("XDG data home", () => {
		let xdg = "";
		beforeAll(() => {
			xdg = fs.mkdtempSync(path.join(os.tmpdir(), "omp-monitor-xdg-"));
			fs.mkdirSync(path.join(xdg, "omp", "profiles", "work"), { recursive: true });
		});
		afterAll(() => fs.rmSync(xdg, { recursive: true, force: true }));

		test("default agent dir flattens agent/ under $XDG_DATA_HOME/omp", () => {
			expect(resolveSessionsRoot({ XDG_DATA_HOME: xdg })).toBe(path.join(xdg, "omp", "sessions"));
		});

		test("an explicit PI_CODING_AGENT_DIR equal to the default still uses XDG", () => {
			const env = { XDG_DATA_HOME: xdg, PI_CODING_AGENT_DIR: path.join(home, ".omp", "agent") };
			expect(resolveSessionsRoot(env)).toBe(path.join(xdg, "omp", "sessions"));
		});

		test("a custom PI_CODING_AGENT_DIR disables XDG", () => {
			expect(resolveSessionsRoot({ XDG_DATA_HOME: xdg, PI_CODING_AGENT_DIR: "/custom" })).toBe(
				path.join("/custom", "sessions"),
			);
		});

		test("a named profile uses $XDG_DATA_HOME/omp/profiles/<name> when that directory exists", () => {
			expect(resolveSessionsRoot({ XDG_DATA_HOME: xdg, OMP_PROFILE: "work" })).toBe(
				path.join(xdg, "omp", "profiles", "work", "sessions"),
			);
		});

		test("a named profile without its own XDG directory stays under ~/.omp even if the XDG app root exists", () => {
			expect(resolveSessionsRoot({ XDG_DATA_HOME: xdg, OMP_PROFILE: "other" })).toBe(
				path.join(home, ".omp", "profiles", "other", "agent", "sessions"),
			);
		});
	});
});

describe("resolveHistoryDb", () => {
	test("empty env resolves to ~/.omp/agent/history.db", () => {
		expect(resolveHistoryDb({})).toBe(path.join(home, ".omp", "agent", "history.db"));
	});

	test("PI_CODING_AGENT_DIR overrides the agent dir", () => {
		expect(resolveHistoryDb({ PI_CODING_AGENT_DIR: "/custom" })).toBe(path.join("/custom", "history.db"));
	});

	test("OMP_PROFILE selects a profile-scoped agent dir", () => {
		expect(resolveHistoryDb({ OMP_PROFILE: "work" })).toBe(
			path.join(home, ".omp", "profiles", "work", "agent", "history.db"),
		);
	});

	test("PI_CONFIG_DIR renames the default config dir", () => {
		expect(resolveHistoryDb({ PI_CONFIG_DIR: ".ompdev" })).toBe(path.join(home, ".ompdev", "agent", "history.db"));
	});

	describe.skipIf(process.platform !== "linux" && process.platform !== "darwin")("XDG data home", () => {
		let xdg = "";
		beforeAll(() => {
			xdg = fs.mkdtempSync(path.join(os.tmpdir(), "omp-monitor-xdg-"));
			fs.mkdirSync(path.join(xdg, "omp", "profiles", "work"), { recursive: true });
		});
		afterAll(() => fs.rmSync(xdg, { recursive: true, force: true }));

		test("default agent dir flattens agent/ under $XDG_DATA_HOME/omp", () => {
			expect(resolveHistoryDb({ XDG_DATA_HOME: xdg })).toBe(path.join(xdg, "omp", "history.db"));
		});

		test("a custom PI_CODING_AGENT_DIR disables XDG", () => {
			expect(resolveHistoryDb({ XDG_DATA_HOME: xdg, PI_CODING_AGENT_DIR: "/custom" })).toBe(
				path.join("/custom", "history.db"),
			);
		});

		test("a named profile uses $XDG_DATA_HOME/omp/profiles/<name> when that directory exists", () => {
			expect(resolveHistoryDb({ XDG_DATA_HOME: xdg, OMP_PROFILE: "work" })).toBe(
				path.join(xdg, "omp", "profiles", "work", "history.db"),
			);
		});

		test("always sits next to the sessions root", () => {
			const env = { XDG_DATA_HOME: xdg, OMP_PROFILE: "work" };
			expect(path.dirname(resolveHistoryDb(env))).toBe(path.dirname(resolveSessionsRoot(env)));
		});
	});
});
