import * as fs from "node:fs";

export interface PluginEntry {
	name: string;
	version: string;
	path: string;
}

function pickEntry(entries: unknown[]): PluginEntry | null {
	for (const entry of entries) {
		if (typeof entry !== "object" || entry === null) continue;
		const record = entry as Record<string, unknown>;
		if (record.name !== "omp-prompt-monitor") continue;
		if (typeof record.path !== "string" || typeof record.version !== "string") continue;
		return { name: record.name, version: record.version, path: record.path };
	}
	return null;
}

export async function findInstalledPlugin(): Promise<PluginEntry | null> {
	const ompPath = Bun.which("omp");
	if (ompPath === null) return null;

	const proc = Bun.spawn([ompPath, "plugin", "list", "--json"], { stdout: "pipe", stderr: "pipe" });
	const [stdout, , exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	if (exitCode !== 0) return null;

	try {
		const parsed = JSON.parse(stdout) as { npm?: unknown[]; marketplace?: unknown[] };
		const entries = [...(parsed.npm ?? []), ...(parsed.marketplace ?? [])];
		return pickEntry(entries);
	} catch {
		return null;
	}
}

export async function isDevLink(pluginPath: string): Promise<boolean> {
	try {
		const stat = await fs.promises.lstat(pluginPath);
		return stat.isSymbolicLink();
	} catch {
		return false;
	}
}

export async function runInstall(slug: string): Promise<{ ok: boolean; output: string }> {
	const ompPath = Bun.which("omp");
	if (ompPath === null) return { ok: false, output: "omp CLI not found on PATH" };

	const proc = Bun.spawn([ompPath, "install", `github:${slug}`], { stdout: "pipe", stderr: "pipe" });
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	return { ok: exitCode === 0, output: (stdout + stderr).trim() };
}
