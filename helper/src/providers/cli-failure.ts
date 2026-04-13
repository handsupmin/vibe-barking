interface ResolveCliFailureMessageInput {
	stderr: string;
	stdout: string;
	exitCode: number | null;
	commandLabel: string;
}

export function resolveCliFailureMessage({
	stderr,
	stdout,
	exitCode,
	commandLabel,
}: ResolveCliFailureMessageInput): string {
	const trimmedStderr = stderr.trim();
	if (trimmedStderr) {
		return trimmedStderr;
	}

	const stdoutMessage = extractCliStdoutMessage(stdout);
	if (stdoutMessage) {
		return stdoutMessage;
	}

	return `${commandLabel} exited with code ${exitCode ?? "unknown"}.`;
}

function extractCliStdoutMessage(stdout: string): string | null {
	const trimmed = stdout.trim();
	if (!trimmed) {
		return null;
	}

	let candidate: string | null = null;
	for (const line of trimmed.split(/\r?\n/)) {
		const value = line.trim();
		if (!value) {
			continue;
		}

		try {
			const parsed = JSON.parse(value) as Record<string, unknown>;
			const assistantMessage = extractAssistantMessage(parsed);
			if (assistantMessage) {
				candidate = assistantMessage;
			}
			if (typeof parsed.result === "string" && parsed.result.trim()) {
				candidate = parsed.result.trim();
			}
			continue;
		} catch {
			candidate = value;
		}
	}

	return candidate;
}

function extractAssistantMessage(parsed: Record<string, unknown>): string | null {
	const message =
		typeof parsed.message === "object" && parsed.message !== null
			? (parsed.message as Record<string, unknown>)
			: null;
	const content = Array.isArray(message?.content) ? message.content : [];
	const text = content
		.map((item) =>
			typeof item === "object" && item !== null
				? (item as Record<string, unknown>).text
				: null,
		)
		.find((value): value is string => typeof value === "string" && value.trim().length > 0);

	return text?.trim() ?? null;
}
