import { Database } from "bun:sqlite";
import { resolveHistoryDb } from "./paths";

/** omp's latest idle recap for one session, read from history.db `session_recaps`. */
export interface SessionRecap {
	text: string;
	/** Epoch ms (omp stores unix seconds). */
	createdAt: number;
}

const BUSY_TIMEOUT_MS = 2000;

// Mirrors omp `listSessionRecaps` (session-index.ts): typeof guards skip rows a
// damaged page decoded into foreign types; `id DESC` breaks second-granular ties.
const LATEST_RECAP_SQL = `SELECT recap, created_at FROM session_recaps
WHERE session_id = ? AND typeof(recap) = 'text' AND typeof(created_at) = 'integer'
ORDER BY created_at DESC, id DESC LIMIT 1`;

/**
 * Full text of the session's newest recap, or null when there is none or
 * history.db is missing, lacks the table, or is locked. Opens read-only per
 * call: omp writes the db in WAL mode and may quarantine/recreate it, so a
 * long-lived handle could pin a dead inode.
 */
export function loadLatestRecap(sessionId: string, options?: { dbPath?: string }): SessionRecap | null {
	let db: Database | undefined;
	try {
		db = new Database(options?.dbPath ?? resolveHistoryDb(), { readonly: true });
		db.run(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
		const row = db.query(LATEST_RECAP_SQL).get(sessionId) as { recap: string; created_at: number } | null;
		return row ? { text: row.recap, createdAt: row.created_at * 1000 } : null;
	} catch {
		return null;
	} finally {
		db?.close();
	}
}
