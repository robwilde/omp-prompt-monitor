import type { PromptRow } from "./journal";

export interface PortablePromptRow extends PromptRow {
	/** Clipboard payload; present only when it differs from `text`. */
	copyText?: string;
}

const SKILL_PREAMBLE_RE = /^\[IMPORTANT:[\s\S]*?]\n+/;
const SKILL_DIR_FOOTER_RE = /\n---\n+\[Skill directory: [^\n]*]\n[^\n]*(?:\nUser:[\s\S]*)?$/;
const SKILL_PATH_FOOTER_RE = /\n---\n+Skill: \/[^\n]*$/;

/** Prompt text with omp-only scaffolding removed, suitable for pasting into another agent. */
export function portablePromptText(row: PromptRow): string {
	if (row.kind !== "skill") return row.text;
	if (row.skillArgs) return row.skillArgs;
	return row.text.replace(SKILL_PREAMBLE_RE, "").replace(SKILL_DIR_FOOTER_RE, "").replace(SKILL_PATH_FOOTER_RE, "").trim();
}

export function withPortableText(rows: PromptRow[]): PortablePromptRow[] {
	return rows.map((row) => {
		const copyText = portablePromptText(row);
		return copyText === row.text ? row : { ...row, copyText };
	});
}
