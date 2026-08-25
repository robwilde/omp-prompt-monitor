import { describe, expect, test } from "bun:test";
import { bumpPatch } from "../scripts/bump-version";

describe("bumpPatch", () => {
	test("increments the patch component and preserves surrounding formatting", () => {
		const source = '{\n  "name": "x",\n  "version": "0.1.6",\n  "type": "module"\n}\n';
		const result = bumpPatch(source);
		expect(result.version).toBe("0.1.7");
		expect(result.text).toBe('{\n  "name": "x",\n  "version": "0.1.7",\n  "type": "module"\n}\n');
	});

	test("rejects a version that is not plain major.minor.patch", () => {
		expect(() => bumpPatch('{ "version": "0.1.6-beta" }')).toThrow("Unsupported package version: 0.1.6-beta");
	});

	test("rejects a package.json without a string version", () => {
		expect(() => bumpPatch('{ "name": "x" }')).toThrow("package.json has no string version");
	});
});
