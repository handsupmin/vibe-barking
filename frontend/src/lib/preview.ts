interface PreviewShellOptions {
  providerLabel: string
  queueDepth: number
  pendingCharacters: number
  latestChunk?: string
  helperMessage: string
  title?: string
  summary?: string
  statusLabel?: string
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
    : '<p class="muted">No applied diff yet. The live demo will hydrate as soon as the first bark job completes.</p>'

  const title = options.title ?? 'Waiting for the next diff.'
  const summary = options.summary ?? 'The preview grows from tiny bark-driven patches instead of full rebuilds.'
  const statusLabel = options.statusLabel ?? 'preview shell'

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
          radial-gradient(circle at top, rgba(24, 226, 153, 0.2), transparent 38%),
          linear-gradient(180deg, #ffffff 0%, #fafffd 100%);
        padding: 36px;
        box-sizing: border-box;
      }
      .shell {
        min-height: calc(100vh - 72px);
        border: 1px solid rgba(13, 13, 13, 0.08);
        border-radius: 28px;
        background: rgba(255, 255, 255, 0.96);
        box-shadow: rgba(0, 0, 0, 0.04) 0 18px 64px -24px;
        padding: 20px;
        display: grid;
        grid-template-rows: auto auto 1fr;
        gap: 20px;
      }
      .chrome {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto;
        align-items: center;
        gap: 12px;
        padding: 10px 12px;
        border-radius: 18px;
        background: #f7fff9;
        border: 1px solid rgba(13, 13, 13, 0.06);
      }
      .dots { display: inline-flex; gap: 6px; }
      .dots span { width: 10px; height: 10px; border-radius: 999px; }
      .dots span:nth-child(1) { background: #ff7a70; }
      .dots span:nth-child(2) { background: #ffd166; }
      .dots span:nth-child(3) { background: #18e299; }
      .address {
        min-width: 0;
        text-align: center;
        color: #6b6b6b;
        font: 500 12px/1.2 'Geist Mono', ui-monospace, monospace;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .status {
        color: #7a7a7a;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }
      .eyebrow {
        font-size: 12px;
        letter-spacing: 0.6px;
        text-transform: uppercase;
        color: #0fa76e;
        font-weight: 700;
      }
      h1 {
        margin: 12px 0 10px;
        font-size: clamp(2.4rem, 5vw, 4rem);
        line-height: 0.96;
        letter-spacing: -1.1px;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 12px;
      }
      .card {
        border-radius: 18px;
        border: 1px solid rgba(13, 13, 13, 0.06);
        padding: 14px;
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
        border-radius: 18px;
        padding: 18px;
      }
      .muted {
        color: #666666;
      }
      .canvas {
        border-radius: 24px;
        border: 1px dashed rgba(13, 13, 13, 0.12);
        background: linear-gradient(180deg, rgba(24,226,153,0.08), rgba(255,255,255,0.85));
        display: grid;
        place-items: center;
        min-height: 280px;
        text-align: center;
        padding: 32px;
      }
      .canvas h2 {
        margin: 0 0 10px;
        font-size: clamp(1.75rem, 4vw, 2.4rem);
        line-height: 1.05;
      }
      .canvas p {
        margin: 0;
        color: #555555;
      }
    </style>
  </head>
  <body>
    <section class="shell">
      <div class="chrome">
        <div class="dots"><span></span><span></span><span></span></div>
        <div class="address">${escapeHtml(title)}</div>
        <div class="status">${escapeHtml(statusLabel)}</div>
      </div>
      <div>
        <div class="eyebrow">vibe-barking live demo</div>
        <h1>${escapeHtml(title)}</h1>
        <p class="muted">${escapeHtml(summary)}</p>
      </div>
      <div class="grid">
        <div class="card">
          <div class="label">Provider</div>
          <div class="value">${escapeHtml(options.providerLabel)}</div>
        </div>
        <div class="card">
          <div class="label">Active jobs</div>
          <div class="value">${options.queueDepth}</div>
        </div>
        <div class="card">
          <div class="label">Pending characters</div>
          <div class="value">${options.pendingCharacters}</div>
        </div>
      </div>
      <div class="canvas">
        <div>
          <h2>Live demo ready</h2>
          <p>${escapeHtml(options.helperMessage)}</p>
          <div style="margin-top:20px;">${latestChunk}</div>
        </div>
      </div>
    </section>
  </body>
</html>`
}
