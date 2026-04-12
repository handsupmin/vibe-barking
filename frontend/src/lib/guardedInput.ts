import { CHUNK_SIZE } from './contracts'

export interface KeyboardEventLike {
  key: string
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
  isComposing?: boolean
}

export interface BeforeInputEventLike {
  data?: string | null
  inputType?: string
  isComposing?: boolean
}

export function shouldDeferBeforeInputCapture(event: BeforeInputEventLike): boolean {
  return Boolean(event.isComposing || event.inputType?.toLowerCase().includes('composition'))
}

export interface QueuedChunkLike {
  id: string
  chunk: string
  createdAt: string
  status: string
}

export interface BarkQueueState<TQueueItem extends QueuedChunkLike = QueuedChunkLike> {
  pendingBuffer: string
  transcript: string
  queue: TQueueItem[]
}

const BLOCKED_KEYS = new Set([
  'Alt',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'Backspace',
  'CapsLock',
  'Delete',
  'End',
  'Enter',
  'Escape',
  'F1',
  'F2',
  'F3',
  'F4',
  'F5',
  'F6',
  'F7',
  'F8',
  'F9',
  'F10',
  'F11',
  'F12',
  'Home',
  'Insert',
  'PageDown',
  'PageUp',
  'Tab',
])

function isAllowedCharacter(character: string): boolean {
  const codePoint = character.codePointAt(0)

  if (codePoint === undefined) {
    return false
  }

  const isC0Control = codePoint >= 0x00 && codePoint <= 0x1f
  const isDelete = codePoint === 0x7f
  const isC1Control = codePoint >= 0x80 && codePoint <= 0x9f

  return !(isC0Control || isDelete || isC1Control)
}

export function sanitizeBarkText(text: string): string {
  return Array.from(text)
    .filter((character) => isAllowedCharacter(character) && !['\n', '\r', '\t'].includes(character))
    .join('')
}

export function isBlockedKeyboardEvent(event: KeyboardEventLike): boolean {
  if (event.isComposing) {
    return false
  }

  if (event.ctrlKey || event.metaKey || event.altKey) {
    return true
  }

  if (BLOCKED_KEYS.has(event.key)) {
    return true
  }

  if (event.key.length !== 1) {
    return true
  }

  return sanitizeBarkText(event.key).length === 0
}

export function applyTextToQueue<TQueueItem extends QueuedChunkLike>(
  state: BarkQueueState<TQueueItem>,
  inputText: string,
): BarkQueueState<TQueueItem | QueuedChunkLike> {
  const sanitized = sanitizeBarkText(inputText)

  if (!sanitized) {
    return state
  }

  let combined = `${state.pendingBuffer}${sanitized}`
  const appendedJobs: QueuedChunkLike[] = []
  const existingCount = state.queue.length

  while (combined.length >= CHUNK_SIZE) {
    appendedJobs.push({
      id: createQueueJobId(existingCount + appendedJobs.length + 1),
      chunk: combined.slice(0, CHUNK_SIZE),
      createdAt: new Date().toISOString(),
      status: 'queued',
    })
    combined = combined.slice(CHUNK_SIZE)
  }

  return {
    pendingBuffer: combined,
    transcript: `${state.transcript}${sanitized}`,
    queue: [...state.queue, ...appendedJobs],
  }
}

function createQueueJobId(index: number): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `job-${Date.now()}-${index}`
}
