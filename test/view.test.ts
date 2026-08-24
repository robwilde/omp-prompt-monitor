import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { buildSnapshot, loadSessionPrompts } from "../src/core";

const originalStateHome = process.env.XDG_STATE_HOME;
const tempRoots: string[] = [];

afterEach(async () => {
	if (originalStateHome === undefined) delete process.env.XDG_STATE_HOME;
	else process.env.XDG_STATE_HOME = originalStateHome;
	await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("buildSnapshot", () => {
	test("keeps replies out of snapshot index while loading them on demand", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-monitor-view-"));
		tempRoots.push(root);
		const stateHome = path.join(root, "state");
		const sessionsRoot = path.join(root, "sessions");
		const file = path.join(sessionsRoot, "project", "session.jsonl");
		await fs.mkdir(path.dirname(file), { recursive: true });
		await fs.mkdir(path.join(stateHome, "omp-prompt-monitor"), { recursive: true });
		await Bun.write(file, await Bun.file(new URL("./fixtures/assistant-replies.jsonl", import.meta.url)).text());
		process.env.XDG_STATE_HOME = stateHome;

		const snapshot = await buildSnapshot({ sessionsRoot });
		const session = snapshot.sessions[0];

		expect(session).toBeDefined();
		expect(session?.promptCount).toBe(2);
		expect(session?.messageCount).toBe(4);
		expect(session?.prompts).toHaveLength(2);
		expect(session?.prompts.some((prompt) => prompt.kind === "reply")).toBe(false);
		const cache = JSON.parse(await Bun.file(path.join(stateHome, "omp-prompt-monitor", "index-cache.json")).text());
		expect(cache.v).toBe(1);
		expect(cache.entries[0].prompts).toHaveLength(2);
		expect(cache.entries[0].prompts.some((prompt: { kind: string }) => prompt.kind === "reply")).toBe(false);

		const detailPrompts = await loadSessionPrompts(session!);
		expect(detailPrompts.map((prompt) => prompt.kind)).toEqual(["reply", "typed", "reply", "skill"]);

		const fallback = await loadSessionPrompts({ file: path.join(root, "missing.jsonl"), prompts: session!.prompts });
		expect(fallback).toEqual(session!.prompts);
	});
});
