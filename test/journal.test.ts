import { describe, expect, test } from "bun:test";
import { parseSessionText } from "../src/core/journal";

describe("parseSessionText", () => {
	test("slot title wins over header, prompt selection excludes noise, tracks malformed lines", async () => {
		const text = await Bun.file(new URL("./fixtures/slot-divergence.jsonl", import.meta.url)).text();
		const parsed = parseSessionText(text);

		expect(parsed).not.toBeNull();
		expect(parsed?.title).toBe("user renamed");
		expect(parsed?.titleSource).toBe("user");
		expect(parsed?.prompts.length).toBe(2);
		expect(parsed?.prompts[0]?.kind).toBe("typed");
		expect(parsed?.prompts[0]?.at).toBe(1767225600000);
		expect(parsed?.prompts[0]?.atFromEntry).toBe(false);
		expect(parsed?.prompts[1]?.kind).toBe("skill");
		expect(parsed?.malformedLines).toBe(1);
	});

	test("legacy no-slot file derives title from the first prompt, truncated to 60 chars", async () => {
		const text = await Bun.file(new URL("./fixtures/legacy-no-slot.jsonl", import.meta.url)).text();
		const parsed = parseSessionText(text);

		expect(parsed).not.toBeNull();
		expect(parsed?.titleSource).toBe("derived");
		expect(parsed?.title).toBe("Please help me refactor this legacy authentication module so");
		expect(parsed?.title.length).toBeLessThanOrEqual(60);
		expect(parsed?.prompts.length).toBe(2);
	});

	test("non-JSON input is rejected", () => {
		expect(parseSessionText("not json")).toBeNull();
	});
});
