/**
 * Structural slice of omp's extension API this package depends on, declared
 *  locally, so the package has zero dependency on `@oh-my-pi/pi-coding-agent`
 * (its published manifest uses `catalog:` specifiers that don't resolve
 * outside the omp monorepo). omp's loader only needs these shapes to be
 * satisfied structurally at runtime — it does not check against this type.
 */
export type OmpNotifyLevel = "info" | "warning" | "error";

export interface OmpUi {
	notify(message: string, level?: OmpNotifyLevel): void;
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

/** Session lifecycle events this package hooks. `session_start` fires once per session runtime (main session, each in-process subagent, each ACP session), not on in-process switches; `/new`, `/resume`, fork, and `/btw` fire `session_switch`/`session_branch` after the session manager has already moved to the new session. */
export type OmpSessionEvent = "session_start" | "session_switch" | "session_branch" | "session_shutdown";

/** Subset of pi-tui's `AutocompleteItem`. `value` replaces the entire argument text after `/<name> ` (end it with a space to finish the token); `hint` is the dim ghost text shown after the cursor while the row is selected. */
export interface OmpAutocompleteItem {
	value: string;
	label: string;
	description?: string;
	hint?: string;
}

export interface OmpCommandOptions {
	description?: string;
	/** Receives the raw text after `/<name> ` up to the cursor (`""` right after the space); `null` shows no popup. Synchronous by omp's extension type. */
	getArgumentCompletions?: (argumentPrefix: string) => OmpAutocompleteItem[] | null;
	handler: (args: string, ctx: OmpCtx) => Promise<void>;
}

export interface OmpApi {
	on(event: OmpSessionEvent, handler: (event: unknown, ctx: OmpCtx) => unknown): void;
	registerCommand(name: string, options: OmpCommandOptions): void;
}
