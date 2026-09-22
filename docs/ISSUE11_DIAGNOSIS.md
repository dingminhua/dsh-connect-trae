# issue #11 取证：能否关掉「国际版」或「国内版」其中一个供应商

> issue：https://github.com/dingminhua/dsh-connect-trae/issues/11
> （tendun：「能禁用国际版或国内版吗，有没有配置的地方」/「比如说我根本用不到国际版」）
>
> 日期：2026-09-22 ｜ 版本：2.0.5 ｜ 结论：**原状无解，已按「区域开关」实现**

## 结论

**用户想要的效果（关掉不用的一侧，让它从 DSH 模型选择器里彻底消失）在 2.0.5 上做不到**，
而且**现有的配置项 `edition` 无法达到这个效果**——这是一个很容易走错的方向，见下节。

同时这个诉求是合理的：无账号的一侧并不是「安静地待着」，它有两个实际代价：

1. **模型选择器被污染**：无账号区域会回落到内置兜底目录（国际版 7 条：Gemini-3.1-Pro /
   Gemini-3-Flash / MiniMax-M3 / M2.7 / Kimi-K2.5 / GPT-5.4 / GPT-5.2），这些模型**根本调不通**
   （`store.resolve()` 抛「no signed-in account」），却和可用模型并排出现在选择器里。
2. **启动期恒定的失败面**：每次启动都会为该区域拉一次目录（必然失败），把
   issue #8 那一类「无账号区域报错」的失败面一直留着。

## 为什么 `edition: "cn"` 不能解决问题

`edition` 是**凭据来源提示（credential hint）**，只收窄「扫描哪些本地安装目录」，
它不参与 provider 注册。核实过的代码路径：

- `src/index.ts` 的注册循环对 `REGION_KEYS = ['cn','ai']` **无条件**注册两个 adapter：
  ```ts
  for (const region of REGION_KEYS) {
    ...
    if (region === 'cn') releaseAdapterCn = ctx.llm.registerAdapter([TRAE_PROVIDER], trae.adapter)
    else                 releaseAdapterAi = ctx.llm.registerAdapter([TRAE_AI_PROVIDER], trae.adapter)
  }
  ```
  这里没有任何 `enabled` 判断。
- `edition` 只进入 `TraeCredentialStore` 的 `candidates()` 过滤（`src/auth.ts`），
  影响的是「找得到哪些账号」，不是「注册哪些 provider」。
- 于是 `edition: 'cn'` 时国际栈照样注册，只是拿不到账号 → `configuredModels` 回落到
  `fallbackModelsFor('ai')` → **`trae-global` 依旧出现在模型选择器里**。

**卸载国际版 App 同理**：兜底目录是插件自带的静态表，与本地是否安装无关。
这正是 issue #8 那位用户（hackxmli）遇到的情形。

## 实现方案：区域开关（opt-out）

### 语义

| 项 | 决定 |
|---|---|
| 配置位置 | `regions.<cn\|ai>.enabled`——复用已有的区域槽位，不新增配置结构 |
| 默认值 | **开启**（opt-out）。只有显式 `false` 才关闭 |
| 兼容性 | 开关出现前的配置、以及区域拆分前的扁平字段（从不携带 `enabled`）→ 一律视为开启，**老用户零感知** |
| 卡片 UI | 每个 tab 右侧一个勾选，默认勾选，取消即关闭该供应商 |

### 关闭一个区域时到底发生了什么

「隐藏 tab」是不够的——用户明确要的是「该版本的供应商**不出现**」。所以关闭动作要落到注册层：

1. **抽掉 adapter 路由**：`AdapterRegistrationHandle.replace([])`。
   这是**真正让它从 DSH 模型选择器消失**的一步。DSH 的类型文档明确支持空数组：
   > An empty array is legal here (a settings section that emptied holds zero routes while staying registered), unlike an empty initial registration.

   注意「初始注册」必须非空（`INVALID_ADAPTER`），所以实现是**先正常注册、再 `replace([])`**；
   两步在同一个同步段内完成，没有可观测的路由空窗。
2. **抽掉供应商目录条目**：`DirectoryRegistrationHandle.replace([])`。
   否则「设置 → 模型」页仍会列出这个供应商（只是标为未激活）。
   该 handle 是**一条注册持有两个条目**，所以 `replace` 必须一次性给出「启用集合的完整列表」——
   按区域分别 replace 会让后者覆盖前者，把启用的一侧一起弄丢（这个 bug 在开发中被集成测试当场抓到）。
3. **跳过启动目录发现**：关闭的一侧不再发 Remote/SOLO 请求——省掉无意义的网络往返，
   也让「无账号区域每次启动都报一次错」这个失败面消失。
4. **模型发现兜底**：`registerModelDiscovery` 对已关闭区域直接返回 `[]`（纵深防御，
   防的是模型选择器里残存的刷新请求）。

### 状态不丢

开关写入走 `nextRegionEnabled()`（`src/status-paths.ts`）：**只改目标区域的 `enabled` 一个字段**，
该槽位的目录 / 勾选 / 图片开关 / 上下文预算，以及另一个区域的整个槽位，全部原样带过。
所以「关掉 → 再打开」能完整恢复用户的选择。

对应地，卡片保存模型目录时必须**回写 `enabled`**——那次写入会替换整个槽位，
漏掉它就会「保存一次模型列表 = 悄悄重新打开已关闭的供应商」。

### 代价（已知且不可避免）

若某个会话此前选中了被关闭供应商的模型，路由消失后该会话再调用会报
`NO_ADAPTER`（`no adapter registered for provider "..."`）。
这是「彻底移除」的必然结果，**不能静默失败**——卡片在该 tab 上给出明确提示文案
（`row.tabOffNotice`）。

### 读同一份真相

两侧读的是**同一条规则**，避免卡片显示与 Host 实际注册状态不一致：

- Host：`regionEnabled(config, region)` → `regionStateOf(config, region).enabled !== false`
- 卡片：`regionEnabledOf(regions, region)` → 同一个 `!== false` 判定
- 卡片不猜状态，而是读 Host 随文档下发的 `enabled`（signed-in / signed-out 两个分支都带），
  因为**未登录的区域恰恰是用户最想关掉的那一个**

回归测试 `region.spec.ts` 用 8 种畸形/正常形状交叉比对这两个函数，锁定它们永不分歧。

## 测试

| 测试 | 锁定的不变量 |
|---|---|
| `region.spec.ts` · region enable switch | 缺省开启、只有显式 `false` 关闭、卡片侧与 Host 侧判定一致、开关往返不丢模型状态 |
| `region.spec.ts` · 整段 vs `regions` 子对象 | **同一个判定必须同时接受「整个 settings 段」和「`regions` 子对象」两种入参**（见下方事故记录） |
| `settings-integration.spec.ts` · per-region provider switch | 关闭后 `listProviders()` 不含该 provider、**模型选择器的分组也消失**（按 `listProviders()` + `listModels()` 复刻选择器取数逻辑）、目录条目同步消失、不影响另一侧、重启后仍生效、两个都关仍可恢复、旧配置（无 `enabled`）两边都开 |
| `web-status.spec.ts` · region on/off | `enabled` 在 signed-in / signed-out 两个分支都下发，且按请求的区域取值 |

开发中做过变异验证：把「抽掉路由」改成「照常注册」（即只隐藏 tab 的假实现），
上述 2 条集成测试立刻失败；把目录 `replace` 改回按区域调用，4 条失败。
测试确实咬得住，不是空转。

## 事故记录：勾选点了没反应（已修复）

**症状**：用户点击复选框没有反应，勾选状态永远不变。

**根因（真机复现，不是推测）**：卡片把**整个 settings 段**传给了 `regionEnabledOf`，
而该函数期望的是 **`regions` 子对象**。于是它去查 `section['cn']` —— 不存在 ——
判定永远返回 `true`。结果：

- 复选框**恒定显示为勾选**，点击后看起来毫无变化；
- **写入其实是成功的**（真机 settings 里确实落下了 `cn: false` / `ai: false`），
  只是 UI 读错了地方，所以「点了没用」；
- Host 侧注册逻辑正确，路由确实被撤掉了 —— 问题**只在卡片的读取**。

**为什么之前的测试没抓到**：测试直接调 `regionEnabledOf(regions, ...)`，
传的是**正确的**那半参数；而卡片传的是另一半。**没有任何测试覆盖卡片的调用点**，
这是漏测的关键缝隙。我先前声称「验证过」，实际验证的是 Helper 与 Host，
**没有真正点过那个控件**。

**修复**：`regionsMapOf()` 让这两个 Helper **同时接受两种入参**（整段或子对象），
并统一由它收口，使「传错一半」在结构上不再可能静默返回 `true`。
新增 2 条回归测试分别覆盖「整段入参」与「返回值必须是 `regions` 子对象」；
把 `regionsMapOf` 的拆包逻辑改回原样，这 2 条立刻失败（已实测）。

**仍未闭合的缺口**：本仓库 `vitest.config.ts` 只收 `tests/**/*.spec.ts` 且
`environment: 'node'`，**无法渲染 React 组件**，所以「真实点击」仍未纳入 CI——
这正是本次事故的结构性原因。后续应引入 jsdom + `@testing-library/react`、
放开 `.spec.tsx`，把「点一下复选框 → 断言 settings 落值 + 勾选态翻转」变成自动化用例。

### 缺口已闭合：真实点击测试

上述缺口已补上。`tests/card-region-switch.spec.tsx` 渲染**产品代码里的真组件**
（`src/client/TraeUsageCard.tsx`），用 `fireEvent.click` 点击真实 `<input type=checkbox>`，
断言两件事：**settings 的写入值**（`regions` 字段、只改 `enabled`、不丢同级字段）
与**渲染出的勾选态**。8 条用例覆盖：

- 空配置 → 两个都勾选；
- 存了 `enabled:false` → 该框**显示为未勾选**（即当初的回归点）；
- 点击 → 写入 `{cn:{enabled:false}}`，且勾选态翻转；
- 重新启用 → 保留 `enabledModelIds` / `contextBudgets`；
- 点第二个框写的是 `ai`（不是当前 tab）；
- 点框**不会切 tab**（这正是把开关放在 button 外面的原因）；
- 关闭态的 tab 面板给出说明文案；
- settings 不可写时复选框禁用。

**变异验证（实测）**：把 `regionsMapOf` 的拆包逻辑改回出 bug 的样子，
这 8 条里**4 条立刻失败**，其中就包括「存了 false 却显示为已勾选」——
与用户看到的症状完全一致。测试确实咬得住。

配套改动：`vitest.config.ts` 放开 `.spec.tsx`；`tsconfig.json` 排除 `.tsx` 测试、
`tsconfig.client.json` 收入（组件测试要 JSX + DOM lib）；
新增 devDependencies `jsdom` / `@testing-library/react` / `@testing-library/dom` /
`react-dom@18`（对齐仓库的 React 18）。
`@deepseek-ai/dsh-client-ui-primitives` 会拉入浏览器专用的 CSS modules，
测试里整体 mock 掉它（卡片只用到其中一个图标），**产品依赖契约不变**。
