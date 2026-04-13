import { existsSync, readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, normalize, resolve } from 'node:path'

import { previewToBuilderFiles } from '../preview/builder-preview.ts'
import type { PreviewDocument, SessionRecord } from '../types.ts'

interface SessionOutputStoreOptions {
  cwd?: string
}

const OUTPUT_ROOT = 'outputs'

export class SessionOutputStore {
  private readonly rootPath: string

  constructor({ cwd = process.cwd() }: SessionOutputStoreOptions = {}) {
    this.rootPath = join(cwd, OUTPUT_ROOT)
  }

  async ensureSession(sessionKey: string): Promise<SessionRecord> {
    const safeKey = sanitizeSessionKey(sessionKey)
    const dir = this.getSessionPath(safeKey)
    await mkdir(dir, { recursive: true })
    const files = previewToBuilderFiles()
    await Promise.all([
      writeIfMissing(join(dir, 'meta.json'), files['src/meta.json'] ?? '{}'),
      writeIfMissing(
        join(dir, 'index.html'),
        buildSessionHtml({
          title: 'Vibe Barking Demo',
          summary: 'The bark builder is waiting for the next tiny diff.',
          html: files['src/index.html'] ?? '<main></main>',
          css: files['src/styles.css'] ?? '',
          javascript: files['src/app.js'] ?? '',
        }),
      ),
      writeIfMissing(join(dir, 'styles.css'), files['src/styles.css'] ?? ''),
      writeIfMissing(join(dir, 'app.js'), files['src/app.js'] ?? ''),
    ])

    return {
      sessionKey: safeKey,
      previewUrl: `/outputs/${encodeURIComponent(safeKey)}/live.html`,
      createdAt: new Date().toISOString(),
    }
  }

  async writePreview(sessionKey: string, preview: PreviewDocument): Promise<SessionRecord> {
    const session = await this.ensureSession(sessionKey)
    const dir = this.getSessionPath(session.sessionKey)
    const files = previewToBuilderFiles(preview)
    await Promise.all([
      writeFile(join(dir, 'meta.json'), files['src/meta.json'] ?? '{}', 'utf8'),
      writeFile(join(dir, 'index.html'), buildSessionHtml(preview), 'utf8'),
      writeFile(join(dir, 'styles.css'), files['src/styles.css'] ?? '', 'utf8'),
      writeFile(join(dir, 'app.js'), files['src/app.js'] ?? '', 'utf8'),
    ])
    return session
  }

  readPreview(sessionKey: string): PreviewDocument | undefined {
    const safeKey = sanitizeSessionKey(sessionKey)
    const dir = this.getSessionPath(safeKey)
    if (!existsSync(dir)) {
      return undefined
    }

    try {
      const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')) as Record<string, unknown>
      const htmlDocument = readFileSync(join(dir, 'index.html'), 'utf8')
      return {
        title: typeof meta.title === 'string' ? meta.title : 'Vibe Barking Demo',
        summary: typeof meta.summary === 'string' ? meta.summary : 'The bark builder is waiting for the next tiny diff.',
        html: extractBuilderHtml(htmlDocument),
        css: readFileSync(join(dir, 'styles.css'), 'utf8'),
        javascript: readFileSync(join(dir, 'app.js'), 'utf8'),
      }
    } catch {
      return undefined
    }
  }

  resolveOutputFile(pathname: string): { filePath: string; contentType: string } | null {
    const cleaned = pathname.replace(/^\/outputs\//, '')
    const decoded = decodeURIComponent(cleaned)
    const normalized = normalize(decoded)
    if (normalized.startsWith('..') || normalized.includes(`..${process.platform === 'win32' ? '\\' : '/'}`)) {
      return null
    }

    const absolute = resolve(this.rootPath, normalized)
    if (!absolute.startsWith(resolve(this.rootPath))) {
      return null
    }
    if (!existsSync(absolute)) {
      return null
    }

    return {
      filePath: absolute,
      contentType: contentTypeForFile(absolute),
    }
  }

  buildLiveDocument(sessionKey: string): string | null {
    const preview = this.readPreview(sessionKey)
    if (!preview) {
      return null
    }

    return composePreviewDocument(preview)
  }

  getSessionDirectory(sessionKey: string): string {
    return this.getSessionPath(sanitizeSessionKey(sessionKey))
  }

  private getSessionPath(sessionKey: string): string {
    return join(this.rootPath, sessionKey)
  }
}

function buildSessionHtml(preview: PreviewDocument): string {
  const html = preview.html.trim()
  if (/<!doctype html>/i.test(html) || /<html[\s>]/i.test(html)) {
    return html
  }

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(preview.title)}</title>
    <link rel="stylesheet" href="./styles.css" />
  </head>
  <body>
    ${html}
    <script src="./app.js"></script>
  </body>
</html>`
}

function sanitizeSessionKey(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error('Session key is required.')
  }
  return trimmed.replace(/[^a-zA-Z0-9._-]/g, '-')
}

async function writeIfMissing(filePath: string, content: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  if (existsSync(filePath)) {
    return
  }
  await writeFile(filePath, content, 'utf8')
}

function contentTypeForFile(filePath: string): string {
  switch (extname(filePath)) {
    case '.html':
      return 'text/html; charset=utf-8'
    case '.css':
      return 'text/css; charset=utf-8'
    case '.js':
      return 'text/javascript; charset=utf-8'
    case '.json':
      return 'application/json; charset=utf-8'
    default:
      return `application/octet-stream; name=${basename(filePath)}`
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function composePreviewDocument(preview: PreviewDocument): string {
  const html = preview.html.trim()

  if (/<!doctype html>/i.test(html) || /<html[\s>]/i.test(html)) {
    return html
      .replace(/<link[^>]+href=["']\.\/styles\.css["'][^>]*>/i, '')
      .replace(/<script[^>]+src=["']\.\/app\.js["'][^>]*><\/script>/i, `<script>${preview.javascript}</script>`)
      .replace(/<\/head>/i, `<style>${preview.css}</style></head>`)
  }

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(preview.title)}</title>
    <style>${preview.css}</style>
  </head>
  <body>
    ${html}
    <script>${preview.javascript}</script>
  </body>
</html>`
}

function extractBuilderHtml(documentHtml: string): string {
  const trimmed = documentHtml.trim()
  if (!/<!doctype html>/i.test(trimmed) && !/<html[\s>]/i.test(trimmed)) {
    return trimmed
  }

  const bodyMatch = trimmed.match(/<body[^>]*>([\s\S]*?)<\/body>/i)
  if (!bodyMatch) {
    return trimmed
  }

  return (bodyMatch[1] ?? trimmed)
    .replace(/<script[^>]+src=["']\.\/app\.js["'][^>]*><\/script>/gi, '')
    .trim()
}
