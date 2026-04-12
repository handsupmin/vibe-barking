import {
	type BuilderPatchOperation,
	type BuilderResponseEnvelope,
	type BuilderResultMode,
	type PreviewDocument,
} from "../types.ts";
import { normalizePreviewDocument, parseBuilderEnvelope } from "./normalize-preview.ts";

const META_PATH = "src/meta.json";
const HTML_PATH = "src/index.html";
const CSS_PATH = "src/styles.css";
const JS_PATH = "src/app.js";

const DEFAULT_PREVIEW: PreviewDocument = {
	title: "Vibe Barking Demo",
	summary: "The bark builder is waiting for the next tiny diff.",
	html: "<main class=\"shell\"><section class=\"hero\"><p class=\"eyebrow\">vibe-barking</p><h1>Awaiting the next bark diff.</h1><p>Add a bark chunk to keep evolving this demo.</p></section></main>",
	css: "body { margin: 0; min-height: 100vh; font-family: Inter, system-ui, sans-serif; background: linear-gradient(180deg, #ffffff 0%, #f5fff9 100%); color: #111111; } .shell { min-height: 100vh; display: grid; place-items: center; padding: 40px; } .hero { width: min(680px, 100%); border: 1px solid rgba(17,17,17,0.08); border-radius: 24px; background: rgba(255,255,255,0.94); box-shadow: rgba(0,0,0,0.06) 0 24px 64px -32px; padding: 40px; } .eyebrow { text-transform: uppercase; letter-spacing: 0.18em; font-size: 12px; color: #0fa76e; font-weight: 700; } h1 { margin: 16px 0 12px; font-size: clamp(2.5rem, 5vw, 4rem); line-height: 0.98; } p { margin: 0; color: #4a4a4a; line-height: 1.6; }",
	javascript: "",
};

const GENERIC_TITLES = new Set(["preview", "vibe barking preview", "vibe barking demo"]);
const GENERIC_SUMMARIES = new Set([
	"summary",
	"generated browser artifact",
	"plain-text fallback",
	"raw html fallback",
]);

interface MaterializedPreviewResult {
	preview: PreviewDocument;
	envelope?: BuilderResponseEnvelope;
	resultMode: BuilderResultMode;
}

export function materializePreviewResult(
	outputText: string,
	currentPreview?: PreviewDocument,
): MaterializedPreviewResult {
	const envelope = parseBuilderEnvelope(outputText);

	if (envelope?.result?.mode === "snapshot") {
		return {
			preview: beautifyPreview(envelope.result.snapshot, currentPreview),
			envelope,
			resultMode: "snapshot",
		};
	}

	if (envelope?.result?.mode === "patch") {
		return {
			preview: applyBuilderPatch(currentPreview, envelope.result.operations),
			envelope,
			resultMode: "patch",
		};
	}

	return {
		preview: beautifyPreview(normalizePreviewDocument(outputText), currentPreview),
		envelope: envelope ?? undefined,
		resultMode: "fallback",
	};
}

export function previewToBuilderFiles(
	preview?: PreviewDocument,
): Record<string, string> {
	const source = preview ?? DEFAULT_PREVIEW;
	return {
		[META_PATH]: JSON.stringify(
			{ title: source.title, summary: source.summary },
			null,
		),
		[HTML_PATH]: source.html,
		[CSS_PATH]: source.css,
		[JS_PATH]: source.javascript,
	};
}

function applyBuilderPatch(
	currentPreview: PreviewDocument | undefined,
	operations: BuilderPatchOperation[],
): PreviewDocument {
	const files = previewToBuilderFiles(currentPreview);
	for (const operation of operations) {
		if (operation.type !== "replace_file") {
			continue;
		}
		files[normalizePath(operation.path)] = operation.content;
	}

	return beautifyPreview(
		builderFilesToPreview(files, currentPreview ?? DEFAULT_PREVIEW),
		currentPreview,
	);
}

function builderFilesToPreview(
	files: Record<string, string>,
	fallbackPreview: PreviewDocument,
): PreviewDocument {
	const meta = parseMeta(files[META_PATH]);
	return {
		title: meta.title ?? fallbackPreview.title,
		summary: meta.summary ?? fallbackPreview.summary,
		html: files[HTML_PATH] ?? fallbackPreview.html,
		css: files[CSS_PATH] ?? fallbackPreview.css,
		javascript: files[JS_PATH] ?? fallbackPreview.javascript,
	};
}

function beautifyPreview(
	preview: PreviewDocument,
	fallbackPreview?: PreviewDocument,
): PreviewDocument {
	const heading = firstMeaningfulMatch(preview.html, [/<h1[^>]*>([\s\S]*?)<\/h1>/i, /<h2[^>]*>([\s\S]*?)<\/h2>/i]);
	const paragraph = firstMeaningfulMatch(preview.html, [/<p[^>]*>([\s\S]*?)<\/p>/i]);
	const fallbackTitle = fallbackPreview?.title && !isGenericTitle(fallbackPreview.title)
		? fallbackPreview.title
		: undefined;
	const fallbackSummary = fallbackPreview?.summary && !isGenericSummary(fallbackPreview.summary)
		? fallbackPreview.summary
		: undefined;

	return {
		...preview,
		title: isGenericTitle(preview.title)
			? heading ?? fallbackTitle ?? "Vibe Barking Demo"
			: preview.title,
		summary: isGenericSummary(preview.summary)
			? paragraph ?? fallbackSummary ?? "A bark-driven interactive browser demo."
			: preview.summary,
	};
}

function parseMeta(content?: string): { title?: string; summary?: string } {
	if (!content) {
		return {};
	}

	try {
		const parsed = JSON.parse(content) as Record<string, unknown>;
		return {
			title: typeof parsed.title === "string" ? parsed.title : undefined,
			summary: typeof parsed.summary === "string" ? parsed.summary : undefined,
		};
	} catch {
		return {};
	}
}

function normalizePath(path: string): string {
	const trimmed = path.trim().replace(/^\.\//, "");
	if (trimmed === "meta.json") {
		return META_PATH;
	}
	if (trimmed === "index.html") {
		return HTML_PATH;
	}
	if (trimmed === "styles.css") {
		return CSS_PATH;
	}
	if (trimmed === "app.js") {
		return JS_PATH;
	}
	return trimmed;
}

function isGenericTitle(value: string | undefined): boolean {
	if (!value) {
		return true;
	}
	return GENERIC_TITLES.has(value.trim().toLowerCase());
}

function isGenericSummary(value: string | undefined): boolean {
	if (!value) {
		return true;
	}
	return GENERIC_SUMMARIES.has(value.trim().toLowerCase());
}

function firstMeaningfulMatch(value: string, patterns: RegExp[]): string | undefined {
	for (const pattern of patterns) {
		const match = value.match(pattern)?.[1];
		const cleaned = cleanHtmlText(match);
		if (cleaned) {
			return cleaned;
		}
	}
	return undefined;
}

function cleanHtmlText(value: string | undefined): string | undefined {
	if (!value) {
		return undefined;
	}
	const cleaned = value
		.replace(/<[^>]+>/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	return cleaned || undefined;
}
