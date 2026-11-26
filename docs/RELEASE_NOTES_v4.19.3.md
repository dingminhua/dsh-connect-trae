## v4.19.3（2026-11-26）

> **同一个 `400` 还有别的形状，签到重试也还没真的换号。** 这一版补上 4.19.2 漏掉的三个缺口，并让 9074 重试在当天的第二轮起也能拿到没被拒过的设备号。

### 一、schema 补根修复漏了三格

4.19.2 修了 issue #98 报告的那个形状，但审计发现同一个 seam 上还漏三种，都会照旧整轮 `400`：

| 漏掉的形状 | 为什么会命不中 |
| --- | --- |
| 参数名恰好叫 `type` / `name` / `description` / `title` / `enum` / `const` / `strict` | 第一版按**键名**判断「这像不像属性映射表」，这些参数名让它被误判成 schema，包裹分支直接跳过 |
| `parameters: {}`（无参工具） | 留空也被当作「不是映射表」，而 `defineTool()` 会编译成 `{ type: 'object', properties: {} }` |
| `type: 'json'` 的叶子 | DSH 的 `json` 表示「任意 JSON 值」，JSON Schema 里写成没有 `type`；`json` 不是合法类型值，同一个严格后端会拒 |

**改法**：判断依据从「键名」换成「**值的形状**」——schema 的 `type` 是字符串，而叫 `type` 的参数映射到的是对象。DSH 的参数名不受限制，`rename({name:{type:'string'}})` 完全合法，这种工具不该因为参数起名就被判死。只有 `properties` / `parameters` 两个容器键仍然无条件排除（它们的值形状重叠到无法区分）。

`{}` 现在也会被包裹：在 `parameters` 这个位置上它只有一个读法，就是无参工具。

**边界没变**：其它畸形 schema（属性里 `required: 5`、`type` 拼错、`required` 列了不存在的字段）照样会把整轮打挂——这是 seam 守卫，不是 schema 编译器，替调用方静默改写语义比报错更糟。

### 二、9074 重试号按「轮次」换新

4.19.2 给自动签到加了 `9074` 换号重试，但重试号的盐只有「本机号 + 账号 + attempt」，**不含日期也不含轮次**——于是每一天每一轮算出的 `attempt 1` / `attempt 2` 都是同样两个号。

自动签到每 30 分钟跑一轮。某天第一轮三个号全被 `9074` 拒掉之后，**当天剩下十几轮重发的还是那三个已被拒的号**：修复只把「结构上不可能」推迟了一轮，没有消除。

现在盐里多了当天已失败批次数，从状态文件一路传到派生函数：

```
checkinRetryDeviceIdOf(base, accountId, attempt, round)
AutoCheckinDeps.run(done, round) → poolDepsOf(panel, done, round)
  → TraePoolRunnerDeps.checkinRound → claimCheckinOf(credential, attempt, round)
    → checkinDeviceIdFor(..., attempt, round)
```

三个刻意的选择：

- **`round` 为 0 时哈希串与改动前逐字节相同**，一天里没撞过第二次 `9074` 的批次行为完全不变。
- **手动签到走 3 参调用**，仍是当天那个稳定号，不受自动签到的轮次影响。
- **不用时间戳当盐**：重启会从状态文件读回同一个 `failures`，同一轮内算出的号依然可复现，不会因为重启就变成一批新设备号——那恰好是风控最易识别的形态。

### 三、把真实积分数值从仓库里清掉

4.19.1 的 CHANGELOG 写了两个账号的**真实**积分数值（原文还自述「两个数都是真的」），同一组数字也进了 `src/account-pool.ts` 的注释与 `tests/account-pool.spec.ts` 的夹具。而 CHANGELOG 随 npm 包分发。

`tools/demo-accounts.ts` 自己写着「a balance is as identifying as the account name」，这条正是它禁止的事。现在 CHANGELOG 改成量级描述，源码注释与测试夹具换成编造的数值。历史不重写（既有决定），4.19.1 那一节保持原样。

**为什么两道门禁都没拦住**：`tests/privacy.spec.ts` 的 `FORBIDDEN_HASHES` 只哈希账号名 / id / 本机路径，`verify:privacy` 只看 PNG 字节、OCR 文本与版权署名——没有一条检查看数值型余额。「17 项全过」是真的，泄露也是真的。

### 四、文档与脚本的准确性

- `docs/ISSUE98_*`、发布说明里引用的 `@deepseek-ai/dsh-tools` 行号是错的（写成 `800-809` / `2762-2770`，实际 `274-283` / `433-445`）。已更正并标注以 `0.2.2-rc.5` 为准。
- 诊断里把「required 提升分支」误称为「包裹逻辑」——那个分支当时只提升 required，从不包裹。措辞已改。
- `@local/dsh-modes-pack` 的行号由报告者提供，本机未安装、未复核，已在文中标明。
- `src/account-pool-run.ts` 把实测间隔写成「five-minute gaps」，实际是间隔 5 秒，差 60 倍。
- `docs/PENDING_0.2.3.md` 写「五条写入 POST 路由」，实际列了六条。
- `RELEASING.md` 说 `verify:release`「共 20 项检查」，实际随包文件数变化（22～23 项）。
- `scripts/verify-release.mjs` 在没有随包文件改动时把「tag 之后的提交」打印成「无」，读起来像「没有任何提交」，会掩盖 tag 不是分支顶端。改成报文件数。
- `AGENTS.md` 说 pack 清单不该有 `scripts/`，但 `scripts/verify-windows.mjs` 是在 `files` 白名单里**有意**随包的。

### 五、补记 4.19.2 漏写的一项

4.19.2 的发布说明只写了 issue #98，但同一版**还**含 PR #104 的三处用户可见改动（首发错开 0～20 分钟、退避加 0～20% 抖动、`9074` 换号重试两次），双语 README 都已描述，CHANGELOG 与 Release 却一字未提。这一版补记，并写清从 4.19.0「不做轮换、不重试」到换号重试的**转向理由**：`9074` 是名额挤兑不是风控（换指纹 / UA / 号形状全部无效），且发放侧按「账号 × 自然日」去重，换号重试不产生多一份奖励。

### 测试

`tests/raw-chat.spec.ts` 净增 3 条（参数名撞关键字、空映射表、`json` 叶子），`tests/account-pool.spec.ts` 净增 3 条（派生按轮次换号、runner 传轮次到位、「轮次必须从 deps 读」的守卫）。

全部**先确认失败**再实现：
- schema 三条：`Tests 3 failed | 14 passed`
- 轮次两条：`expected 2 to be 4`——两轮算出的号确实是同一组

每条都做了变异验证，把修复逐个改坏，对应用例立刻红。

**接线时踩的坑记在这里**：轮次的第一版只写成 `claimCheckinOf` 的默认参数，忘了把 `checkinRound` 放进 `TraePoolRunnerDeps`——`deps.checkinRound` 恒为 `undefined`，runner 归一化成 0，每个轮次又退回同一个号。`tsc` 完全看不见（默认参数让字段缺失也能编译），测试也绿。补上字段后加了一条守卫用例专门钉住这条线。

全仓 118 文件 / 1554 例全过；typecheck 双 tsconfig 0 error；build 完成；`verify:privacy` 17 项全过、无 SKIP。

**Full Changelog**: https://github.com/dingminhua/dsh-connect-trae/compare/v4.19.2...v4.19.3
