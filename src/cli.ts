#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { buildSnapshot } from "./core/view";
import { DEFAULT_PORT, startServer } from "./server";

const HELP_TEXT = `omp-prompt-monitor — local dashboard of Oh My Pi sessions and user prompts

Usage:
  omp-monitor [--port <n>] [--host <h>] [--open]
  omp-monitor --json

Options:
  --port <n>   Port to bind (default ${DEFAULT_PORT})
  --host <h>   Host to bind (default 127.0.0.1)
  --open       Open the dashboard in the default browser
  --json       Print one full snapshot as JSON and exit (no server)
  --help       Show this help
`;

function openInBrowser(url: string): void {
	const command =
		process.platform === "darwin" ? ["open", url] : process.platform === "win32" ? ["cmd", "/c", "start", "", url] : ["xdg-open", url];
	try {
		Bun.spawn(command, { stdio: ["ignore", "ignore", "ignore"] });
	} catch {
		// Best-effort: failure to launch a browser is not fatal.
	}
}

async function main(): Promise<void> {
	const { values } = parseArgs({
		args: process.argv.slice(2),
		options: {
			port: { type: "string" },
			host: { type: "string" },
			open: { type: "boolean" },
			json: { type: "boolean" },
			help: { type: "boolean" },
		},
		strict: true,
		allowPositionals: false,
	});

	if (values.help) {
		console.log(HELP_TEXT);
		return;
	}

	const port = values.port ? Number.parseInt(values.port, 10) : DEFAULT_PORT;
	const host = values.host ?? "127.0.0.1";

	if (values.json) {
		const snapshot = await buildSnapshot();
		console.log(JSON.stringify(snapshot, null, 2));
		return;
	}

	const { url, reused, stop } = await startServer({ port, hostname: host });
	console.log(reused ? `Reusing existing dashboard at: ${url}` : `Dashboard available at: ${url}`);
	console.log("Press Ctrl+C to stop");

	if (values.open) openInBrowser(url);

	if (reused) return;

	const { promise } = Promise.withResolvers<void>();
	process.on("SIGINT", () => {
		console.log("Shutting down…");
		stop();
		process.exit(0);
	});
	await promise;
}

await main();
