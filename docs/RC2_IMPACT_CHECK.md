# dsh-connect-trae 对 LDVH 调研 c8746b85 的影响面核对

> 对照对象：`dsh-ldvh/ldvh-base/researches/research-c8746b85-daf2-4191-aa37-d005d1fbdecd.md`
> （DSH 0.1.7-rc.1 → 0.1.7-rc.2 变更调研，11 项发现 / 4 未证实 / 5 缺口）
> 核对时间：2026-09-26　方法：照搬该调研 F1/F8 的机械化符号比对
> 结论：**本插件不需要为该调研所载的任何变更做修改**（0 处契约破坏面）

## 为什么本插件需要单独核对

该调研的消费清单是 **dsh-ldvh 的**，其 frontmatter 与建议段都很清楚：结论只主张 dsh-ldvh 自身。
但它自己写下的 gap #3 恰恰点名本插件：

> 本机 desktop profile 的 12 个第三方依赖未逐一核对 rc.2 兼容性
> blocked_scope：「本机插件族在 rc.2 整体可用」类结论

`dsh-connect-trae` 是这 12 个之一。因此这不是「把 LDVH 的结论抄过来」，而是补上该 gap 中属于本插件的那一份。
同时 F11 提醒：**peer 范围覆盖 ≠ 符号存在**，零适配结论必须由逐符号比对独立得出。

## 逐条影响面判定

| 调研发现 | 对本插件 | 依据 |
|---|---|---|
| F1 契约面只增不改 | 不击中 | 本插件消费的每个符号在两版均存在（见下表） |
| F2 会话格式未升级 | 不适用 | 本插件不消费 session 持久化 |
| F3 atomic-write 锁接管 | **击中，但属条件性部署约束** | 见下节 |
| F4 deepseekAccount 签名破坏 | 不击中 | 全仓不消费 `deepseekAccount`（grep 零命中） |
| F5 llm-deepseek 拆包改名 | 不击中 | 全仓不引用该包名（唯一命中为 0.1.5-rc.2 的旧 pnpm 缓存） |
| F6 决策记录与装配相反 | 方法面 | 已采纳：本核对读 npm 实包与 patch，不读决策记录 |
| F7 Release 是权威清单 | 方法面 | 同上 |
| F8 生成式目录可机械化比对 | **已采纳为本次方法** | 见下节 |
| F9 权限预设 never→ask | 不击中 | 本插件无审批面（不注册 PreToolDecision / ApprovalRequest） |
| F10 i18n 配对格式 | 不适用 | 本插件自有 locales.ts，不参与该配对机制 |
| F11 peer 范围覆盖 rc.2 | 结论一致 | 本插件 peer 为 `>=0.1.7-rc.1 <0.2.0-0`，语义覆盖 rc.2 |

## 符号级核对（rc.1 开发树 vs rc.2 实包）

运行时导出核对（从宿主 `DSH NEXT.app` 的 rc.2 实包直接 import）：

```
@deepseek-ai/dsh-atomic-write  withFileLock        ✓ 存在
@deepseek-ai/dsh-atomic-write  writeFileAtomic     ✓ 存在
@deepseek-ai/dsh-home-paths    resolveDshHome      ✓ 存在
@deepseek-ai/dsh-llm           resolveRetryPolicy  ✓ 存在
@deepseek-ai/dsh-llm-pi-ai     PiAiAdapter         ✓ 存在
```

类型级核对（rc.1 开发树 与 npm rc.2 实包逐符号）：

| 包 | 符号 | rc.1 | rc.2 | 签名 |
|---|---|---|---|---|
| dsh-llm | AdapterRegistrationHandle | ✓ | ✓ | 未变 |
| dsh-llm | DirectoryRegistrationHandle | ✓ | ✓ | 未变 |
| dsh-llm | resolveRetryPolicy | ✓ | ✓ | 逐字一致 |
| dsh-llm | registerAdapter / registerConfigurableProviders / registerModelDiscovery | ✓ | ✓ | 逐字一致（L253/281/297） |
| dsh-llm-pi-ai | PiAiAdapter | ✓ | ✓ | — |
| dsh-llm-pi-ai | ResolvedPiAiProviderProfile | ✓ | ✓ | — |
| dsh-home-paths | resolveDshHome | ✓ | ✓ | — |
| dsh-atomic-write | withFileLock | ✓ | ✓ | 逐字一致 |
| dsh-atomic-write | writeFileAtomic | ✓ | ✓ | 逐字一致 |
| dsh-attachment | AttachmentStore | ✓ | ✓ | — |

**注意方法上的一处坑**：宿主应用包 `DSH NEXT.app/.../node_modules/@deepseek-ai/` 内 `.d.ts` 数量为 **0**
（`find` 统计；运行时只发行 `.js`，`lib/types/*.js` 是值模块而非声明）。
直接拿该路径做类型比对会得到「rc.2 全 ✗」的**假破坏面**——本次第一轮比对正是如此被否掉的。
正确的 rc.2 类型来源是 npm 实包（`registry.npmjs.org/.../-/dsh-<pkg>-0.1.7-rc.2.tgz`）。

## F3：本插件唯一真实接缝，性质是部署约束

`src/auth.ts:4` 直接消费 `withFileLock` / `writeFileAtomic`：

```ts
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
// L494 写入 ~/.dsh/.trae-auth.<region>.json（凭证刷新结果）
```

rc.2 新增锁接管（`atomic-write` L10 注释「A lock whose recorded holder process no longer exists is
taken over.」），边界在 L181：「other PID namespaces sharing the file are unsupported and could both hold」。

对本插件的含义与 F3 对 LDVH 的结论**同形**：

- 方向上纯改善：此前崩溃遗留的 `.trae-auth.*.json.lock` 需人工清理，现在自动接管；
- 风险是条件性的：锁文件落在 `resolveDshHome()` 下（本机为 `~/.dsh/`），单机单 PID namespace 不触发；
- **但本插件有一条 LDVH 没有的触发路径**：`docs/WSL2_CLI_PROBE.md` 记录的 WSL2 用法（issue #5）是
  「Windows 装 Trae + WSL2 里跑 DSH」。若 `$DSH_HOME` 被放在 Windows 侧并经 `/mnt/c` 挂载，
  Linux 与 Windows 是两套 PID namespace 而共享同一份文件——**正是 L181 警告的形状**。
  该场景下两个宿主进程可能同时认为对方已退出并各自持有锁。

当前实现不触发（本机为 macOS 单命名空间），故记为**部署约束**而非待办，与 F3 对 LDVH 的分级一致。
是否要在 WSL2 文档里加一行提示，属需要你定夺的取舍，未擅自改动。

## 一处「看起来像问题但不是」的项

`dsh-client-runtime` 在 rc.2 宿主中不存在，而本插件源码有该字符串。核对结果：
它出现在 `src/client/index.tsx:16` 的**注释**里（说明 DSH 0.1.2 已删除该包、其服务已迁走），
不是 import。粗看「源码引用了 rc.2 缺失的包」会误判为破坏面，实际不是。

## 未做的事

- 未改动任何源码、文档或版本号。本核对结论是「无需修改」，故不产生代码变更。
- 未把本插件加进 LDVH 仓的对话或对象系统（该仓 `governed-projects.yaml` 未列本仓，
  且本会话 LDVH 管辖判定为 not_governed）。
- 未对 rc.2 做端到端运行验收（本插件的 UI 四项目前跑在 rc.2 宿主上，但那属于既有状态，
  不构成本次变更的验收）。

## 若要落地，可选的两项（均非必须）

1. **开发树提到 rc.2**：`devDependencies` 现为 `0.1.7-rc.1`，而用户运行时是 rc.2，
   typecheck/测试实际验的是 rc.1 的类型。peer 范围已覆盖 rc.2 且本次比对证实无差异，
   因此这是「让开发树与运行时一致」的卫生项，不是修复。
   落地需要 pnpm（本机未安装，仅 npm 可用），故未执行。
2. **WSL2 文档补一行**：把上面 F3 的跨 PID namespace 条件写进 `docs/WSL2_CLI_PROBE.md`。
