import type { HeartbeatInput } from "../core";

export interface HeartbeatIo {
	write(heartbeat: HeartbeatInput): Promise<void>;
	remove(sessionId: string): Promise<void>;
}

/** Upper bound on how long shutdown waits for queued I/O; omp's teardown budget is 2000ms. */
export const DRAIN_TIMEOUT_MS = 1500;

export interface HeartbeatTracker {
	/**
	 * Records a beat for `sessionId`; a changed id queues removal of the previous one first and restarts `startedAt`.
	 * `build` runs synchronously so the queued write carries a captured identity, not live session state.
	 */
	beat(sessionId: string, build: (startedAt: number) => HeartbeatInput | undefined): void;
	/** Stops further beats, queues removal of every tracked id plus `extraIds`, and waits (bounded) for the queue. */
	shutdown(extraIds: string[]): Promise<void>;
}

/**
 * Serializes heartbeat writes and removals in call order, so a write for a previous session can never
 * land after that session's removal. Failures are best-effort: a missed write is one stale window,
 * a missed removal self-expires.
 */
export function createHeartbeatTracker(io: HeartbeatIo, drainTimeoutMs = DRAIN_TIMEOUT_MS): HeartbeatTracker {
	let current: { id: string; startedAt: number } | undefined;
	let closed = false;
	let queue: Promise<void> = Promise.resolve();
	const enqueue = (op: () => Promise<void>): void => {
		queue = queue.then(op).catch(() => {});
	};

	return {
		beat(sessionId, build) {
			if (closed) return;
			if (current?.id !== sessionId) {
				const previousId = current?.id;
				if (previousId !== undefined) enqueue(() => io.remove(previousId));
				current = { id: sessionId, startedAt: Date.now() };
			}
			const heartbeat = build(current.startedAt);
			if (heartbeat) enqueue(() => io.write(heartbeat));
		},
		async shutdown(extraIds) {
			closed = true;
			const ids = new Set(extraIds);
			if (current) ids.add(current.id);
			for (const id of ids) enqueue(() => io.remove(id));
			const { promise: timeout, resolve } = Promise.withResolvers<void>();
			const timer = setTimeout(resolve, drainTimeoutMs);
			await Promise.race([queue, timeout]);
			clearTimeout(timer);
		},
	};
}
