/**
 * Structural slice of omp's extension API this package depends on, declared
 * locally so the package has zero dependency on `@oh-my-pi/pi-coding-agent`
 * (its published manifest uses `catalog:` specifiers that don't resolve
 * outside the omp monorepo). omp's loader only needs these shapes to be
 * satisfied structurally at runtime — it does not check against this type.
 */
export interface OmpUi {
	setStatus(key: string, text: string | undefined): void;
}

export interface OmpSessionManager {
	getSessionId(): string;
	getSessionFile(): string | undefined;
	getCwd(): string;
}

export interface OmpCtx {
	ui: OmpUi;
	hasUI: boolean;
	sessionManager: OmpSessionManager;
	setInterval(cb: () => void, ms: number): unknown;
}

export interface OmpApi {
	on(event: "session_start" | "session_shutdown", handler: (event: unknown, ctx: OmpCtx) => unknown): void;
	registerCommand(
		name: string,
		options: { description?: string; handler: (args: string, ctx: OmpCtx) => Promise<void> },
	): void;
}
