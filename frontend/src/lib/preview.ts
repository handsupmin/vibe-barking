interface PreviewShellOptions {
  providerLabel: string
  queueDepth: number
  pendingCharacters: number
  latestChunk?: string
  latestSummary?: string
  helperMessage: string
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export function buildPreviewShell(options: PreviewShellOptions): string {
  const latestChunk = options.latestChunk
    ? `<pre>${escapeHtml(options.latestChunk)}</pre>`
    : '<p class="muted">No completed chunk yet. The preview will hydrate as soon as the helper returns browser output.</p>'

  const latestSummary = options.latestSummary
    ? `<p>${escapeHtml(options.latestSummary)}</p>`
    : '<p class="muted">Queued chunks will show summaries here when the provider responds.</p>'

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>
      :root {
        color-scheme: light;
        font-family: Inter, system-ui, sans-serif;
        background: #ffffff;
        color: #0d0d0d;
      }
      body {
        margin: 0;
        min-height: 100vh;
        background:
          radial-gradient(circle at top, rgba(24, 226, 153, 0.18), transparent 42%),
          linear-gradient(180deg, #ffffff 0%, #fafffd 100%);
        padding: 32px;
        box-sizing: border-box;
      }
      .shell {
        border: 1px solid rgba(13, 13, 13, 0.08);
        border-radius: 24px;
        background: rgba(255, 255, 255, 0.96);
        box-shadow: rgba(0, 0, 0, 0.04) 0 12px 40px;
        padding: 24px;
      }
      .eyebrow {
        font-size: 12px;
        letter-spacing: 0.6px;
        text-transform: uppercase;
        color: #0fa76e;
      }
      h1 {
        margin: 12px 0 10px;
        font-size: 32px;
        line-height: 1.1;
        letter-spacing: -0.8px;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 12px;
        margin: 24px 0;
      }
      .card {
        border-radius: 18px;
        border: 1px solid rgba(13, 13, 13, 0.06);
        padding: 16px;
        background: #ffffff;
      }
      .label {
        font-size: 12px;
        color: #666666;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
      .value {
        margin-top: 8px;
        font-size: 18px;
      }
      pre {
        margin: 0;
        white-space: pre-wrap;
        word-break: break-word;
        font: 500 12px/1.6 'Geist Mono', ui-monospace, monospace;
        background: #f6fffb;
        border-radius: 16px;
        padding: 16px;
      }
      .muted {
        color: #666666;
      }
    </style>
  </head>
  <body>
    <section class="shell">
      <div class="eyebrow">vibe-barking preview shell</div>
      <h1>Browser output is standing by.</h1>
      <p class="muted">This iframe is already isolated and ready for helper-produced HTML. Until then, it reflects the live frontend state.</p>
      <div class="grid">
        <div class="card">
          <div class="label">Provider</div>
          <div class="value">${escapeHtml(options.providerLabel)}</div>
        </div>
        <div class="card">
          <div class="label">Queued bark jobs</div>
          <div class="value">${options.queueDepth}</div>
        </div>
        <div class="card">
          <div class="label">Pending characters</div>
          <div class="value">${options.pendingCharacters}</div>
        </div>
      </div>
      <div class="card" style="margin-bottom: 16px;">
        <div class="label">Latest chunk</div>
        ${latestChunk}
      </div>
      <div class="card" style="margin-bottom: 16px;">
        <div class="label">Latest helper note</div>
        <p>${escapeHtml(options.helperMessage)}</p>
      </div>
      <div class="card">
        <div class="label">Latest summary</div>
        ${latestSummary}
      </div>
    </section>
  </body>
</html>`
}
