import { CURRENT_VERSION, isNewerVersion } from "../src/update";

const GIT_SPAWN_TIMEOUT_MS = 15000;

export async function runGit(args: string[]): Promise<string> {
	const proc = Bun.spawn(["git", ...args], {
		stdout: "pipe",
		stderr: "pipe",
		signal: AbortSignal.timeout(GIT_SPAWN_TIMEOUT_MS),
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	if (exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${stderr.trim()}`);
	return stdout;
}

/** Reads the `version` field out of a package.json document, rejecting a missing or non-string field. */
export function parseBaseVersion(text: string, ref: string): string {
	const version = (JSON.parse(text) as { version?: unknown }).version;
	if (typeof version !== "string") throw new Error(`origin/${ref} package.json has no string version`);
	return version;
}

export async function baseVersion(ref: string): Promise<string> {
	await runGit(["fetch", "--no-tags", "--depth=1", "origin", ref]);
	return parseBaseVersion(await runGit(["show", "FETCH_HEAD:package.json"]), ref);
}

export interface BumpCheck {
	ok: boolean;
	message: string;
}

export function evaluateBump(current: string, base: string, ref: string): BumpCheck {
	if (isNewerVersion(current, base)) {
		return { ok: true, message: `package.json version ${current} is newer than ${ref}'s ${base}.` };
	}
	return {
		ok: false,
		message: `package.json version ${current} must be greater than ${ref}'s ${base}. Run \`bun run bump\` and commit the result.`,
	};
}

if (import.meta.main) {
	const ref = process.env.GITHUB_BASE_REF ?? "main";
	const check = evaluateBump(CURRENT_VERSION, await baseVersion(ref), ref);
	if (!check.ok) {
		console.error(check.message);
		process.exit(1);
	}
	console.log(check.message);
}
