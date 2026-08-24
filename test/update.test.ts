import { describe, expect, test } from "bun:test";
import { computeUpdateStatus, isNewerVersion, repoSlug } from "../src/update";

describe("isNewerVersion", () => {
	test.each([
		["0.2.0", "0.1.0", true],
		["0.10.0", "0.9.0", true],
		["1.0.0", "0.9.9", true],
		["0.1.0", "0.1.0", false],
		["0.1.0", "0.2.0", false],
		["0.1.1-beta", "0.1.0", true],
	])("isNewerVersion(%s, %s) -> %s", (candidate, current, expected) => {
		expect(isNewerVersion(candidate, current)).toBe(expected);
	});
});

describe("repoSlug", () => {
	test("derives the owner/repo slug from package.json's repository url", () => {
		expect(repoSlug()).toBe("robwilde/omp-prompt-monitor");
	});
});

describe("computeUpdateStatus", () => {
	test("reports an available update when the remote version is newer", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async () => new Response(JSON.stringify({ version: "9.9.9" }))) as unknown as typeof fetch;
		try {
			const status = await computeUpdateStatus();
			expect(status.latest).toBe("9.9.9");
			expect(status.updateAvailable).toBe(true);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test("degrades to no update available when the fetch fails", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async () => new Response("", { status: 404 })) as unknown as typeof fetch;
		try {
			const status = await computeUpdateStatus();
			expect(status.latest).toBeNull();
			expect(status.updateAvailable).toBe(false);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});
