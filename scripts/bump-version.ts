const PACKAGE_JSON = new URL("../package.json", import.meta.url);

export interface BumpResult {
	text: string;
	version: string;
}

/** Patch-bumps the `version` field of `text` with a string replace, so the file's formatting survives. */
export function bumpPatch(text: string): BumpResult {
	const current = (JSON.parse(text) as { version?: unknown }).version;
	if (typeof current !== "string") throw new Error("package.json has no string version");
	const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(current);
	if (match === null) throw new Error(`Unsupported package version: ${current}`);
	const version = `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
	const updated = text.replace(`"version": "${current}"`, `"version": "${version}"`);
	if (updated === text) throw new Error("Could not locate package version field");
	return { text: updated, version };
}

if (import.meta.main) {
	const { text, version } = bumpPatch(await Bun.file(PACKAGE_JSON).text());
	await Bun.write(PACKAGE_JSON, text);
	console.log(version);
}
