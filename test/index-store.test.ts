import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { createIndexStore } from "../src/core/index-store";

const tempRoots: string[] = [];

afterEach(async () => {
	await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("createIndexStore", () => {
	test("discards a cache written by an older parser version even when file size and mtime are unchanged", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-monitor-index-"));
		tempRoots.push(root);
		const sessionsRoot = path.join(root, "sessions");
		const file = path.join(sessionsRoot, "project", "session.jsonl");
		const cacheFile = path.join(root, "index-cache.json");
		await fs.mkdir(path.dirname(file), { recursive: true });
		await Bun.write(file, await Bun.file(new URL("./fixtures/slot-divergence.jsonl", import.meta.url)).text());
		const stat = await fs.stat(file);

		// Pre-0.1.10 cache: steering-flagged user input was filtered out, so this entry lacks the mid-stream prompt.
		const stalePrompt = { kind: "typed", text: "stale cached prompt", at: 1, atFromEntry: false };
		const stale = {
			v: 1,
			entries: [{ file, sizeBytes: stat.size, mtimeMs: stat.mtimeMs, id: "test-0001", prompts: [stalePrompt] }],
		};
		await Bun.write(cacheFile, JSON.stringify(stale));

		const [session] = await createIndexStore({ sessionsRoot, cacheFile }).refresh();

		expect(session?.prompts.map((prompt) => prompt.text)).toContain("typed while the agent was streaming");
		expect(session?.prompts.map((prompt) => prompt.text)).not.toContain("stale cached prompt");
	});

	test("reuses a current-version cache entry when file size and mtime are unchanged", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-monitor-index-"));
		tempRoots.push(root);
		const sessionsRoot = path.join(root, "sessions");
		const file = path.join(sessionsRoot, "project", "session.jsonl");
		const cacheFile = path.join(root, "index-cache.json");
		await fs.mkdir(path.dirname(file), { recursive: true });
		await Bun.write(file, await Bun.file(new URL("./fixtures/slot-divergence.jsonl", import.meta.url)).text());

		const store = createIndexStore({ sessionsRoot, cacheFile });
		await store.refresh();
		const cache = JSON.parse(await Bun.file(cacheFile).text());
		cache.entries[0].prompts[0].text = "marker from cache";
		await Bun.write(cacheFile, JSON.stringify(cache));

		const [session] = await store.refresh();

		expect(session?.prompts[0]?.text).toBe("marker from cache");
	});
});
