import * as os from "node:os";
import { describeRepo } from "./git";
import type { Heartbeat } from "./heartbeat";
import { readHeartbeats } from "./heartbeat";
import type { IndexedSession } from "./index-store";
import { createIndexStore } from "./index-store";
import type { PromptRow, TailStatus, TitleSource } from "./journal";
import { resolveSessionsRoot } from "./paths";

export type Liveness = "live" | "recent" | "idle";
export const RECENT_WINDOW_MS = 15 * 60 * 1000;

export interface SessionRow {
	id: string;
	file: string;
	title: string;
	titleSource: TitleSource;
	cwd: string;
	repoLabel: string;
	repoRoot: string | null;
	remoteUrl: string | null;
	createdAt: number;
	lastActivityAt: number;
	promptCount: number;
	messageCount: number;
	tailStatus: TailStatus;
	liveness: Liveness;
	pid: number | null;
	prompts: PromptRow[];
}

export interface ProjectGroup {
	key: string; // repoRoot ?? cwd
	repoLabel: string;
	remoteUrl: string | null;
	cwds: string[];
	sessionIds: string[];
	liveCount: number;
	lastActivityAt: number;
}

export interface MonitorSnapshot {
	v: 1;
	generatedAt: number;
	host: string;
	sessionsRoot: string;
	heartbeatsSeen: number;
	projects: ProjectGroup[];
	sessions: SessionRow[];
}

async function buildSessionRow(session: IndexedSession, heartbeats: Map<string, Heartbeat>, now: number): Promise<SessionRow> {
	const repo = await describeRepo(session.cwd);
	const lastPrompt = session.prompts.length > 0 ? session.prompts[session.prompts.length - 1] : undefined;
	const lastPromptAt = lastPrompt?.at ?? -Infinity;
	const lastActivityAt = Math.max(session.mtimeMs, lastPromptAt, session.createdAt);

	const heartbeat = heartbeats.get(session.id);
	const liveness: Liveness = heartbeat ? "live" : now - lastActivityAt <= RECENT_WINDOW_MS ? "recent" : "idle";

	return {
		id: session.id,
		file: session.file,
		title: session.title,
		titleSource: session.titleSource,
		cwd: session.cwd,
		repoLabel: repo.label,
		repoRoot: repo.repoRoot,
		remoteUrl: repo.remoteUrl,
		createdAt: session.createdAt,
		lastActivityAt,
		promptCount: session.prompts.length,
		messageCount: session.messageCount,
		tailStatus: session.tailStatus,
		liveness,
		pid: heartbeat?.pid ?? null,
		prompts: session.prompts,
	};
}

function groupByProject(sessions: SessionRow[]): ProjectGroup[] {
	const groups = new Map<string, ProjectGroup>();

	for (const session of sessions) {
		const key = session.repoRoot ?? session.cwd;
		let group = groups.get(key);
		if (!group) {
			group = {
				key,
				repoLabel: session.repoLabel,
				remoteUrl: session.remoteUrl,
				cwds: [],
				sessionIds: [],
				liveCount: 0,
				lastActivityAt: -Infinity,
			};
			groups.set(key, group);
		}
		if (!group.cwds.includes(session.cwd)) group.cwds.push(session.cwd);
		group.sessionIds.push(session.id);
		if (session.liveness === "live") group.liveCount++;
		if (session.lastActivityAt > group.lastActivityAt) group.lastActivityAt = session.lastActivityAt;
	}

	return [...groups.values()].sort((a, b) => b.lastActivityAt - a.lastActivityAt);
}

export async function buildSnapshot(options?: { sessionsRoot?: string }): Promise<MonitorSnapshot> {
	const sessionsRoot = options?.sessionsRoot ?? resolveSessionsRoot();
	const store = createIndexStore({ sessionsRoot });

	const [indexed, heartbeats] = await Promise.all([store.refresh(), readHeartbeats()]);
	const now = Date.now();

	const sessions = (await Promise.all(indexed.map((session) => buildSessionRow(session, heartbeats, now)))).sort(
		(a, b) => b.lastActivityAt - a.lastActivityAt,
	);

	return {
		v: 1,
		generatedAt: now,
		host: os.hostname(),
		sessionsRoot,
		heartbeatsSeen: heartbeats.size,
		projects: groupByProject(sessions),
		sessions,
	};
}
