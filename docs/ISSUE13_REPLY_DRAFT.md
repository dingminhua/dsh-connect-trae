# issue #13 回复草稿（发布 2.2.0 之后再贴）

> 用途：回复 https://github.com/dingminhua/dsh-connect-trae/issues/13
> （zuojinxin：`pending (waiting for service: settingsScope)`，DSH 0.1.7-rc.1 / Windows）
>
> **2.2.0 已发布**（`npm view dsh-connect-trae version` → 2.2.0），可直接复制横线以内的内容。

---

感谢这份报告——**根因定位完全正确，一行都没错**。`inject` 里的 `settingsScope`
（你指的 `lib/client.js` 约 1220 行）和 `ctx.settingsScope.bind({ namespace: "trae" })`
（约 1246 行）确实是问题所在，2.1.0 与 2.0.6 都是同一份代码。**v2.2.0 已修复并发布。**

## 你的诊断与我实测的一致

逐版本核对过 `dsh-client-ui-settings` 的 tarball：

| DSH 版本 | `settingsScope` | `configForms` |
| --- | --- | --- |
| 0.1.5-rc.2 | ✅ | ❌ |
| 0.1.6-alpha.2 | ✅（兼容层） | ❌ |
| **0.1.7-alpha.1 起** | **❌ 整个移除** | ✅ |

所以「不是 2.1.0 的回归、而是 0.1.7 上的新问题」这个判断也是对的。你引用的
`dsh-model-fix` / `dsh-image-gen` 我没有核对（前者在 npm 上查不到），
不过结论不受影响——适配目标就是 `configForms`。

## 有一处要更正：建议的修法

你建议改成 `inject: [slots, locale, remote, remote.settings]`。**方向可以走通，但不是最短的路**：

- `remote.settings` 在 **0.1.5 上也存在**（0.1.5 的 ui-settings 自己就 inject 这两个），
  所以它不是「0.1.7 的标志」；用它去实现 `bind({namespace})` 的语义还得自己写一层
  `createSettingsScope`（`describe()` / `mutate()` 的封装），而 `configForms` 是 0.1.7 的
  **官方对应物**。
- 更省事的是：`configForms.get(entryId)` 返回的快照字段
  （`status` / `value` / `base` / `user` / `revision` / `writable` / `mode`）与 0.1.5 的
  `SettingsScopeSnapshot` **逐字段一致**，卡片组件几乎不用改。

另外你列的两处改动（`inject` + `bind` 替换）**不够**——0.1.7 上这个插件一共断了**五处**，
只改设置服务的话，就算 fiber 能激活，卡片仍然出不来。

## 0.1.7 上实际有五处断裂

| # | 位置 | 0.1.5 | 0.1.7 | 不修的表现 |
| --- | --- | --- | --- | --- |
| 1 | 客户端设置服务 | `settingsScope` | `configForms` | fiber 永久 PENDING（**你报的这个**） |
| 2 | 客户端槽位名 | `settings.plugin.item` | `plugins.bundle.config` / `plugins.row.config` | 两条线槽位集**互不相交**，卡片渲染不出来 |
| 3 | 宿主端注册 | `installSection()` | `configure({auto}, owner)` | `trae` 设置命名空间不注册，设置区无声消失 |
| 4 | schema 可写声明 | 无需 | 必须标 `volatile()` | 写入被拒（`has no volatile fields`），而 `set()` 却正常 resolve → **开关翻过去又静默复原** |
| 5 | primitives 图标名 | `…Outline14` | `…OutlineRegular` | 静态导入让**整个客户端包解析失败**，卡片直接挂掉 |

第 2、3、4 条是我参照同作者的 `dsh-connect-workbuddy` 的实测记录核对的
（那边已经用同一套适配跑通 0.1.7）；**第 5 条是我对照两条线 primitives 的实际导出发现的**。

第 4 条值得单独说一句：0.1.7 的写入门要求插件把可写字段标为 volatile，否则**写入被直接拒绝**，
但 `scope.set()` 的 promise 照样 resolve——所以是「看着保存成功、随后悄悄回滚」。
现在加了 `asVolatile()`：运行时探测 `schema.volatile()`，有就调用、没有就退化为恒等 no-op
（`volatile()` 自 schemastery 3.18.3 起才有，0.1.5 线锁在 3.18.2）。

顺带还修了两类静默失败：

- **活引用**：0.1.7 把 volatile 字段以 `{get(): T}` 交给消费方。不解包则 `config.regions`、
  `value.accounts[region]` 静默变成对象或 `undefined`；更隐蔽的是**展开一个活引用得到的是
  `{get: <function>}` 而不是值**，卡片「写一个区域、保留另一个」的合并会因此**丢掉兄弟区域**。
- **写入未落盘**：`set()` resolve 不代表值已落盘。四处写入统一加了回读校验，没落盘就明确报错，
  而不是「点了没反应」。

## 做法：一个构建同时服务两条线

不是「多支持一个版本」，而是**同一个包**在运行期按能力探测：

- `inject` 收窄为两条线都有的 `['slots', 'locale']`，设置面改用 `ctx.get()` **软探测**。
  这里有个坑值得记一下：**属性访问会抛 `cannot get property X without inject`，`?.` 挡不住**
  ——只有 `ctx.get()` 对缺失服务返回 `undefined` 而不抛错。
- 三个槽位**各自独立 try/catch** 逐个注册，一条线上不存在的槽位不会把另一条线的注册一起带走。
- 折叠箭头改成**纯 CSS**，不再静态导入图标（两条线图标名不重叠，静态导入必然在其中一条上失败）。

## 升级

```bash
dsh plugin --profile desktop add dsh-connect-trae
# 或
npm install dsh-connect-trae@2.2.0
```

**装完要重启 DSH 进程**，然后确认卡片回来了、设置区能看到「国内版 / 国际版」两个 tab。

## 这次是怎么验证的（免得再漏）

新增的 `tests/client-activation.spec.tsx` 用真实 cordis `Context` **启动真实的客户端入口模块**，
分别对 0.1.7 / 0.1.5 / 无设置面三种宿主形态断言 fiber 到达 `ACTIVE`。

之所以专门写这个：仓库原有的 `client-fallback.spec.ts` 是**手工镜像**入口函数体的，
验证的是「思路」而**从不执行真实的 `inject` 数组**——而恰恰是那个数组让你的 fiber 卡死，
所以它一路绿灯。现在把 `inject` 改回含 `settingsScope`，这条测试立刻变红
（fiber 停在 PENDING），精确复现了你报的现象。

测试总数 282 → 310，并在 schemastery 3.18.4（volatile 生效）与 3.18.2（no-op）下均通过。

如果升级后还有问题，麻烦带上 `npm view dsh-connect-trae version` 的输出和浏览器控制台里
`[dsh-connect-trae]` 开头的行，我再看。
