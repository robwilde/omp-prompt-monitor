import { describe, expect, test } from "bun:test";
import { parseSessionText } from "../src/core";
import { withPortableText } from "../src/core";

describe("withPortableText", () => {
	test("strips omp scaffolding from skill rows, keeps typed and reply rows verbatim", async () => {
		const text = await Bun.file(new URL("./fixtures/skill-args.jsonl", import.meta.url)).text();
		const parsed = parseSessionText(text);
		expect(parsed).not.toBeNull();
		const prompts = parsed!.prompts;
		const portable = withPortableText(prompts);

		expect(portable[0]).toBe(prompts[0]);
		expect(portable[1]?.copyText).toBe("Plan the copy button work.");
		expect(portable[2]?.copyText).toBe("# TDD\n\nWrite the test first.");
		expect(portable[3]?.copyText).toBe("# Session Devlog Skill\n\nAppend a devlog entry.");
	});

	test("returns reply rows by identity", () => {
		const replyRow = { entryId: "r1", parentId: null, kind: "reply" as const, text: "Reply body.", at: 0, atFromEntry: true };
		const [portable] = withPortableText([replyRow]);
		expect(portable).toBe(replyRow);
	});
});
