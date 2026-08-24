import * as os from "node:os";
import * as path from "node:path";
import { resolveHeartbeatDir } from "./paths";

export const HEARTBEAT_INTERVAL_MS = 20_000;
export const HEARTBEAT_STALE_MS = 60_000;

export interface Heartbeat {
	v: 1;
	sessionId: string;
	sessionFile: string;
	cwd: string;
	pid: number;
	host: string;
	startedAt: number;
	lastSeenAt: number;
}

function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

export async function writeHeartbeat(hb: Omit<Heartbeat, "v" | "lastSeenAt">): Promise<void> {
	const payload: Heartbeat = { ...hb, v: 1, lastSeenAt: Date.now() };
	const file = path.join(resolveHeartbeatDir(), `${hb.sessionId}.json`);
	await Bun.write(file, JSON.stringify(payload));
}

export async function removeHeartbeat(sessionId: string): Promise<void> {
	const file = path.join(resolveHeartbeatDir(), `${sessionId}.json`);
	try {
		await Bun.file(file).unlink();
	} catch {
		// Best-effort: missing file is fine, anything else is not worth surfacing.
	}
}

export async function readHeartbeats(): Promise<Map<string, Heartbeat>> {
	const dir = resolveHeartbeatDir();
	const glob = new Bun.Glob("*.json");
	const hostname = os.hostname();
	const now = Date.now();
	const heartbeats = new Map<string, Heartbeat>();

	let names: string[];
	try {
		names = await Array.fromAsync(glob.scan(dir));
	} catch {
		return heartbeats;
	}

	for (const name of names) {
		const file = path.join(dir, name);
		let hb: Heartbeat;
		try {
			hb = (await Bun.file(file).json()) as Heartbeat;
		} catch {
			continue;
		}

		const stale = now - hb.lastSeenAt > HEARTBEAT_STALE_MS;
		const deadSameHost = hb.host === hostname && !isProcessAlive(hb.pid);
		if (stale || deadSameHost) {
			try {
				await Bun.file(file).unlink();
			} catch {
				// Ignore unlink errors; the entry is simply dropped from this read.
			}
			continue;
		}

		heartbeats.set(hb.sessionId, hb);
	}

	return heartbeats;
}
