export type PromptKind = "typed" | "skill" | "reply";

export interface PromptRow {
	entryId: string;
	parentId: string | null;
	kind: PromptKind;
	text: string;
	/** Epoch ms. */
	at: number;
	/** True when `at` came from the journal entry's ISO timestamp, not the message. */
	atFromEntry: boolean;
}

export type TitleSource = "auto" | "user" | "derived" | "none";
export type TailStatus = "complete" | "interrupted" | "aborted" | "error" | "pending" | "unknown";

export interface SessionParse {
	id: string;
	cwd: string;
	title: string;
	titleSource: TitleSource;
	createdAt: number;
	version: number | null;
	parentSession: string | null;
	prompts: PromptRow[];
	/** Total `type:"message"` entries, for a cheap activity signal. */
	messageCount: number;
	/** Last `type:"message"` role, mapped to omp's tail-status literals. */
	tailStatus: TailStatus;
	malformedLines: number;
}

interface JournalRecord {
	type?: string;
	id?: string;
	parentId?: string | null;
	timestamp?: string;
	v?: number;
	title?: string;
	source?: "auto" | "user";
	cwd?: string;
	version?: number;
	titleSource?: "auto" | "user";
	parentSession?: string;
	customType?: string;
	attribution?: string;
	content?: unknown;
	message?: {
		role?: string;
		content?: unknown;
		synthetic?: boolean;
		steering?: boolean;
		attribution?: string;
		timestamp?: number;
		stopReason?: string;
	};
}

interface TextBlock {
	type: "text";
	text: string;
}

function isTextBlock(block: unknown): block is TextBlock {
	if (typeof block !== "object" || block === null) return false;
	if (!("type" in block) || block.type !== "text") return false;
	if (!("text" in block) || typeof block.text !== "string") return false;
	return true;
}

/** String content, or joined `text` blocks from an array (images contribute nothing). */
function extractText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const block of content) {
		if (isTextBlock(block)) parts.push(block.text);
	}
	return parts.join("\n");
}

function deriveTailStatus(records: JournalRecord[]): TailStatus {
	for (let i = records.length - 1; i >= 0; i--) {
		const record = records[i];
		if (record?.type !== "message" || !record.message) continue;
		const message = record.message;
		switch (message.role) {
			case "user":
				return "pending";
			case "toolResult":
				return "interrupted";
			case "assistant": {
				if (message.stopReason === "error") return "error";
				if (message.stopReason === "aborted") return "aborted";
				if (message.stopReason === "length") return "interrupted";
				const content = message.content;
				const hasToolCall =
					Array.isArray(content) &&
					content.some((block) => {
						if (typeof block !== "object" || block === null) return false;
						if (!("type" in block)) return false;
						return block.type === "toolCall";
					});
				return hasToolCall ? "interrupted" : "complete";
			}
			default:
				return "unknown";
		}
	}
	return "unknown";
}

/** Parse one session JSONL file's text into a session summary + prompt timeline. Returns `null` when the file is not a valid session (header validation fails). */
export function parseSessionText(text: string): SessionParse | null {
	const lines = text.split("\n");
	const records: JournalRecord[] = [];
	let malformedLines = 0;
	for (const line of lines) {
		if (line.length === 0) continue;
		try {
			records.push(JSON.parse(line) as JournalRecord);
		} catch {
			malformedLines++;
		}
	}
	if (records.length === 0) return null;

	let headerIndex = 0;
	let slotTitle: string | undefined;
	let slotSource: "auto" | "user" | undefined;
	const first = records[0];
	if (first?.type === "title" && first.v === 1) {
		slotTitle = String(first.title ?? "");
		slotSource = first.source;
		headerIndex = 1;
	}

	const header = records[headerIndex];
	if (!header || header.type !== "session" || typeof header.id !== "string") return null;

	const createdAt = header.timestamp ? Date.parse(header.timestamp) : Number.NaN;

	const prompts: PromptRow[] = [];
	let messageCount = 0;

	for (const record of records) {
		if (record.type === "message") {
			messageCount++;
			const message = record.message;
			if (!message) continue;
			if (message.role === "assistant") {
				const replyText = extractText(message.content).trim();
				if (replyText.length === 0) continue;
				const at = Number.isFinite(message.timestamp) ? (message.timestamp as number) : Date.parse(record.timestamp ?? "");
				prompts.push({
					entryId: record.id ?? "",
					parentId: record.parentId ?? null,
					kind: "reply",
					text: replyText,
					at,
					atFromEntry: !Number.isFinite(message.timestamp),
				});
				continue;
			}
			if (message.role !== "user") continue;
			if (message.synthetic === true) continue;
			if (message.steering === true) continue;
			if (message.attribution === "agent") continue;
			const promptText = extractText(message.content).trim();
			if (promptText.length === 0) continue;
			const at = Number.isFinite(message.timestamp) ? (message.timestamp as number) : Date.parse(record.timestamp ?? "");
			prompts.push({
				entryId: record.id ?? "",
				parentId: record.parentId ?? null,
				kind: "typed",
				text: promptText,
				at,
				atFromEntry: !Number.isFinite(message.timestamp),
			});
		} else if (record.type === "custom_message" && record.customType === "skill-prompt" && record.attribution === "user") {
			const promptText = extractText(record.content).trim();
			if (promptText.length === 0) continue;
			prompts.push({
				entryId: record.id ?? "",
				parentId: record.parentId ?? null,
				kind: "skill",
				text: promptText,
				at: Date.parse(record.timestamp ?? ""),
				atFromEntry: true,
			});
		}
	}

	prompts.sort((a, b) => a.at - b.at);

	let title: string;
	let titleSource: TitleSource;
	const trimmedSlotTitle = slotTitle?.trim();
	const trimmedHeaderTitle = header.title?.trim();
	if (trimmedSlotTitle) {
		title = trimmedSlotTitle;
		titleSource = slotSource ?? "auto";
	} else if (trimmedHeaderTitle) {
		title = trimmedHeaderTitle;
		titleSource = header.titleSource ?? "auto";
	} else if (prompts.find((p) => p.kind !== "reply")) {
		const firstUserPrompt = prompts.find((p) => p.kind !== "reply")!;
		title = firstUserPrompt.text.replace(/\s+/g, " ").trim().slice(0, 60);
		titleSource = "derived";
	} else {
		title = `Session ${header.id.slice(0, 8)}`;
		titleSource = "none";
	}

	return {
		id: header.id,
		cwd: header.cwd ?? "",
		title,
		titleSource,
		createdAt,
		version: typeof header.version === "number" ? header.version : null,
		parentSession: header.parentSession ?? null,
		prompts,
		messageCount,
		tailStatus: deriveTailStatus(records),
		malformedLines,
	};
}
