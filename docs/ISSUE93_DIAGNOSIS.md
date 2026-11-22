# issue #93 诊断：工具参数被上游截断，桥接层却报 `tool_calls`，整轮 turn 失败

> issue：<https://github.com/dingminhua/dsh-connect-trae/issues/93>
> （「`Tool call "run_code": Unexpected end of JSON input`」，长会话里某一轮直接失败，工具根本没执行）
> 诊断时间：2026-11-22　方法：读代码 + 读宿主 `dsh-llm-pi-ai` / `dsh-llm` / `pi-ai` 三段真实实现 + 用真实 pi-ai 客户端回放桥接产物
> 状态：**插件缺陷（桥接层覆盖了上游的真实 `finish_reason`）**。本版把截断信号保留下来。

---

## 0. 一句话结论

桥接层用一个布尔量 `sawToolCalls` 决定结尾的 `finish_reason`：只要流里出现过**任意一个**
`tool_calls` 增量，就把上游真实的 `finish_reason`（`length`）改写成 `tool_calls`。下游因此
把一次**可恢复的截断**当成「完整但畸形的响应」，抛 `MALFORMED_RESPONSE`，整轮 turn 中止。

修复有两条，缺一不可：

1. **不再覆盖上游的真实原因**——上游说 `length` 就是 `length`。
2. **上游没给原因时（EOF 兜底）自己判断工具调用是否完整**——参数没闭合就是被切断的，
   报 `length` 让下游丢弃这次残缺调用，而不是报 `tool_calls` 让下游去解析它。

---

## 1. 现象

DSH 里用 `trae/deepseek-v4.1-flash` 跑长会话（`reasoningEffort: high`），某一轮直接失败：

```text
LlmError: Tool call "run_code": Unexpected end of JSON input

Received arguments:
{"code": "// plan: one probe — all *Keyboard* class strings + GKBEnKeyboard contexts ...
```

`Received arguments` 在字符串中间被切断——**上游把工具参数流截断了**。宿主日志里是
`agent.failed`，整轮 turn 中止，工具根本没执行。

复现条件（issue 记录）：单轮输出很长（本次是一段 ~10 KB 的内联脚本，大量嵌套引号与转义），
`reasoningEffort: high`，模型条目只配了 `contextWindow`、**没配 `max_tokens`**，走上游默认值。
三次出现都在「往工具参数里塞大段内联脚本」的场景。

---

## 2. 根因：桥接层用 `sawToolCalls` 覆盖了上游原因

`src/solo-bridge.ts` 的 `bridgeTraeSource()` 里有两处合成结尾 chunk 的地方，旧代码都是：

```ts
controller.enqueue(chunk({}, sawToolCalls ? 'tool_calls' : decoded.finishReason || 'stop'))   // 收到 done
controller.enqueue(chunk({}, sawToolCalls ? 'tool_calls' : 'stop'))                            // 干净 EOF 兜底
```

`sawToolCalls` 只要出现过**任意一个** `tool_calls` 增量就置 `true`。于是两种完全不同的情况
被抹成同一个值：

- 上游明确发 `finish_reason: "length"`（输出被 max_tokens 截断）→ 被改写成 `tool_calls`；
- 上游连接中途断开、`done` 事件根本没到 → 兜底也写成 `tool_calls`。

**截断信号完全丢失。** 下游拿到的两份信息——「上游说这是被截断的」和「这次调用是完整的」——
都被这一个布尔量吃掉了。

---

## 3. 下游为什么因此炸掉

三段真实实现串起来看（都在已安装的依赖里，可复核）：

### 3.1 pi-ai：`tool_calls` → `stopReason: "toolUse"`

`@earendil-works/pi-ai/dist/api/openai-completions.js` 的 `mapStopReason()`：

```js
case "length":     return { stopReason: "length" };
case "tool_calls": return { stopReason: "toolUse" };
```

### 3.2 pi-ai：参数不完整 → `argumentsError`

`dist/utils/json-parse.js` 的 `parseToolCallArguments()` 对完成的工具调用做
`JSON.parse`（带一层 repair）；失败就返回 `arguments: {}` 加一句 `argumentsError`。

### 3.3 `dsh-llm-pi-ai`：**只有 `length` 才容忍**

`@deepseek-ai/dsh-llm-pi-ai/lib/index.js` 的 `toStreamChunks()`：

```js
if (argumentsError !== void 0 && event.message.stopReason !== "length")
    throw new LlmError(argumentsError, "MALFORMED_RESPONSE");
```

设计意图很明确：**只有 `length` 才容忍残缺工具参数**（丢弃这次不完整的调用，让模型重来）。
`stopReason` 一旦被伪造成 `toolUse`，残缺参数就被当作「完整但畸形」的响应，直接抛错、整轮失败。

### 3.4 `dsh-llm`：`max-tokens` 会丢掉工具调用块

`@deepseek-ai/dsh-llm/lib/index.js` 的 `BlockAssembler.assembled()`：

```js
const kept = this.finish.kind === "max-tokens" ? all.map((block) => block.type !== "tool-call") : void 0;
```

而 `dsh-llm-pi-ai` 的 `mapStopReason()` 把 pi-ai 的 `length` 映射成 `{ kind: "max-tokens" }`。
所以「上报 `length`」的完整含义是：**这一轮按输出上限结束，残缺的工具调用不执行**——
这正是 issue 里期望的那条可恢复路径。

---

## 4. 本版的修复

### 4.1 不覆盖上游的真实原因

`decideFinishReason()`：上游给的原因只要属于「非正常结束」就直接采纳
（`length` / `content_filter` / `network_error`），桥接层只在**普通结束**
（`stop` / `end` / 没有）且工具调用完整时才升级成 `tool_calls`。

`content_filter` 与 `network_error` 一并纳入，是因为 pi-ai 也把它们当失败；把它们升级成
`tool_calls` 等于去执行一个上游已经拒绝写完的工具。

### 4.2 上游没给原因时，桥接层自己判断工具调用是否完整

EOF 兜底（没等到 `done`）拿不到上游原因，只能自己判断。判据是**结构性**的，不是解析：

- 参数文本里还有没闭合的 `{` / `[`；
- 或文本停在**未闭合的字符串**里（issue 的现场就是这一种）。

命中即报 `length`——残缺调用被丢弃，模型重写一次，而不是整轮报错。

刻意**不**用「`JSON.parse` 失败」当判据：那是「畸形」而不是「截断」，模型自己写坏了参数，
下游的报错（`Tool call "x": <JSON 错误>`）比这里猜出来的更准确；把它伪装成 `length` 只会
把一次清晰的失败变成一次静默重试。**闭合但非法**的参数仍旧原样交给下游。

另有一条对称的判据：**工具调用没有名字**也算被切断——下游无法调用一个没有名字的工具。

### 4.3 事后可分辨：截断 vs 断连

issue 指出，两种原因事后完全不可分辨。现在桥接层在「有工具调用、且结尾报 `length`」时打一条
warn，带上**已收到的参数长度**（不是参数本身——那是用户自己的代码）：

```text
dsh-connect-trae: the upstream reported finish_reason "length" while a tool call was still open;
  reporting length so the incomplete call is dropped instead of failing the turn
  { model, finishReason: "length", upstreamFinishReason: "length", defect: "arguments",
    calls: [{ index: 0, name: "run_code", argumentsLength: 71 }] }
```

- `upstreamFinishReason: "length"` → 上游自己说输出被上限截断；
- `upstreamFinishReason: null` → 流在 `done` 之前就断了（连接问题）。

---

## 5. 验证

新增 `tests/issue93-truncated-tool-call.spec.ts`（13 例）。其中两例是**回放真实下游**的：

- 用真实的 pi-ai 客户端（`@earendil-works/pi-ai/api/openai-completions`）读桥接产物，
  断言 `stopReason === "length"`，且 pi-ai 确实报了 `argumentsError`——即「参数确实是坏的，
  但结束原因是唯一能容忍它的那个」；
- 另一例把**修复前的产物**（`finish_reason: "tool_calls"`）喂给同一个客户端，断言
  `stopReason === "toolUse"`——这就是 issue 里 `MALFORMED_RESPONSE` 的来处，两相对照，
  机制一目了然。

其余用例覆盖：上游 `length` 被保留、EOF 无 `done` 时自判、参数没闭合时即便上游说 `stop`
也报 `length`、完整调用（整体到达 / 分片到达 / EOF 到达）仍然是 `tool_calls`、没有工具调用
时上游原因原样透传、warn 的字段与「完整调用不打 warn」。

---

## 6. 已知的边界（写下来免得被当成已保证）

- **「闭合但非法」的参数不会被本版兜住**：模型写坏了 JSON 时，报错仍旧来自下游
  （`Tool call "x": <JSON 错误>`），本版不把它伪装成截断。见 4.2。
- **截断点恰好落在一个完整的 JSON 值之后**（例如本该是 `{"a":1,"b":2}` 却只收到
  `{"a":1}`）时，结构判据看不出异常。这种情况只有在**上游自己说了 `length`** 时才能识破；
  上游没说、连接又断了的时候，桥接层会把它当成一次完整调用——参数缺字段的风险由工具自身
  的校验兜底（这也是上游说 `length` 时我们选择丢弃而不是执行的原因）。
- **上游模型条目没配 `max_tokens`** 是 issue 记录的复现条件之一。本版修的是「截断被升级成
  协议错误」这件事；输出上限本身仍走上游默认值，配置侧要不要显式配 `max_tokens` 不在
  本版范围内。
- 本版**没有**改 `src/raw-chat.ts` 那条原生 raw 通道：它在 `decodeRawChatChunk()` 里原样
  保留上游的 `finish_reason`，没有 `sawToolCalls` 这一层覆盖，不存在同一个缺陷。
