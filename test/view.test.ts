import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { buildSnapshot } from "../src/core/view";

const originalStateHome = process.env.XDG_STATE_HOME;
const tempRoots: string[] = [];

afterEach(async () => {
	if (originalStateHome === undefined) delete process.env.XDG_STATE_HOME;
	else process.env.XDG_STATE_HOME = originalStateHome;
	await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("buildSnapshot", () => {
	test("counts user prompts separately from assistant replies", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-monitor-view-"));
		tempRoots.push(root);
		const stateHome = path.join(root, "state");
		await fs.mkdir(path.join(root, "sessions", "project"), { recursive: true });
		await fs.mkdir(path.join(stateHome, "omp-prompt-monitor"), { recursive: true });
		await Bun.write(path.join(root, "sessions", "project", "session.jsonl"), await Bun.file(new URL("./fixtures/assistant-replies.jsonl", import.meta.url)).text());
		process.env.XDG_STATE_HOME = stateHome;

		const snapshot = await buildSnapshot({ sessionsRoot: path.join(root, "sessions") });
		const session = snapshot.sessions[0];

		expect(session).toBeDefined();
		expect(session?.promptCount).toBe(2);
		expect(session?.prompts.filter((prompt) => prompt.kind === "reply")).toHaveLength(2);
	});
});
