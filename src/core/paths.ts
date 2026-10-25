import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export type Env = Record<string, string | undefined>;

const PROFILE_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const WINDOWS_RESERVED_BASENAME_RE = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

/**
 * Mirrors `normalizeProfileName` (omp `packages/utils/src/dirs.ts`): trimmed;
 * empty and the literal `"default"` mean "no profile". omp throws on a
 * syntactically invalid name at the CLI but falls back to the default profile at
 * module load; a read-only dashboard follows the fallback instead of crashing.
 */
function normalizeProfileName(raw: string | undefined): string | undefined {
	const name = raw?.trim();
	if (!name || name === "default") return undefined;
	if (name === "." || name === ".." || name.endsWith(".") || !PROFILE_NAME_RE.test(name)) return undefined;
	if (WINDOWS_RESERVED_BASENAME_RE.test(name)) return undefined;
	return name;
}

interface ResolvedDirs {
	profile: string | undefined;
	agentDir: string;
	defaultAgentDir: string;
}

/**
 * Mirrors omp's `DirResolver` constructor + `resolveActiveAgentDirOverride`:
 *  - A named profile derives its own agent dir and ignores `PI_CODING_AGENT_DIR`
 *    (omp's `setProfile` exports it to children, so it is profile-derived anyway).
 *  - In default mode `PI_CODING_AGENT_DIR` overrides the agent dir, unless it equals
 *    the agent dir a parent derived for the bypassed `PI_PROFILE` (default mode means
 *    `OMP_PROFILE` resolved to no profile), which is dropped.
 *  - `configDirName = PI_CONFIG_DIR || ".omp"`.
 */
function resolveDirs(env: Env, home: string): ResolvedDirs {
	// `OMP_PROFILE` wins whenever it is *defined* (even empty); `PI_PROFILE` is the legacy fallback.
	const profile = normalizeProfileName(env.OMP_PROFILE !== undefined ? env.OMP_PROFILE : env.PI_PROFILE);
	const configRoot = path.join(home, env.PI_CONFIG_DIR || ".omp");
	const profileRoot = (name: string) => path.join(configRoot, "profiles", name);
	const defaultAgentDir = path.join(profile ? profileRoot(profile) : configRoot, "agent");

	let override: string | undefined;
	if (!profile && env.PI_CODING_AGENT_DIR) {
		const bypassed = normalizeProfileName(env.PI_PROFILE);
		const profileDerived = bypassed !== undefined && env.PI_CODING_AGENT_DIR === path.join(profileRoot(bypassed), "agent");
		if (!profileDerived) override = path.resolve(env.PI_CODING_AGENT_DIR);
	}
	return {
		profile,
		agentDir: override ?? defaultAgentDir,
		defaultAgentDir,
	};
}

export function resolveAgentDir(env: Env = process.env): string {
	return resolveDirs(env, os.homedir()).agentDir;
}

/**
 * Mirrors `getSessionsDir()`. On Linux/macOS, when the agent dir is the default one
 * (an explicit `PI_CODING_AGENT_DIR` equal to the default still counts) and
 * `$XDG_DATA_HOME/omp` exists (for a named profile: `$XDG_DATA_HOME/omp/profiles/<name>`),
 * omp flattens `agent/` away: sessions live under `<xdg root>/sessions`.
 */
export function resolveSessionsRoot(env: Env = process.env): string {
	const { profile, agentDir, defaultAgentDir } = resolveDirs(env, os.homedir());

	if ((process.platform === "linux" || process.platform === "darwin") && agentDir === defaultAgentDir && env.XDG_DATA_HOME) {
		const appRoot = path.join(env.XDG_DATA_HOME, "omp");
		const xdgRoot = profile ? path.join(appRoot, "profiles", profile) : appRoot;
		if (fs.existsSync(xdgRoot)) return path.join(xdgRoot, "sessions");
	}

	return path.join(agentDir, "sessions");
}

/** This package's own state directory — never inside omp's directories. */
export function resolveMonitorStateDir(env: Env = process.env): string {
	const home = os.homedir();
	if (process.platform === "win32") {
		const base = env.LOCALAPPDATA || path.join(home, "AppData", "Local");
		return path.join(base, "omp-prompt-monitor");
	}
	const base = env.XDG_STATE_HOME || path.join(home, ".local", "state");
	return path.join(base, "omp-prompt-monitor");
}

export function resolveHeartbeatDir(env: Env = process.env): string {
	return path.join(resolveMonitorStateDir(env), "heartbeats");
}

export function resolveDashboardLogFile(env: Env = process.env): string {
	return path.join(resolveMonitorStateDir(env), "dashboard.log");
}

export function resolveCacheFile(env: Env = process.env): string {
	return path.join(resolveMonitorStateDir(env), "index-cache.json");
}
