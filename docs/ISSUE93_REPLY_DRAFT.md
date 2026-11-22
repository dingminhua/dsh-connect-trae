# issue #93 回复草稿

> 用途：回复 <https://github.com/dingminhua/dsh-connect-trae/issues/93>
> （「bridge 用 sawToolCalls 覆盖上游真实 finish_reason：截断被改写成 tool_calls，DSH 侧把可恢复的 length 判成 MALFORMED_RESPONSE，整轮 turn 失败」）
>
> **状态：已修复**，随 `v4.18.6`（本稿写于 tag 之后、npm 发布之前）。
> 取证：读插件源码 + 读宿主已安装的 `dsh-llm-pi-ai` / `dsh-llm` / `pi-ai` 三段真实实现，
> 并用**真实的 pi-ai 客户端**回放桥接产物做对照（见第三节）。
> 详细诊断见 [`docs/ISSUE93_DIAGNOSIS.md`](https://github.com/dingminhua/dsh-connect-trae/blob/main/docs/ISSUE93_DIAGNOSIS.md)。
> 可直接复制横线以内的内容。

---

先谢谢报告——根因抓得很准，**「`sawToolCalls` 覆盖了上游真实的 `finish_reason`」正是问题
所在**，而且下游为什么因此炸掉，你推的那条链也对。下面是核对结果、修复，以及**修完之后你会
看到什么**（包括一处和你预期不完全一样的地方）。

## 一、根因确认：桥接层把「可恢复的截断」升级成了协议错误

`src/solo-bridge.ts` 旧代码用一个布尔量决定结尾的 `finish_reason`，两处都是同一个写法：

```ts
controller.enqueue(chunk({}, sawToolCalls ? 'tool_calls' : decoded.finishReason || 'stop'))
```

`sawToolCalls` 只要出现过**任意一个** `tool_calls` 增量就置 `true`。于是两种完全不同的情况
被抹成了同一个值：

- 上游明确发 `finish_reason: "length"`（输出被 max_tokens 截断）→ 被改写成 `tool_calls`；
- 上游连接中途断开、`done` 事件根本没到 → EOF 兜底也写成 `tool_calls`。

**截断信号完全丢失。** 下游拿到的两份信息——「上游说这是被截断的」和「这次调用是完整的」——
都被这一个布尔量吃掉了。

## 二、为什么下游只认 `length`

宿主里三段真实实现串起来（都在已安装的包里，可以自己复核）：

| 环节 | 行为 |
|---|---|
| `pi-ai` `mapStopReason()` | `length` → `stopReason: "length"`；`tool_calls` → `stopReason: "toolUse"` |
| `pi-ai` `parseToolCallArguments()` | 参数 JSON 解析失败 → `arguments: {}` + `argumentsError` |
| `dsh-llm-pi-ai` `toStreamChunks()` | `if (argumentsError !== void 0 && stopReason !== "length") throw new LlmError(…, "MALFORMED_RESPONSE")` |
| `dsh-llm` `BlockAssembler.assembled()` | `finish.kind === "max-tokens"` → **丢掉工具调用块**，只留文本 |

也就是说：**只有 `length` 才容忍残缺工具参数**（丢弃这次不完整的调用），而「上报 `length`」
在宿主里的完整含义是「这一轮按输出上限结束，残缺调用不执行」。`stopReason` 一旦被伪造成
`toolUse`，残缺参数就被当作「完整但畸形」的响应，直接抛错、整轮失败——正是你日志里那一条。

## 三、修复

两处改动，缺一不可：

1. **上游给的原因属于「非正常结束」时直接采纳**（`length` / `content_filter` /
   `network_error`）；桥接层只在**普通结束**（`stop` / `end` / 没有）且工具调用完整时，才把它
   升级成 `tool_calls`。
2. **上游没给原因时（EOF 兜底）桥接层自己判断工具调用是否完整**：参数文本里还有没闭合的
   `{` / `[`，或停在**未闭合的字符串**里（你这次的现场就是这一种），就是被切断的，报 `length`。

第 2 条刻意**不**用「`JSON.parse` 失败」当判据：那是「畸形」不是「截断」。模型自己写坏参数时，
下游的报错（`Tool call "x": <JSON 错误>`）比桥接层猜出来的更准确，伪装成 `length` 只会把一次
清晰的失败变成一次静默重试。**闭合但非法**的参数仍旧原样交给下游。工具调用**没有名字**也算
被切断——下游无法调用一个没有名字的工具。

**验证**（新增 13 例，其中两例回放真实下游）：用**真实的 pi-ai 客户端**读修复后的桥接产物，
断言 `stopReason === "length"`，且 pi-ai 确实报了 `argumentsError`（参数确实是坏的，但结束
原因是唯一能容忍它的那个）；另一例把**修复前的产物**（`finish_reason: "tool_calls"`）喂给同一
个客户端，断言 `stopReason === "toolUse"`——这就是 `MALFORMED_RESPONSE` 的来处。两相对照，
机制一目了然。

另外按你的建议加了一条 warn：结尾报 `length` 且有工具调用时，打印**已收到的参数长度**与上游
原始原因，这样「上游输出被截断」和「连接中途断开」事后可分辨。参数本身不打进日志——那是
你自己的代码。

## 四、修完之后你会看到什么（**和预期不完全一样，先说清楚**）

| | 修复前 | 修复后 |
|---|---|---|
| 那一轮 | 抛 `MALFORMED_RESPONSE`，整轮 turn 中止 | **按输出上限干净结束**，不再报协议错误 |
| 那个残缺的工具调用 | 留着并被执行（参数是坏的） | **被丢弃**，不执行 |
| 模型会不会自动重来 | 不会（整轮已经死了） | **也不会在同一轮里自动重来** |

第三行要特别说明：宿主里 `max_tokens` 被归到「结束本轮」，所以**模型不会在同一次 turn 里
自动重写这次调用**——你需要再发一条消息让它继续（下一轮它能看到被截断的上下文，可以重写）。
修复换来的好处是「**一次输出上限不再等于一次崩溃**」，而不是「自动重试」。如果你要的是后者，
那是另一件事（见下一节）。

## 五、还差一块：输出上限本身（另开一条 issue 跟）

你记录里的复现条件有一条值得单独跟：模型条目只配了 `contextWindow: 1000000`，**没配
`max_tokens`**，请求因此走上游默认值——上游默认值截断了那段 ~10 KB 的内联脚本。

插件这一侧能填 `maxTokens` 的地方有两条路径：目录发现时会从上游
`model_detail_list[].max_tokens` 取值填进模型条目（`src/catalog.ts`），卡片里显式配置的值会
覆盖它（`src/index.ts`）。所以你那条条目没有 `max_tokens`，要么是**上游对这个模型没报这个
字段**，要么是**卡片把它覆盖掉了**。这一条我另开一条 issue 跟：要不要在缺 `max_tokens` 时给一个
保守的默认值（并允许用户覆盖），或者至少在卡片上明确提示「建议配置 maxTokens」。

在那一块落地之前，能立刻缓解的是**给那个模型条目显式配一个 `max_tokens`**——数值要能容得下你
要塞进工具参数的那段脚本，否则截断还会发生（只是这回不会再把整轮带崩）。

---

以上修正在 `v4.18.6`。如果升级后还看到 `MALFORMED_RESPONSE`，那多半不是这条路径了——
麻烦把日志里那一轮的 `chat request received` 字节数与新加的那条 warn 一起贴上来，那两样能直接
区分「上游输出被截断」和「连接被切断」。
