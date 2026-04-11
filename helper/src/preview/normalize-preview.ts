import type { PreviewDocument } from '../types.ts';

interface PreviewPayload {
  title?: unknown;
  summary?: unknown;
  html?: unknown;
  css?: unknown;
  javascript?: unknown;
}

export function normalizePreviewDocument(outputText: string): PreviewDocument {
  const parsed = parsePreviewPayload(outputText);
  if (parsed) {
    return {
      title: asString(parsed.title) || 'Vibe Barking Preview',
      summary: asString(parsed.summary) || 'Generated browser artifact',
      html: asString(parsed.html) || '<section><p>No HTML returned.</p></section>',
      css: asString(parsed.css) || '',
      javascript: asString(parsed.javascript) || '',
    };
  }

  if (looksLikeHtml(outputText)) {
    return {
      title: 'Vibe Barking Preview',
      summary: 'Raw HTML fallback',
      html: outputText,
      css: '',
      javascript: '',
    };
  }

  return {
    title: 'Vibe Barking Preview',
    summary: 'Plain-text fallback',
    html: `<section><pre>${escapeHtml(outputText)}</pre></section>`,
    css: 'body { font-family: Inter, system-ui, sans-serif; padding: 24px; color: #0d0d0d; } pre { white-space: pre-wrap; }',
    javascript: '',
  };
}

function parsePreviewPayload(outputText: string): PreviewPayload | null {
  const rawCandidates = [
    outputText.trim(),
    extractFence(outputText, 'json'),
    extractLikelyJson(outputText),
  ].filter(Boolean) as string[];

  for (const candidate of rawCandidates) {
    try {
      const parsed = JSON.parse(candidate) as PreviewPayload;
      if (typeof parsed === 'object' && parsed !== null) {
        return parsed;
      }
    } catch {
      // ignore parse failures and keep trying fallbacks
    }
  }

  return null;
}

function extractFence(value: string, language: string): string | null {
  const match = value.match(new RegExp(String.raw`\\\`\\\`\\\`${language}\\s*([\\s\\S]*?)\\\`\\\`\\\``, 'i'));
  return match?.[1]?.trim() || null;
}

function extractLikelyJson(value: string): string | null {
  const start = value.indexOf('{');
  const end = value.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }

  return value.slice(start, end + 1);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function looksLikeHtml(value: string): boolean {
  return /<([a-z]+)(\s|>)/i.test(value);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
