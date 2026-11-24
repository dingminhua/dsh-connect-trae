# 等 DSH 0.2.3 正式版要一起做的事

> 状态：**等待中**。当前 `@deepseek-ai/dsh-llm-pi-ai` 的 dist-tags 是
> `latest: 0.0.1-rc.1` / `next: 0.2.2-rc.5` / `alpha: 0.2.3-alpha.2`——**正式版 0.2.3
> 尚未发布**，所以下面这些现在做不了。
>
> 建立时间：2026-11-24。触发条件：`npm view @deepseek-ai/dsh-llm-pi-ai versions` 里
> 出现不带预发布后缀的 `0.2.3`。

---

## 为什么这些事捆在一起

它们有**同一个根因**：本插件声明支持的 peer 范围（`>=0.1.7-rc.1 <0.3.0-0`）覆盖了
正式版 0.2.3，但 `devDependencies` 一直钉在 `0.2.2-rc.5`。于是类型检查与测试**从来没跑在
0.2.3 上**，0.2.3 的接口变化不会被 `tsc` 拦住。

issue #96 就是这么漏到用户那里的：0.2.3 改了字段名并新增必填字段，插件的手搓 profile
少写了它们，类型检查因为看不到新字段而**通过**了。

单独补任何一条，都只是再绕一次类型环境。等 0.2.3 正式版把 devDependency 提上去，
剩下的都是干净的加法。

---

## 待做清单

按顺序做，前两步是基础：

### 1. 升级 devDependencies 到 0.2.3 正式版

`package.json` 里这四个：

- `@deepseek-ai/dsh-llm-pi-ai`
- `@deepseek-ai/dsh-attachment`
- `@deepseek-ai/dsh-attachment-local`
- `@deepseek-ai/dsh-host-webserver`（新增；目前没直接依赖，但第 3 步要它的类型）

同时复核 peer 范围是否仍然正确。**注意预发布语义**：`<0.3.0-0` 按 semver **不包含**
`0.2.3-alpha.2` 这类预发布版本，却包含正式版 `0.2.3`。issue #96 的报告者跑的正是 alpha。
要么把范围写宽到接受预发布，要么在 README 里明确「alpha 不在支持范围内」——现在两者
都没有，属于声明与现实的偏差。

### 2. 删掉 `PiAiImageBudgetFields023`

`src/adapter.ts` 里那个本地接口是**临时补丁**，存在只因为类型环境落后于 peer 范围。
devDependency 提到 0.2.3 后，`ResolvedPiAiProviderProfile` 就有 `maxImageBytes` 与
`requestImageBudgetCount` 了，改回直接 `Pick<ResolvedPiAiProviderProfile, ...>`。

留着它的害处：会让人以为这两个字段是「插件自己定义的」，而不是宿主契约。

### 3. 给三条只读路由加 `auth: 'anonymous'`（issue #99）

见 [`ISSUE99_DIAGNOSIS.md`](ISSUE99_DIAGNOSIS.md)。只有这三条：

| 路由 | 方法 |
| --- | --- |
| `/plugins/dsh-connect-trae/usage` | GET |
| `/plugins/dsh-connect-trae/account-credits` | GET |
| `/plugins/dsh-connect-trae/account-status` | GET |

五条写入 POST 路由（`accounts`/refresh、`transfer`、`models/refresh`、`models/test`、
`checkin`、`pool`）**保持 `required`**——它们现在 401 是正确行为。

注释要写**真实理由**：不是「有回环守卫所以安全」（`loopbackOrigin()` 只看 `Origin` 头，
本地进程不带这个头，直接放行），而是「0.2.2 及更早这些路由本来就没有鉴权，这是把既有
事实显式化」。

### 4. 补两条先红后绿的测试

**这一条是关键，别省。** 上面两个 bug 的本质都是「注册/构造时少了一个字段」，只有断言
**对象的内容**才能挡住，断言 HTTP 行为需要真宿主。

- 断言三条只读路由的注册对象带 `auth === 'anonymous'`；
- 断言五条写入路由**不带** `auth`（防止顺手放宽写入路由）；
- 断言 profile 字面量带 `maxImageBytes` 与 `requestImageBudgetCount`（issue #96 已有的
  `tests/adapter-image-budget-023.spec.ts` 覆盖，升级后应仍然通过）。

### 5. 真机验证

装 0.2.3 正式版后：

- 会话里带图发一轮 → 不应报 `Image request maxImageBytes must be a positive integer.`；
- 无 Cookie 的进程内 `fetch` 打 `/plugins/dsh-connect-trae/usage` → 应从 401 变 200。

---

## 升级时还要顺带检查的

0.2.3 正式版可能与 alpha.2 还有差异。升级后跑一遍 `pnpm run check`，重点看：

- `resolveProfiles()` 相关字段的必填性有没有再变；
- `authPolicy` / `websession/authorize` 的策略枚举（`anonymous` / `required` / `deny`）
  有没有增删；
- 有没有别的 `WebRoute` 新增字段。

diff 方法：`npm pack @deepseek-ai/<pkg>@0.2.2-rc.5` 与 `@0.2.3`，解包后比
`lib/types/*.d.ts` 与 `lib/index.js` 的字节数。这个仓库的既有做法，见
`ISSUE96_DIAGNOSIS.md` 与 `ISSUE99_DIAGNOSIS.md` 里的实测表。
