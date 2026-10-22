# DSH Windows workspace-write sandbox startup repair

[![npm version](https://img.shields.io/npm/v/dsh-windows-acl-logon-dacl-fix)](https://www.npmjs.com/package/dsh-windows-acl-logon-dacl-fix)

A reversible Cordis bundle workaround for a Windows ACL sandbox defect in **DeepSeek Harness Desktop 0.2.1-rc.2**. On affected Windows hosts, commands launched under `workspace-write` can terminate before startup with `0xC0000142` / `3221225794`, or a persistent PowerShell PTY can report `PTY shell exited during startup`.

> This is a community compatibility workaround, not an official DSH fix. It changes the restricted runner's token default DACL. Use only with the supported DSH version, review the code, and remove it after upgrading to an upstream build that fixes the defect.

## What it changes

The Host plugin wraps `ctx.sandbox.confine()` only for the recognized Windows ACL runner under `workspace-write`, and adds a Node ESM preload to that runner. The preload preserves the existing workspace/temp capability SID grant and adds a `FILE_ALL_ACCESS` default-DACL ACE for the current Windows logon SID. That SID is present in both the restricted token's enabled groups and restricting-SID list; it is narrower than granting the ACE to Everyone.

Workspace and private-temp write boundaries remain enforced by the existing capability ACEs, Low integrity labels, and `WRITE_RESTRICTED` token. The plugin fails closed if the supported runner shape is not recognized or the DACL repair fails. It does not modify `app.asar`, the DSH executable, or workspace ACLs itself.

## Compatibility and verification

- Supported runtime: DSH `0.2.1-rc.2` only (enforced by `engines.dsh`).
- Target: Windows desktop runtime with the bundled `dsh-sandbox-windows-acl` runner.
- Verified on Windows 11 build 26100: `pwsh` and `cmd.exe` start under `workspace-write`; workspace and private-temp writes succeed; writes outside the workspace are denied; read-only writes remain denied. The reporter also verified the persistent PowerShell PTY in a live DSH session.
- The implementation depends on internal DSH runner paths and token fields. Re-test after any Harness update; do not bypass the engine guard.

## Install / remove

Install the bundle through the DSH Plugin Manager (or a supported bundle installation flow) using `dsh-windows-acl-logon-dacl-fix@0.1.0`. The bundle contributes the Host row `windows-acl-logon-dacl-fix`.

To remove the workaround, disable or remove the bundle in Plugin Manager. Existing sessions should be recreated after changing the bundle or sandbox policy.

## Development checks

The repository includes `mock-context-test.mjs` for the Host-side runner-argv wrapper. Run it with the DSH Electron executable in Run-As-Node mode. The Windows token/DACL integration check must be performed against the exact supported DSH runtime; do not infer it from a mock or an unrestricted shell.

## License

MIT. See [LICENSE](LICENSE).

---

# DSH Windows 工作区写入沙箱启动修复

这是针对 **DeepSeek Harness Desktop 0.2.1-rc.2** 的可回滚 Cordis bundle 临时兼容补丁。在受影响的 Windows 环境中，`workspace-write` 下的子进程可能以 `0xC0000142`（`3221225794`）在启动期退出，持久 PowerShell PTY 也可能报告 `PTY shell exited during startup`。

> 本包是社区兼容补丁，不是 DSH 官方修复。仅用于 README 中标明的 DSH 版本；上游修复发布并验证后应移除此 bundle。

它保留现有 workspace/temp 能力 SID，仅在受限 token 的默认 DACL 中增加当前登录 SID 的 FULL 权限 ACE；该 SID 同时存在于 token 普通组和 restricting SID 列表，范围比 Everyone 更窄。工作区及私有临时目录的写入边界仍由原有能力 ACE、Low 完整性标签和 `WRITE_RESTRICTED` 令牌实施。插件不会修改 `app.asar`、DSH 可执行文件或工作区 ACL；无法识别预期 runner 或修复失败时会 fail-closed。

本补丁已在 Windows 11 build 26100 / DSH 0.2.1-rc.2 验证：workspace-write 下 pwsh 与 cmd 启动成功，工作区和私有临时目录可写，工作区外写入被拒绝，read-only 下写入仍被拒绝；用户也确认了持久 PowerShell PTY 可用。
