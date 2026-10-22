import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const RUNNER_SUFFIX = '/dsh-sandbox-windows-acl/lib/runner.js'

export function apply(ctx) {
  if (process.platform !== 'win32') return

  const resourcesPath = process.resourcesPath
  if (typeof resourcesPath !== 'string' || resourcesPath.length === 0) {
    throw new Error('windows-acl-logon-dacl-fix: Electron resourcesPath is unavailable')
  }

  const aclModulePath = join(
    resourcesPath,
    'app.asar',
    'dsh',
    'node_modules',
    '@deepseek-ai',
    'dsh-sandbox-windows-acl',
    'lib',
    'index.js',
  )
  if (!existsSync(aclModulePath)) {
    throw new Error(`windows-acl-logon-dacl-fix: bundled ACL module not found: ${aclModulePath}`)
  }

  const hookUrl = new URL('./runner-hook.mjs', import.meta.url)
  hookUrl.searchParams.set('acl', pathToFileURL(aclModulePath).href)
  const preload = hookUrl.href

  ctx.inject(['sandbox'], (sandboxCtx) => {
    const sandbox = sandboxCtx.sandbox
    if (!sandbox || typeof sandbox.confine !== 'function') {
      throw new Error('windows-acl-logon-dacl-fix: sandbox service has no confine() method')
    }

    const originalConfine = sandbox.confine
    const patchedConfine = async function (argv, policy, signal) {
      const result = await originalConfine.call(this, argv, policy, signal)
      if (policy?.mode !== 'workspace-write' || !Array.isArray(result?.argv)) return result

      const command = result.argv[0]
      const runner = String(result.argv[1] ?? '').replaceAll('\\', '/').toLowerCase()
      const isElectronRunner =
        typeof command === 'string' &&
        command.toLowerCase() === process.execPath.toLowerCase() &&
        runner.endsWith(RUNNER_SUFFIX)

      if (!isElectronRunner) {
        throw new Error(
          'windows-acl-logon-dacl-fix: workspace-write runner did not match the supported Windows ACL runner; refusing to report a patched execution',
        )
      }

      return {
        ...result,
        argv: [command, '--import', preload, ...result.argv.slice(1)],
      }
    }

    sandbox.confine = patchedConfine
    ctx.logger.info('windows-acl-logon-dacl-fix: enabled logon-SID default-DACL repair for Windows workspace-write')

    return () => {
      if (sandbox.confine === patchedConfine) sandbox.confine = originalConfine
    }
  })
}
