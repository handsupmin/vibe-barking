import { spawn } from 'node:child_process'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const rootDir = dirname(fileURLToPath(import.meta.url))
const repoDir = resolve(rootDir, '..')
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const nodeCommand = process.execPath

function run(command, args, cwd) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'inherit',
      env: process.env,
    })

    child.on('exit', (code) => {
      if (code === 0) {
        resolvePromise()
      } else {
        rejectPromise(new Error(`${command} ${args.join(' ')} failed with code ${code ?? 1}`))
      }
    })

    child.on('error', rejectPromise)
  })
}

await run(npmCommand, ['test'], resolve(repoDir, 'frontend'))
await run(npmCommand, ['run', 'lint'], resolve(repoDir, 'frontend'))
await run(npmCommand, ['run', 'typecheck'], resolve(repoDir, 'frontend'))
await run(npmCommand, ['run', 'build'], resolve(repoDir, 'frontend'))
await run(npmCommand, ['test'], resolve(repoDir, 'helper'))
await run(npmCommand, ['run', 'typecheck'], resolve(repoDir, 'helper'))
await run(nodeCommand, ['--test', 'scripts/provider-env-check.test.mjs', 'scripts/generate-chaos-input.test.mjs', 'scripts/verification-contracts.test.mjs'], repoDir)
console.log('[verify-all] all checks passed')
