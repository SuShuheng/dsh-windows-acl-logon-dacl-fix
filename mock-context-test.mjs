import assert from 'node:assert/strict'
import { join } from 'node:path'
import { apply } from './index.js'

const runner = join(
  process.resourcesPath,
  'app.asar',
  'dsh',
  'node_modules',
  '@deepseek-ai',
  'dsh-sandbox-windows-acl',
  'lib',
  'runner.js',
)
const calls = []
const sandbox = {
  async confine(argv, policy, signal) {
    calls.push({ argv, policy, signal })
    return {
      argv: [process.execPath, runner, '--workspace', 'workspace', '--mode', policy.mode, ...argv],
      enforcement: 'partial',
      denialSignatures: [],
      runnerFailureRules: [],
    }
  },
}
const ctx = {
  inject(services, callback) {
    assert.deepEqual(services, ['sandbox'])
    return callback({ sandbox })
  },
  logger: { info() {} },
}

apply(ctx)
const write = await sandbox.confine(['pwsh', '-Command', 'exit 42'], { mode: 'workspace-write' })
assert.equal(write.argv[0], process.execPath)
assert.equal(write.argv[1], '--import')
assert.match(write.argv[2], /^file:.*runner-hook\.mjs\?acl=file%3A/u)
assert.equal(write.argv[3], runner)

const readOnly = await sandbox.confine(['pwsh', '-Command', 'exit 42'], { mode: 'read-only' })
assert.equal(readOnly.argv[1], runner)
assert.equal(calls.length, 2)
console.log('mock host injection: PASS')
