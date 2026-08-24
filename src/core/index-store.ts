import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parseSessionText, type SessionParse } from "./journal";
import { resolveCacheFile, resolveSessionsRoot } from "./paths";

export interface IndexedSession extends SessionParse {
	file: string;
	sizeBytes: number;
	mtimeMs: number;
}

export interface IndexStore {
	refresh(): Promise<IndexedSession[]>;
}

interface CacheFile {
	v: 2;
	entries: IndexedSession[];
}

const ADVISOR_BASENAME_RE = /^__advisor(\.|$)/;
const DEFAULT_CONCURRENCY = 16;

async function loadCache(cacheFile: string): Promise<Map<string, IndexedSession>> {
	const cache = new Map<string, IndexedSession>();
	try {
		const parsed = (await Bun.file(cacheFile).json()) as CacheFile;
		if (parsed.v === 2 && Array.isArray(parsed.entries)) {
			for (const entry of parsed.entries) cache.set(entry.file, entry);
		}
	} catch {
		// Missing, unparseable, or wrong version: start empty.
	}
	return cache;
}

/** Runs `worker` over `items` with bounded concurrency, preserving input order in the returned array. */
async function mapWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
	const results: R[] = new Array(items.length);
	let nextIndex = 0;
	async function runOne(): Promise<void> {
		while (true) {
			const index = nextIndex++;
			if (index >= items.length) return;
			results[index] = await worker(items[index] as T);
		}
	}
	await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => runOne()));
	return results;
}

export function createIndexStore(options?: {
	sessionsRoot?: string;
	cacheFile?: string;
	concurrency?: number;
}): IndexStore {
	const sessionsRoot = options?.sessionsRoot ?? resolveSessionsRoot();
	const cacheFile = options?.cacheFile ?? resolveCacheFile();
	const concurrency = options?.concurrency ?? DEFAULT_CONCURRENCY;

	async function refresh(): Promise<IndexedSession[]> {
		const cache = await loadCache(cacheFile);

		const relativeNames = await Array.fromAsync(new Bun.Glob("*/*.jsonl").scan(sessionsRoot));
		const files = relativeNames
			.filter((name) => {
				const base = path.basename(name);
				return !ADVISOR_BASENAME_RE.test(base) && !base.endsWith(".bak");
			})
			.map((name) => path.join(sessionsRoot, name));

		let changed = false;

		const entries = await mapWithConcurrency(files, concurrency, async (file): Promise<IndexedSession | null> => {
			let stat: { size: number; mtimeMs: number };
			try {
				stat = await fs.stat(file);
			} catch {
				return null;
			}

			const cached = cache.get(file);
			if (cached && cached.sizeBytes === stat.size && cached.mtimeMs === stat.mtimeMs) {
				return cached;
			}

			changed = true;
			let text: string;
			try {
				text = await Bun.file(file).text();
			} catch {
				// File vanished or became unreadable between `stat` and this read (e.g. a
				// concurrent session move or title-slot rewrite); drop it from the index
				// rather than crashing the whole refresh over one racy file.
				return null;
			}
			const parsed = parseSessionText(text);
			if (!parsed) return null;

			return { ...parsed, file, sizeBytes: stat.size, mtimeMs: stat.mtimeMs };
		});

		const indexed = entries.filter((entry): entry is IndexedSession => entry !== null);

		if (!changed && indexed.length === cache.size) {
			// Nothing changed and no files disappeared: skip the write.
			return indexed;
		}

		const payload: CacheFile = { v: 2, entries: indexed };
		await Bun.write(cacheFile, JSON.stringify(payload));

		return indexed;
	}

	return { refresh };
}
