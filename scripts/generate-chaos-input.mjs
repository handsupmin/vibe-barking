import process from 'node:process'
import { fileURLToPath } from 'node:url'

const alphabet =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789멍왈왕댕강개냥숑호두감자코코루키초코ΔΛΩβγЖЙŁøİğ٤٥٦٧٨九八七六五'

export function parseArgs(argv) {
  const lengthIndex = argv.indexOf('--length')
  const seedIndex = argv.indexOf('--seed')

  const length = lengthIndex >= 0 ? Number(argv[lengthIndex + 1]) : 240
  const seed = seedIndex >= 0 ? Number(argv[seedIndex + 1]) : 7

  if (!Number.isInteger(length) || length <= 0) {
    throw new Error('Expected --length to be a positive integer')
  }

  if (!Number.isInteger(seed) || seed < 0) {
    throw new Error('Expected --seed to be a non-negative integer')
  }

  return { length, seed }
}

export function* lcg(seed) {
  let state = seed >>> 0

  while (true) {
    state = (1664525 * state + 1013904223) >>> 0
    yield state / 0x100000000
  }
}

export function generateChaosInput({ length, seed }) {
  const chars = []
  const stream = lcg(seed)

  for (let index = 0; index < length; index += 1) {
    const next = stream.next().value
    const charIndex = Math.floor(next * alphabet.length) % alphabet.length
    chars.push(alphabet[charIndex])
  }

  return chars.join('')
}

function isMainModule(metaUrl) {
  return process.argv[1] === fileURLToPath(metaUrl)
}

if (isMainModule(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2))
  console.log(generateChaosInput(options))
}

