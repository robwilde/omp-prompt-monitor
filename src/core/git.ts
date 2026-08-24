import * as path from "node:path";

export interface RepoInfo {
	repoRoot: string | null;
	remoteUrl: string | null;
	/** Basename of repoRoot, or of cwd when not a repo. */
	label: string;
}

const GIT_SPAWN_TIMEOUT_MS = 2000;

async function runGit(args: string[], cwd: string): Promise<string | null> {
	try {
		const proc = Bun.spawn(["git", ...args], {
			cwd,
			stdout: "pipe",
			stderr: "ignore",
			signal: AbortSignal.timeout(GIT_SPAWN_TIMEOUT_MS),
		});
		const [text, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
		if (exitCode !== 0) return null;
		const trimmed = text.trim();
		return trimmed.length > 0 ? trimmed : null;
	} catch {
		return null;
	}
}

const repoInfoCache = new Map<string, Promise<RepoInfo>>();

async function describeRepoUncached(cwd: string): Promise<RepoInfo> {
	const repoRoot = await runGit(["rev-parse", "--show-toplevel"], cwd);
	const remoteUrl = repoRoot ? await runGit(["remote", "get-url", "origin"], repoRoot) : null;
	const label = path.basename(repoRoot ?? cwd);
	return { repoRoot, remoteUrl, label };
}

/** Describes the git repo containing `cwd`, memoized per-`cwd` for the process lifetime. */
export function describeRepo(cwd: string): Promise<RepoInfo> {
	const cached = repoInfoCache.get(cwd);
	if (cached) return cached;
	const promise = describeRepoUncached(cwd);
	repoInfoCache.set(cwd, promise);
	return promise;
}
