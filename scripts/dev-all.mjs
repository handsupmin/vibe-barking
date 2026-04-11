import { spawn } from 'node:child_process'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const rootDir = dirname(fileURLToPath(import.meta.url))
const repoDir = resolve(rootDir, '..')
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'

const children = []
let shuttingDown = false

function run(name, args, cwd) {
  const child = spawn(npmCommand, args, {
    cwd,
    stdio: 'inherit',
    env: process.env,
  })

  child.on('exit', (code, signal) => {
    if (shuttingDown) {
      return
    }

    shuttingDown = true
    for (const other of children) {
      if (other !== child && !other.killed) {
        other.kill('SIGINT')
      }
    }

    const reason = signal ? `signal ${signal}` : `code ${code ?? 0}`
    console.error(`[dev-all] ${name} exited with ${reason}`)
    process.exit(code ?? 0)
  })

  children.push(child)
  return child
}

function shutdown(signal) {
  if (shuttingDown) {
    return
  }

  shuttingDown = true
  for (const child of children) {
    if (!child.killed) {
      child.kill(signal)
    }
  }
}

process.on('SIGINT', () => {
  shutdown('SIGINT')
  process.exit(0)
})

process.on('SIGTERM', () => {
  shutdown('SIGTERM')
  process.exit(0)
})

run('helper', ['start'], resolve(repoDir, 'helper'))
setTimeout(() => {
  run('frontend', ['run', 'dev'], resolve(repoDir, 'frontend'))
}, 400)
