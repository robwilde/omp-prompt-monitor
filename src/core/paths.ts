import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export type Env = Record<string, string | undefined>;

/**
 * Resolves the active profile from `OMP_PROFILE ?? PI_PROFILE` (`OMP_PROFILE`
 * wins whenever it is *defined*, including empty string), mirroring
 * `normalizeProfileName` (`dirs.ts:58-60`): the raw value is trimmed, and
 * both an empty result and the literal `"default"` mean "no profile" — e.g.
 * `OMP_PROFILE=default` must resolve identically to an unset `OMP_PROFILE`,
 * matching where omp itself writes sessions.
 */
function normalizeProfile(env: Env): string | undefined {
	const raw = env.OMP_PROFILE !== undefined ? env.OMP_PROFILE : env.PI_PROFILE;
	const trimmed = raw?.trim();
	if (!trimmed || trimmed === "default") return undefined;
	return trimmed;
}

/**
 * Mirrors the agent-directory resolution precedence in omp's
 * `packages/utils/src/dirs.ts` (env/profile/XDG branch), reimplemented here so
 * this package never depends on omp's published manifests (their internal
 * deps use `catalog:` specifiers that don't resolve outside the monorepo).
 *
 * Precedence, highest first:
 *  1. `PI_CODING_AGENT_DIR` → `path.resolve(value)`. Disables the XDG branch.
 *  2. A profile from {@link normalizeProfile} — `OMP_PROFILE` wins whenever
 *     it is *defined*, including empty string, so an explicitly-empty
 *     `OMP_PROFILE` does not fall through to `PI_PROFILE`. A non-empty,
 *     non-"default" profile gives `<home>/<configDirName>/profiles/<profile>/agent`
 *     and disables the XDG branch.
 *  3. Default: `<home>/<configDirName>/agent`, `configDirName = PI_CONFIG_DIR || ".omp"`.
 */
export function resolveAgentDir(env: Env = process.env): string {
	const codingAgentDir = env.PI_CODING_AGENT_DIR;
	if (codingAgentDir) return path.resolve(codingAgentDir);

	const home = os.homedir();
	const configDirName = env.PI_CONFIG_DIR || ".omp";

	const profile = normalizeProfile(env);
	if (profile) {
		return path.join(home, configDirName, "profiles", profile, "agent");
	}

	return path.join(home, configDirName, "agent");
}

/**
 * Resolves the sessions root. Honors the same XDG override
 * `listAllSessions()` misses (it always reads `getAgentDir()/sessions`):
 * on Linux/macOS, when the agent dir is the plain default (no
 * `PI_CODING_AGENT_DIR` override, no profile) and `$XDG_DATA_HOME/omp` exists
 * on disk, sessions live under `$XDG_DATA_HOME/omp/sessions` instead.
 */
export function resolveSessionsRoot(env: Env = process.env): string {
	const agentDir = resolveAgentDir(env);
	const isDefaultAgentDir = !env.PI_CODING_AGENT_DIR && !normalizeProfile(env);

	if (
		(process.platform === "linux" || process.platform === "darwin") &&
		isDefaultAgentDir &&
		env.XDG_DATA_HOME
	) {
		const xdgOmpRoot = path.join(env.XDG_DATA_HOME, "omp");
		if (fs.existsSync(xdgOmpRoot)) {
			return path.join(xdgOmpRoot, "sessions");
		}
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
