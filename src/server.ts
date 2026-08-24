import htmlBundle from "./client/index.html" with { type: "text" };
import { buildSnapshot } from "./core/view";
import type { MonitorSnapshot } from "./core/view";

// bun-types' ambient `*.html` module declaration always types the default export as
// `HTMLBundle`, regardless of the `{ type: "text" }` import attribute; at runtime that
// attribute makes Bun return the file's raw text content instead (verified against the
// installed Bun runtime).
const html = htmlBundle as unknown as string;

export const MONITOR_HEADER = "x-omp-monitor";
export const MONITOR_HEADER_VALUE = "1";
export const DEFAULT_PORT = 7333;

const SNAPSHOT_TTL_MS = 3000;
const PROBE_TIMEOUT_MS = 500;

export function formatUrl(hostname: string, port: number): string {
	const urlHostname = hostname.includes(":") ? `[${hostname}]` : hostname;
	return `http://${urlHostname}:${port}`;
}

export async function probeExisting(hostname: string, port: number): Promise<boolean> {
	try {
		const response = await fetch(`${formatUrl(hostname, port)}/healthz`, {
			signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
		});
		const reusable = response.status === 200 && response.headers.get(MONITOR_HEADER) === MONITOR_HEADER_VALUE;
		await response.body?.cancel();
		return reusable;
	} catch {
		return false;
	}
}

function withIdentityHeader(response: Response): Response {
	response.headers.set(MONITOR_HEADER, MONITOR_HEADER_VALUE);
	return response;
}

interface CachedSnapshot {
	expiresAt: number;
	promise: Promise<MonitorSnapshot>;
}

function createSnapshotCache() {
	let cached: CachedSnapshot | null = null;
	return async () => {
		if (cached && cached.expiresAt > Date.now()) return cached.promise;
		const promise = buildSnapshot();
		cached = { expiresAt: Date.now() + SNAPSHOT_TTL_MS, promise };
		return promise;
	};
}

export async function startServer(options?: {
	port?: number;
	hostname?: string;
}): Promise<{ url: string; reused: boolean; stop: () => void }> {
	const port = options?.port ?? DEFAULT_PORT;
	const hostname = options?.hostname ?? "127.0.0.1";
	const url = formatUrl(hostname, port);

	if (await probeExisting(hostname, port)) {
		return { url, reused: true, stop: () => {} };
	}

	const getSnapshot = createSnapshotCache();

	try {
		const bunServer = Bun.serve({
			port,
			hostname,
			async fetch(request) {
				try {
					const { pathname } = new URL(request.url);

					if (pathname === "/healthz") {
						return withIdentityHeader(Response.json({ ok: true, v: 1, pid: process.pid }));
					}

					if (pathname === "/api/snapshot") {
						const snapshot = await getSnapshot();
						const sessions = snapshot.sessions.map((session) => ({ ...session, prompts: [] }));
						return withIdentityHeader(Response.json({ ...snapshot, sessions }));
					}

					if (pathname.startsWith("/api/session/")) {
						const id = decodeURIComponent(pathname.slice("/api/session/".length));
						const snapshot = await getSnapshot();
						const session = snapshot.sessions.find((candidate) => candidate.id === id);
						if (!session) {
							return withIdentityHeader(Response.json({ error: "unknown session" }, { status: 404 }));
						}
						return withIdentityHeader(Response.json({ session }));
					}

					return withIdentityHeader(new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } }));
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					return withIdentityHeader(Response.json({ error: message }, { status: 500 }));
				}
			},
		});
		return { url, reused: false, stop: () => bunServer.stop(true) };
	} catch (error) {
		if (await probeExisting(hostname, port)) {
			return { url, reused: true, stop: () => {} };
		}
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Failed to bind ${url}: ${message}. Pass --port to use a different port.`);
	}
}
