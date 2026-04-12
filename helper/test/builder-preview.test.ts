import assert from 'node:assert/strict'
import test from 'node:test'

import { materializePreviewResult, previewToBuilderFiles } from '../src/preview/builder-preview.ts'

test('previewToBuilderFiles exposes the tiny app virtual file set', () => {
  const files = previewToBuilderFiles({
    title: 'Demo',
    summary: 'Summary',
    html: '<main>demo</main>',
    css: 'body { color: red; }',
    javascript: 'console.log("demo")',
  })

  assert.equal(files['src/index.html']!, '<main>demo</main>')
  assert.equal(files['src/styles.css']!, 'body { color: red; }')
  assert.equal(files['src/app.js']!, 'console.log("demo")')
  assert.equal(files['src/meta.json']!, JSON.stringify({ title: 'Demo', summary: 'Summary' }))
})

test('materializePreviewResult applies structured patch operations over the current preview', () => {
  const currentPreview = {
    title: 'Old title',
    summary: 'Old summary',
    html: '<main>old</main>',
    css: 'body { color: black; }',
    javascript: 'console.log("old")',
  }

  const outputText = JSON.stringify({
    stage: 'applying',
    thinking: ['Preparing a tiny UI patch.'],
    result: {
      mode: 'patch',
      operations: [
        {
          type: 'replace_file',
          path: 'src/meta.json',
          content: JSON.stringify({ title: 'New title', summary: 'New summary' }, null, 2),
        },
        {
          type: 'replace_file',
          path: 'src/index.html',
          content: '<main>new</main>',
        },
      ],
    },
  })

  const resolved = materializePreviewResult(outputText, currentPreview)

  assert.equal(resolved.resultMode, 'patch')
  assert.equal(resolved.preview.title, 'New title')
  assert.equal(resolved.preview.summary, 'New summary')
  assert.equal(resolved.preview.html, '<main>new</main>')
  assert.equal(resolved.preview.css, 'body { color: black; }')
})

test('materializePreviewResult derives title and summary from html when metadata stays generic', () => {
  const currentPreview = {
    title: 'preview',
    summary: 'summary',
    html: '<main><h1>Preview</h1><p>summary</p></main>',
    css: '',
    javascript: '',
  }

  const outputText = JSON.stringify({
    stage: 'applying',
    thinking: ['Refreshing the visible framing.'],
    result: {
      mode: 'patch',
      operations: [
        {
          type: 'replace_file',
          path: 'src/index.html',
          content: '<main><h1>Alphabet Playground</h1><p>Tap letters to spell anything.</p></main>',
        },
      ],
    },
  })

  const resolved = materializePreviewResult(outputText, currentPreview)

  assert.equal(resolved.preview.title, 'Alphabet Playground')
  assert.equal(resolved.preview.summary, 'Tap letters to spell anything.')
})

test('materializePreviewResult falls back to snapshot envelopes when provided', () => {
  const outputText = JSON.stringify({
    stage: 'applied',
    thinking: ['Snapshot fallback'],
    result: {
      mode: 'snapshot',
      snapshot: {
        title: 'Snapshot',
        summary: 'Done',
        html: '<main>snapshot</main>',
        css: 'body { color: green; }',
        javascript: 'console.log("snapshot")',
      },
    },
  })

  const resolved = materializePreviewResult(outputText)

  assert.equal(resolved.resultMode, 'snapshot')
  assert.equal(resolved.preview.title, 'Snapshot')
  assert.equal(resolved.preview.html, '<main>snapshot</main>')
})
