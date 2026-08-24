import { describe, expect, test } from "bun:test";
import * as os from "node:os";
import * as path from "node:path";
import { resolveSessionsRoot } from "../src/core/paths";

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
});
