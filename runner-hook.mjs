import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const PATCH_MARKER = Symbol.for('dsh.windowsAcl.logonDefaultDaclFix')
const FILE_ALL_ACCESS = 2032127
const GRANT_ACCESS = 1
const OBJECT_INHERIT_ACE = 1
const CONTAINER_INHERIT_ACE = 2
const TOKEN_DEFAULT_DACL = 6

const aclModuleUrl = new URL(import.meta.url).searchParams.get('acl')
if (!aclModuleUrl) throw new Error('windows-acl-logon-dacl-fix: missing ACL module URL')

const { AclSandbox } = await import(aclModuleUrl)
const koffi = createRequire(fileURLToPath(aclModuleUrl))('koffi')

if (typeof AclSandbox !== 'function' || !AclSandbox.prototype) {
  throw new Error('windows-acl-logon-dacl-fix: unsupported ACL module export')
}
if (AclSandbox.prototype[PATCH_MARKER]) {
  // A second import of the preloader must not wrap init twice.
} else {
  const originalInit = AclSandbox.prototype.init
  if (typeof originalInit !== 'function') {
    throw new Error('windows-acl-logon-dacl-fix: AclSandbox.init() is unavailable')
  }

  Object.defineProperty(AclSandbox.prototype, PATCH_MARKER, { value: true })
  AclSandbox.prototype.init = async function (...args) {
    const result = await originalInit.apply(this, args)
    if (this.mode !== 'workspace-write') return result

    try {
      const api = this.api
      const token = this.token
      const logonSid = this.sidAllocations?.at(-1)
      if (!api || !token || !logonSid) {
        throw new Error('restricted token or logon SID was unavailable after init')
      }

      // A restricted-token access check must pass against both the token's
      // enabled SIDs and its restricting SIDs. The derived S-1-4 capability
      // SID is only in the latter; the logon SID is present in both lists.
      // Keep the original capability ACE and add this narrower, session-scoped
      // ACE for objects created without an explicit security descriptor.
      const requiredSlot = Buffer.alloc(4)
      api.getTokenInformation(token, TOKEN_DEFAULT_DACL, null, 0, requiredSlot)
      const required = requiredSlot.readUInt32LE(0)
      if (required < 8) throw new Error(`invalid TokenDefaultDacl size: ${required}`)

      const tokenDaclInfo = Buffer.alloc(required)
      if (api.getTokenInformation(token, TOKEN_DEFAULT_DACL, tokenDaclInfo, required, requiredSlot) === 0) {
        throw new Error(`GetTokenInformation(TokenDefaultDacl) failed (Win32 ${api.getLastError()})`)
      }

      const PVOID = koffi.pointer('void')
      const currentDacl = koffi.decode(tokenDaclInfo, 0, PVOID)
      if (currentDacl === null || currentDacl === 0n) {
        throw new Error('restricted token has no default DACL')
      }

      // EXPLICIT_ACCESS_W is 48 bytes on x64 (same ABI as the bundled backend).
      const entry = Buffer.alloc(48)
      entry.writeUInt32LE(FILE_ALL_ACCESS, 0)
      entry.writeUInt32LE(GRANT_ACCESS, 4)
      entry.writeUInt32LE(OBJECT_INHERIT_ACE | CONTAINER_INHERIT_ACE, 8)
      entry.writeBigUInt64LE(koffi.address(logonSid), 40)

      const newDaclSlot = Buffer.alloc(8)
      const mergeResult = api.setEntriesInAclW(1, entry, currentDacl, newDaclSlot)
      if (mergeResult !== 0) {
        throw new Error(`SetEntriesInAclW(logon SID) failed (Win32 ${mergeResult})`)
      }

      const newDacl = koffi.decode(newDaclSlot, 0, PVOID)
      if (newDacl === null || newDacl === 0n) {
        throw new Error('SetEntriesInAclW(logon SID) returned a null DACL')
      }

      try {
        const tokenDacl = Buffer.alloc(8)
        tokenDacl.writeBigUInt64LE(koffi.address(newDacl), 0)
        if (api.setTokenInformation(token, TOKEN_DEFAULT_DACL, tokenDacl, tokenDacl.length) === 0) {
          throw new Error(`SetTokenInformation(TokenDefaultDacl) failed (Win32 ${api.getLastError()})`)
        }
      } finally {
        api.localFree(newDacl)
      }

      return result
    } catch (error) {
      // init() already succeeded, but runner.js has not marked the sandbox
      // initialized yet. Dispose here so a failed repair cannot leak its temp
      // grant or token before the runner's finally block takes ownership.
      try {
        this.dispose()
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'logon-SID DACL repair and sandbox cleanup both failed')
      }
      throw error
    }
  }
}
