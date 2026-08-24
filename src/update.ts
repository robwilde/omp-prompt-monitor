import pkg from "../package.json";

const UPDATE_TTL_MS = 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 3000;

export const CURRENT_VERSION: string = pkg.version;

export interface UpdateStatus {
	v: 1;
	current: string;
	latest: string | null;
	updateAvailable: boolean;
}

export function repoSlug(): string | null {
	const match = /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/.exec(pkg.repository.url);
	return match?.[1] ?? null;
}

function versionParts(value: string): [number, number, number] {
	const [major, minor, patch] = value
		.split("-")[0]!
		.split(".")
		.map((part) => {
			const parsed = Number.parseInt(part, 10);
			return Number.isNaN(parsed) ? 0 : parsed;
		});
	return [major ?? 0, minor ?? 0, patch ?? 0];
}

export function isNewerVersion(candidate: string, current: string): boolean {
	const a = versionParts(candidate);
	const b = versionParts(current);
	for (let i = 0; i < 3; i++) {
		if (a[i] !== b[i]) return a[i]! > b[i]!;
	}
	return false;
}

export async function fetchLatestVersion(): Promise<string | null> {
	const slug = repoSlug();
	if (slug === null) return null;
	try {
		const response = await fetch(`https://raw.githubusercontent.com/${slug}/main/package.json`, {
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		});
		if (response.status !== 200) return null;
		const body = await response.json();
		if (typeof body !== "object" || body === null) return null;
		const version = (body as Record<string, unknown>).version;
		return typeof version === "string" ? version : null;
	} catch {
		return null;
	}
}

export async function computeUpdateStatus(): Promise<UpdateStatus> {
	const latest = await fetchLatestVersion();
	return {
		v: 1,
		current: CURRENT_VERSION,
		latest,
		updateAvailable: latest !== null && isNewerVersion(latest, CURRENT_VERSION),
	};
}

let cached: { expiresAt: number; status: UpdateStatus } | null = null;

export async function getUpdateStatus(): Promise<UpdateStatus> {
	if (cached && cached.expiresAt > Date.now()) return cached.status;
	const status = await computeUpdateStatus();
	cached = { expiresAt: Date.now() + UPDATE_TTL_MS, status };
	return status;
}
