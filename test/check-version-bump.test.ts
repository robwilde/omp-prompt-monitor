import { describe, expect, test } from "bun:test";
import { evaluateBump, parseBaseVersion, resolveBaseRef, runGit } from "../scripts/check-version-bump";

describe("resolveBaseRef", () => {
	test("falls back to main when the variable is unset", () => {
		expect(resolveBaseRef(undefined)).toBe("main");
	});

	test("falls back to main when Actions exports an empty base ref", () => {
		expect(resolveBaseRef("")).toBe("main");
	});

	test("uses the pull request base ref when present", () => {
		expect(resolveBaseRef("release/2.x")).toBe("release/2.x");
	});
});

describe("parseBaseVersion", () => {
	test("reads the version field", () => {
		expect(parseBaseVersion('{ "version": "1.2.3" }', "main")).toBe("1.2.3");
	});

	test("rejects a base package.json without a version", () => {
		expect(() => parseBaseVersion('{ "name": "x" }', "main")).toThrow("origin/main package.json has no string version");
	});

	test("names the ref it was reading when the version is not a string", () => {
		expect(() => parseBaseVersion('{ "version": 7 }', "release/2.x")).toThrow(
			"origin/release/2.x package.json has no string version",
		);
	});
});

describe("evaluateBump", () => {
	test("accepts a patch bump", () => {
		const check = evaluateBump("0.1.7", "0.1.6", "main");
		expect(check.ok).toBe(true);
		expect(check.message).toBe("package.json version 0.1.7 is newer than main's 0.1.6.");
	});

	test("accepts a minor bump and a major bump", () => {
		expect(evaluateBump("0.2.0", "0.1.9", "main").ok).toBe(true);
		expect(evaluateBump("1.0.0", "0.9.9", "main").ok).toBe(true);
	});

	test("rejects an unchanged version and says how to fix it", () => {
		const check = evaluateBump("0.1.6", "0.1.6", "main");
		expect(check.ok).toBe(false);
		expect(check.message).toBe(
			"package.json version 0.1.6 must be greater than main's 0.1.6. Run `bun run bump` and commit the result.",
		);
	});

	test("rejects a downgrade", () => {
		expect(evaluateBump("0.1.5", "0.1.6", "main").ok).toBe(false);
	});
});

describe("runGit", () => {
	test("returns stdout for a successful invocation", async () => {
		expect(await runGit(["--version"])).toContain("git version");
	});

	test("throws with the failing command and its stderr", async () => {
		await expect(runGit(["no-such-subcommand"])).rejects.toThrow("git no-such-subcommand failed:");
	});
});
