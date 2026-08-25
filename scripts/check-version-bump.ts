import { CURRENT_VERSION, isNewerVersion } from "../src/update";

const GIT_SPAWN_TIMEOUT_MS = 15000;

async function runGit(args: string[]): Promise<string> {
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

async function baseVersion(ref: string): Promise<string> {
	await runGit(["fetch", "--no-tags", "--depth=1", "origin", ref]);
	const version = (JSON.parse(await runGit(["show", "FETCH_HEAD:package.json"])) as { version?: unknown }).version;
	if (typeof version !== "string") throw new Error(`origin/${ref} package.json has no string version`);
	return version;
}

const ref = process.env.GITHUB_BASE_REF ?? "main";
const base = await baseVersion(ref);

if (!isNewerVersion(CURRENT_VERSION, base)) {
	console.error(
		`package.json version ${CURRENT_VERSION} must be greater than ${ref}'s ${base}. Run \`bun run bump\` and commit the result.`,
	);
	process.exit(1);
}
console.log(`package.json version ${CURRENT_VERSION} is newer than ${ref}'s ${base}.`);
