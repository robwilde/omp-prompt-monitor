import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { loadLatestRecap } from "../src/core/recap";

// omp's exact DDL (packages/coding-agent/src/session/session-index.ts).
const OMP_DDL = `
CREATE TABLE IF NOT EXISTS session_recaps (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	session_id TEXT NOT NULL,
	cwd TEXT NOT NULL,
	recap TEXT NOT NULL,
	created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER))
);
CREATE INDEX IF NOT EXISTS idx_session_recaps_session ON session_recaps(session_id, created_at);
`;

let dir = "";
let dbPath = "";

function seed(rows: Array<[sessionId: string, recap: string, createdAt: number]>, ddl = OMP_DDL): void {
	const db = new Database(dbPath, { create: true });
	try {
		db.run("PRAGMA journal_mode=WAL");
		db.run(ddl);
		for (const [sessionId, recap, createdAt] of rows) {
			db.run("INSERT INTO session_recaps (session_id, cwd, recap, created_at) VALUES (?, ?, ?, ?)", [
				sessionId,
				"/work",
				recap,
				createdAt,
			]);
		}
	} finally {
		db.close();
	}
}

beforeEach(() => {
	dir = fs.mkdtempSync(path.join(os.tmpdir(), "omp-monitor-recap-"));
	dbPath = path.join(dir, "history.db");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("loadLatestRecap", () => {
	test("selects the row with the greatest created_at", () => {
		seed([
			["s1", "newest", 300],
			["s1", "oldest", 100],
			["s1", "middle", 200],
		]);
		expect(loadLatestRecap("s1", { dbPath })?.text).toBe("newest");
	});

	test("breaks created_at ties by the higher row id", () => {
		seed([
			["s1", "first inserted", 500],
			["s1", "second inserted", 500],
		]);
		expect(loadLatestRecap("s1", { dbPath })?.text).toBe("second inserted");
	});

	test("ignores rows from other sessions, even when newer", () => {
		seed([
			["s1", "mine", 100],
			["s2", "theirs", 900],
		]);
		expect(loadLatestRecap("s1", { dbPath })?.text).toBe("mine");
	});

	test("converts created_at seconds to epoch milliseconds", () => {
		seed([["s1", "text", 1792905056]]);
		expect(loadLatestRecap("s1", { dbPath })).toEqual({ text: "text", createdAt: 1792905056000 });
	});

	test("returns the full multi-line text untruncated", () => {
		const text = `Goal: ship it.\n\n- **a**: \`b\`\n${"long ".repeat(400)}`;
		seed([["s1", text, 10]]);
		expect(loadLatestRecap("s1", { dbPath })?.text).toBe(text);
	});

	test("returns null when the session has no rows", () => {
		seed([["s2", "other", 100]]);
		expect(loadLatestRecap("s1", { dbPath })).toBeNull();
	});

	test("returns null when the db file is missing and does not create it", () => {
		expect(loadLatestRecap("s1", { dbPath })).toBeNull();
		expect(fs.existsSync(dbPath)).toBe(false);
	});

	test("returns null when the db has no session_recaps table", () => {
		seed([], "CREATE TABLE session_titles (session_id TEXT PRIMARY KEY, title TEXT NOT NULL);");
		expect(loadLatestRecap("s1", { dbPath })).toBeNull();
	});

	test("skips rows whose columns decoded to foreign types", () => {
		seed([["s1", "good", 100]]);
		const db = new Database(dbPath);
		try {
			db.run("INSERT INTO session_recaps (session_id, cwd, recap, created_at) VALUES ('s1', '/w', x'6e6f', 999)");
			db.run("INSERT INTO session_recaps (session_id, cwd, recap, created_at) VALUES ('s1', '/w', 'bad time', 'later')");
		} finally {
			db.close();
		}
		expect(loadLatestRecap("s1", { dbPath })?.text).toBe("good");
	});
});
