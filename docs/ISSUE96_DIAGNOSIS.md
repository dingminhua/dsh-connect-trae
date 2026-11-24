# issue #96 诊断：DSH 0.2.3 上每次请求都失败在 `Image request maxImageBytes must be a positive integer.`

> issue：<https://github.com/dingminhua/dsh-connect-trae/issues/96>
> （「使用Trea中的模型-deepseek-v4.1-flash失败」）
> 诊断时间：2026-11-24　方法：读代码 + 装真实的 `0.2.3-alpha.2` 包在本机跑对照 + 端到端复现
> 状态：**插件缺陷（手搓的 resolved profile 少了一个 0.2.3 新增的必填字段）**。本版补齐。

---

## 0. 一句话结论

DSH 0.2.3 给**解析后**的 provider profile 新增了一个必填字段 `requestImageBudgetCount`
（字节预算的除数），并把每图上限从 `requestImageMaxBytes` 改名为 `maxImageBytes`。
这两件事都由宿主的 `resolveProfiles()` 完成——而**本插件从不走那条路**：它从活的 Trae 目录
手搓 `ResolvedPiAiProviderProfile` 字面量（`src/adapter.ts` 的 `profileFor`）。于是两个字段
对这两条路由都不存在。

缺了除数，宿主的预算函数除出 `NaN`；`NaN` 又恰好骗过了它自己的守卫，一路走到附件层，
被当成非法值拒掉——**这就是报告者看到的那个报错，而且它跟图片毫无关系**。

---

## 1. 现象

报告者（DSH `0.2.3-alpha.2-4b399c3-dirty`，国内版，模型 `deepseek-v4.1-flash`）：

| 字段 | 值 |
| --- | --- |
| 状态 | 失败 |
| 工具调用 | 0 |
| 错误 | `Image request maxImageBytes must be a positive integer.` |
| 耗时 | 378 毫秒 |
| 用量 | 未报告 |

三个特征锁定了排查方向：

1. **378 毫秒、0 次工具调用** —— 请求根本没出网，失败发生在本地序列化阶段。
2. **错误里提到 `maxImageBytes`** —— 这个词在 0.2.2 的代码里**一次都没出现**，是 0.2.3 的
   新名字。所以问题一定出在 0.2.2 → 0.2.3 这条升级线上。
3. **报告者确认「图片选项是被勾选的，并且无法勾选掉」** —— 但即便能关掉也没用，见第 5 节。

---

## 2. 根因：手搓 profile 绕过了宿主的两处改名/补默认

0.2.3 的 `ResolvedPiAiProviderProfile` 与 0.2.2 相比，图像相关的字段变化（直接从两个包的
`lib/types/config.d.ts` 里 diff 出来）：

| 字段 | 0.2.2 | 0.2.3 |
| --- | --- | --- |
| `requestImageMaxBytes` | **必填** | **已删除**（改名） |
| `maxImageBytes` | 不存在 | 可选（`requestImageMaxBytes` 的解析后名字） |
| `requestImageBudgetCount` | 不存在 | **必填** |

`resolveProfiles()` 在 0.2.3 里负责把配置拼写 `requestImageMaxBytes` 映射成解析后拼写
`maxImageBytes`，并给 `requestImageBudgetCount` 填默认值 20。**本插件不跑这个函数**，
所以映射和默认值都不会发生。

而 `src/adapter.ts` 里的 `REQUEST_IMAGE_BUDGETS` 当时还是 0.2.2 时代的五个字段：

```ts
const REQUEST_IMAGE_BUDGETS = {
  maxRequestImageBytes: 20_971_520,
  requestImagePixelBudget: 4_194_304,
  requestImageMaxBytes: 1_048_576,   // 0.2.3 已经不读这个了
  maxRequestImages: 50,
  imageOffloadCountQuantum: 10,
  // 没有 maxImageBytes，没有 requestImageBudgetCount
} as const
```

---

## 3. `NaN` 是怎么一路骗过守卫的

宿主 0.2.3 的 `resolveImageRequestBudget()`（`lib/index.js:1454-1466`，逐行核对过）：

```js
const allocatedBytes = Math.floor(profile.maxRequestImageBytes / profile.requestImageBudgetCount / 4) * 3
const maxImageBytes  = Math.min(allocatedBytes, profile.maxImageBytes ?? catalogBytes ?? 1048576)
if (maxImageBytes < 1) throw new LlmError('...', 'INVALID_CONFIG')
return { maxPixels: profile.requestImagePixelBudget, maxImageBytes, ... }
```

缺字段时逐行推：

| 步骤 | 表达式 | 结果 |
| --- | --- | --- |
| 除 | `floor(20_971_520 / undefined / 4) * 3` | `NaN` |
| 夹 | `Math.min(NaN, 1_048_576)` | `NaN` |
| **守卫** | `if (NaN < 1) throw INVALID_CONFIG` | **`NaN < 1` 是 `false`，守卫不触发** |
| 传递 | `requestImageTarget()` 把它写进 `{ maxImageBytes, imageTargetBytes }` | `NaN` |
| 拒绝 | 附件层 `checkedInteger(target.maxImageBytes, ...)` | `AttachmentError('Image request maxImageBytes must be a positive integer.', 'INVALID_ATTACHMENT_REF')` |

**最关键的一步是守卫失效**。如果 `NaN < 1` 为真，宿主会报 `INVALID_CONFIG` 并指出是图像
字节预算配置有问题——那是可读的。实际报出来的是 `INVALID_ATTACHMENT_REF`，指向附件引用，
把人往完全错误的方向带。

---

## 4. 为什么只有 0.2.3 会炸，而且一张图会毒掉整个会话

两个版本的 stream 入口处理图像预算的方式不同：

**0.2.2**（`lib/index.js:2131`）——直接把 profile 上的两个数传下去，**从不调用**
`resolveImageRequestBudget()`：

```js
requestImagePolicy: {
  maxPixels: profile.requestImagePixelBudget,
  maxBytes: profile.requestImageMaxBytes,
}
```

缺 `requestImageBudgetCount` 完全无害。

**0.2.3**（`lib/index.js:2127-2146`）——改成**提前、无条件**解析一次：

```js
const attachments = containsImage ? this.config.resolveAttachments?.() : void 0
if (containsImage && attachments === void 0) throw ...
// ...
const converted = attachments === void 0
  ? toPiContext(request, void 0, ...)
  : await toPiContext({...}, {
      attachments,
      // ...
      requestImagePolicy: resolveImageRequestBudget(model, profile)   // ← 提前算
    }, ...)
```

关键在 `containsImage` 扫的是**整个请求的 messages**，不是「这一轮新加的消息」：

```js
const containsImage = options.messages.some((message) => contentHasImage(message.content))
```

所以一旦会话里**曾经**出现过一张图，此后每一轮都会走 `attachments !== void 0` 那个分支，
每一轮都会把 `NaN` 算进 policy。

实测（真实的 0.2.3 包，修复前的 profile）：

```text
[1 pure-text                  ] OK
[2 text turn, image in history] THROW INVALID_ATTACHMENT_REF
```

也就是说：

- 会话里**从没出现过图片** → 一切正常；
- 会话里**出现过一张图** → **此后每一轮都失败**，包括纯文字轮次，而且**永远不会自己恢复**
  （历史里的图不会消失，除非压缩把它丢掉）。

这比「只有带图的那一轮失败」严重得多，也解释了报告者的 378 毫秒：第一张图进来之后，
那条会话就废了。而最常见的场景恰好是**把截图粘进对话问问题**——正是本插件的多模态模型
被 Trae 标了 `multimodal`、图片勾选框又被强制打开的那类模型。

---

## 5. 为什么用户没法自己躲开

报告者说图片勾选框「无法勾选掉」。这是 issue #16 的既定设计：

- 能力 = **用户勾选 ∪ Trae 标的 `multimodal`**；
- 于是多模态模型的那一行渲染成**已勾中且只读**（`src/client/TraeUsageCard.tsx:2470`，
  `disabled={rowImageIsAutomatic(model) || ...}`）；
- 对应的提示文案是「已自动开启：Trae 把该模型标为多模态。」

结果：**任何 0.2.3 用户碰到多模态模型都躲不开**。这也解释了为什么这个 bug 一升级就
大面积出现，而不是个别配置问题。

---

## 6. 复现（用真实的 0.2.3-alpha.2 包，不是照着 changelog 猜）

装 `@deepseek-ai/dsh-llm-pi-ai@0.2.3-alpha.2` 与 `@deepseek-ai/dsh-attachment-local@0.2.3`，
把插件当时手搓的 profile 字面量原样注入 `PiAiAdapter`：

```text
[budget] requestImageBudgetCount = undefined
[budget] allocatedBytes = NaN | maxImageBytes = NaN | guard (maxImageBytes < 1) = false
[result] code    = INVALID_ATTACHMENT_REF
[result] message = Image request maxImageBytes must be a positive integer.
```

再跑**修复前/修复后**对照，走完整的 `PiAiAdapter.stream()`：

```text
[before-fix] code=INVALID_ATTACHMENT_REF message=Image request maxImageBytes must be a positive integer.
[after-fix ] reached the network layer (image accepted)
```

修复后用**构建产物 `lib/` 里真实的 profile**（不是测试里手写的）再跑三条路由：

```text
[trae]            count=14 share=1123473 resolvedCap=1048576 maxImageBytes=1048576
[trae-enterprise] count=5  share=1258290 resolvedCap=1048576 maxImageBytes=1048576
[trae-global]     count=14 share=1123473 resolvedCap=1048576 maxImageBytes=1048576
--- live adapter runs ---
[trae text ]            OK — passed the image gate
[trae image]            OK — passed the image gate
[trae-enterprise image] OK — passed the image gate
[trae-global image]     OK — passed the image gate
```

「0 次工具调用、378 毫秒」的成因到此闭环：第一张图进入历史后，该会话的每一次请求都在本地
序列化阶段就被拒，根本出不了网。

---

## 7. 修复：两个拼写都写，除数按路由给

### 7.1 两个拼写都写

peer 范围 `>=0.1.7-rc.1 <0.3.0-0` 同时覆盖 0.2.2 与 0.2.3，所以**一个对象要同时满足两条线**：

- 0.2.2 读 `requestImageMaxBytes`；
- 0.2.3 读 `maxImageBytes`；
- 各自忽略对方不认识的那个 key。

不需要版本分支。**不能删 `requestImageMaxBytes`**——删了 0.2.2 那条线就退回它自己的默认值。

### 7.2 除数是关键取舍

解析后的上限是 `min(份额, 显式上限)`。所以除数一旦让份额掉到 1 MiB 以下，
**真正决定上限的就变成了份额**，而那个显式写着的 1 MiB 常量成了摆设——没人会去查这个。

每条路由取**「份额仍高于 1 MiB」的最大除数**：

| 除数 | 消费者 20 MiB 份额 | 企业 8 MiB 份额 | 显式 1 MiB 上限是否生效 |
| --- | --- | --- | --- |
| **14** | 1,123,473 | 449,388 | 仅消费者路由 |
| **5** | 3,145,728 | 1,258,290 | 两条都生效 |
| 6 | 2,621,439 | 1,048,575（**差 1 字节**） | 仅消费者路由 |
| 20（宿主默认） | 786,432 | 314,571 | 都不生效 |

`floor(20_971_520 / 14 / 4) * 3 = 1_123_473`，而 **15 就掉到 1_048_575——差一个字节**。
企业路由 8 MiB 同理：5 给 1_258_290，6 给 1_048_575。

所以：**消费者路由 14，企业路由 5**。`requestImageBudgets()` 本来就是按路由返回的函数，
按路由给除数没有额外成本。若图省事全用 14，企业路由的每图上限会被悄悄压到 449,388 字节
（显式声明值的 43%）——那正是这个 bug 的另一种形态。

### 7.3 类型环境为什么没拦住

`devDependencies` 钉在 `@deepseek-ai/dsh-llm-pi-ai@0.2.2-rc.5`，所以类型检查环境里的
`ResolvedPiAiProviderProfile` **根本没有** `maxImageBytes` 和 `requestImageBudgetCount`。
直接在 `Pick<>` 里写这两个 key 会报 TS2344。

而 peer 范围 `>=0.1.7-rc.1 <0.3.0-0` 按 semver 规则**不包含** `0.2.3-alpha.2` 这样的预发布
版本，却**包含**正式版 `0.2.3`——也就是说插件对外声明支持一条自己从未测试过的线。
这正是这个 bug 能发布出去的原因。

修法：用一个本地接口 `PiAiImageBudgetFields023` 声明这两个 0.2.3 才有的字段，与
`Pick<ResolvedPiAiProviderProfile, ...>` 相交。这样在 0.2.2 的类型环境下也能编译，
且不假装 0.2.2 有这个字段。

**根本的修法是把 devDependency 提到 0.2.3 并让测试在 0.2.3 上跑**——那是后续独立的一步，
本版先让代码在两条线上都正确。

---

## 8. 本版改了什么

| 文件 | 改动 |
| --- | --- |
| `src/adapter.ts` | `REQUEST_IMAGE_BUDGETS` 补 `maxImageBytes: 1_048_576` 与 `requestImageBudgetCount: 14`；新增 `ENTERPRISE_REQUEST_IMAGE_BUDGET_COUNT = 5`；`requestImageBudgets()` 在企业路由同时覆盖这两个字段；新增 `PiAiImageBudgetFields023` 接口让 0.2.2 类型环境也能编译 |
| `tests/adapter-image-budget-023.spec.ts` | 新增 6 条断言，**先红后绿**（修复前 5 条失败，第 6 条本就通过） |
| `lib/` | 重新构建 |

新增测试断言的是**值**而不是「字段存在」：重算 0.2.3 的真实公式，要求解析后上限
`=== 1_048_576`；并要求每条路由的份额都**严格大于** 1 MiB，还钉住每条路由的除数与份额
具体数字。这样「把除数改成宿主默认 20」或「全用 14」都会被测试挡下。

---

## 9. 还留下什么

1. **devDependency 仍是 0.2.2-rc.5**。类型检查与单元测试都跑在 0.2.2 上，所以这次是靠
   本地接口补的类型。提到 0.2.3 需要先确认 0.2.3 正式版发布，且可能牵动其它 API。
2. **peer 范围的预发布语义**。`<0.3.0-0` 不含 `0.2.3-alpha.2`，但报告者跑的正是 alpha。
   要么把范围写宽到接受预发布，要么在 README 里写明「alpha 版不在支持范围内」——目前两者
   都没有，属于声明与现实的偏差。
3. **`maxRequestImages` / `imageOffloadCountQuantum` 仍是宿主默认的 50 / 10**，本版未动。
