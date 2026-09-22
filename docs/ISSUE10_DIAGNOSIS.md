# issue #10 取证：缓存为什么一直是 0

> issue：https://github.com/dingminhua/dsh-connect-trae/issues/10
> （1309893790：「我测试了一下一直0缓存」「一直0缓存，不知道接口原因还是trae上有不反悔缓存」）
>
> 日期：2026-09-22 · 版本：2.0.4 → 2.0.5

## 结论

**用户的第二种猜测不对，第一种猜测（接口原因）方向对了，但真正的原因是插件自己把字段丢了。**

三句话概括：

1. **Trae 上游确实有前缀缓存，也真的在报**——实测同一个长 prompt 连续发两次，第二次上游回 `cache_read_input_tokens: 9216`（不是 0）。
2. **插件把这两个字段丢掉了**：`decodeTraeEvent` 只取 `prompt_tokens` / `completion_tokens` / `total_tokens` / `reasoning_tokens`，`cache_read_input_tokens` 与 `cache_creation_input_tokens` 被直接忽略，后续 bridge 也就无从转发。
3. **DSH 侧因此永远是 0**：`dsh-llm-pi-ai` 只在 `usage.cacheRead > 0` 时才写入 `cacheReadTokens`，插件从未上报过非零值，所以界面稳定显示 0 缓存。

不是 Trae 不缓存，也不是 DSH 不显示——是**中间这一层没搬**。

## 证据链

### 1. Trae 上游确实返回缓存字段（本机实测，可复现）

用插件自己的请求路径（`prepareSoloBody` + `buildTraeCnHeaders` + `SseDecoder`）连续发三次，
第一次冷启动、第二三次发送**逐字节相同**的 prompt（约 9224 tokens）：

```
=== turn 1: PREFIX only (warms cache) ===
   prompt_tokens=5258 cache_read=0    cache_creation=0
=== turn 2: PREFIX + SUFFIX ===
   prompt_tokens=9224 cache_read=5248 cache_creation=0
=== turn 3: 与 turn 2 完全相同的 prompt ===
   prompt_tokens=9224 cache_read=9216 cache_creation=0
```

三次请求的完整 `token_usage` 原文（turn 3，真实捕获）：

```json
{"name":"","prompt_tokens":9224,"completion_tokens":173,"total_tokens":9397,
 "cache_creation_input_tokens":0,"cache_read_input_tokens":9216,"reasoning_tokens":171,
 "prompt_tokens_total":0,"completion_tokens_total":0,"total_tokens_total":0,
 "cache_creation_input_tokens_total":0,"cache_read_input_tokens_total":0,
 "reasoning_tokens_total":0,"cluster":"normal_context"}
```

**上游事件名是 `token_usage`，字段名是 `cache_read_input_tokens` / `cache_creation_input_tokens`。**

复现脚本：`scripts/probe-cache-convention.mjs`（只打印 usage 事件，不打印消息内容与凭证；成本为三次短补全）。

> 复现提示：Trae 的缓存**跨进程、跨会话存活**（服务端侧）。首次运行该脚本时 turn 1 为 `cache_read=0`；
> 之后的运行因为前缀已被上轮预热，turn 1 就会直接命中（实测再次运行 turn 1 即为 `5248`）。
> 因此**判断依据应看 `prompt_tokens` 是否保持不变**，而不是看某一轮是否为 0——
> 若要用冷启动复现，需改动 PREFIX 内容使前缀失效。

### 2. 插件的解码层丢掉了这两个字段

`src/sse.ts` 的 `token_usage` 分支（修复前）只映射四个字段：

```ts
if (event.event === 'token_usage') {
  return {
    type: 'usage',
    ...typeof record['prompt_tokens'] === 'number' ? { inputTokens: record['prompt_tokens'] } : {},
    ...typeof record['completion_tokens'] === 'number' ? { outputTokens: record['completion_tokens'] } : {},
    ...typeof record['total_tokens'] === 'number' ? { totalTokens: record['total_tokens'] } : {},
    ...typeof record['reasoning_tokens'] === 'number' ? { reasoningTokens: record['reasoning_tokens'] } : {},
  }
}
```

`TraeStreamEvent` 的 `usage` 变体本身也没有缓存字段，所以这两个值在**类型层就已经不可表达**。

`src/raw-chat.ts` 的 `decodeRawChatChunk` 是同一类缺口（只读 `prompt_tokens` / `completion_tokens` / `total_tokens`），
`RawChatDelta` 的 `usage` 同样没有缓存字段——Raw Chat 通道将来启用时会踩同一个坑，本次一并修掉。

### 3. bridge 也就无从转发

`src/solo-bridge.ts` 把 Trae 事件翻成 OpenAI chunk，usage 只搬四个计数器：

```ts
} else if (decoded.type === 'usage') {
  usage = {
    ...decoded.inputTokens === undefined ? {} : { prompt_tokens: decoded.inputTokens },
    ...decoded.outputTokens === undefined ? {} : { completion_tokens: decoded.outputTokens },
    ...decoded.totalTokens === undefined ? {} : { total_tokens: decoded.totalTokens },
  }
}
```

离线复现（修复前，用真实捕获的 payload 走 `bridgeTraeSoloStream`）：

```
bridged SSE : ..."usage":{"prompt_tokens":12000,"completion_tokens":40,"total_tokens":12040}
cache in out: false        ← 9000 的 cache_read 就这么没了
```

### 4. DSH 侧只认自己的字段名

`@earendil-works/pi-ai/dist/api/openai-completions.js` 的 `parseChunkUsage`：

```js
const cacheReadTokens = rawUsage.prompt_tokens_details?.cached_tokens
  ?? rawUsage.prompt_cache_hit_tokens
  ?? rawUsage.cached_tokens ?? 0;
const cacheWriteTokens = rawUsage.prompt_tokens_details?.cache_write_tokens || 0;
const input = Math.max(0, promptTokens - cacheReadTokens - cacheWriteTokens);
```

`dsh-llm-pi-ai` 再往上一层：

```js
...usage.cacheRead > 0 ? { cacheReadTokens: usage.cacheRead } : {},
```

即：**插件必须用 `prompt_tokens_details.cached_tokens` 这个 OpenAI 规范拼写上报，DSH 才会显示非零缓存。**
Trae 的原生字段名 `cache_read_input_tokens` 不属于被识别的三种拼写，即使原样透传也不会被读到——这是必须做字段名映射、而不能只做「放行」的原因。

### 5. 语义确认：Trae 的 `prompt_tokens` 是否**包含**缓存 tokens？

这一步决定了能不能直接映射，因为 pi-ai 会做 `input = prompt_tokens - cacheRead - cacheWrite`：

- **OpenAI 口径（包含）**：`prompt_tokens` 是完整输入，缓存 tokens 是它的子集 → 减法正确。
- **Anthropic 口径（不包含）**：`input_tokens` 已排除缓存 → 再减会重复扣减。

实测（上面 turn 2 → turn 3）同一份 prompt 的 `prompt_tokens` **恒为 9224**，
而 `cache_read` 从 5248 涨到 9216。若 `prompt_tokens` 不含缓存，
同一份输入的实际规模将从 14472 涨到 18440——**不可能**。

结论：**Trae 用 OpenAI 口径，`prompt_tokens` 包含缓存读取量**，因此按 `prompt_tokens_details.cached_tokens` 映射在算术上正确。

端到端验证（真实 payload → 修复后的 bridge → pi-ai 自己的 `parseChunkUsage`）：

```
wire usage emitted by plugin:
{"prompt_tokens":9224,"completion_tokens":173,"total_tokens":9397,
 "prompt_tokens_details":{"cached_tokens":9216,"cache_write_tokens":0}}

pi-ai / DSH result:
  input     = 8
  cacheRead = 9216   <-- was 0 before the fix
  cacheWrite= 0
  output    = 173
  total     = 9397

accounting intact: input + cacheRead + cacheWrite = 9224 (prompt_tokens was 9224)
```

**账目守恒**：`8 + 9216 + 0 = 9224`，与 `prompt_tokens` 完全相等，没有重复扣减。

## 修复内容

| 文件 | 改动 |
| --- | --- |
| `src/sse.ts` | `TraeStreamEvent.usage` 增加 `cacheReadTokens` / `cacheWriteTokens`，解码 `cache_read_input_tokens` / `cache_creation_input_tokens` |
| `src/solo-bridge.ts` | 把两者映射为 `prompt_tokens_details.cached_tokens` / `.cache_write_tokens`；两个字段都没有时**不产生** `prompt_tokens_details`，保持原有 wire 形状 |
| `src/raw-chat.ts` | 同类缺口：`RawChatDelta.usage` 增加缓存字段，同时接受 OpenAI 嵌套拼写与 DeepSeek/Kimi 顶层拼写 |

新增 4 个回归测试（`tests/sse.spec.ts`、`tests/solo-bridge.spec.ts`、`tests/raw-chat.spec.ts`），
其中 bridge 用例直接使用上面捕获的真实 `token_usage` 事件作为输入。

## 需要说清楚的一点

修复只保证**上游报了缓存时插件会如实上报**。至于「这次请求到底有没有命中缓存」，
取决于上游：

- 前缀缓存要看**请求前缀是否逐字节一致**——DSH 每轮会在历史后追加新消息，前缀通常能复用；
- 实测同一个 prompt 第一次永远是 `cache_read=0`（冷启动），第二次才有值，**新会话/新前缀的第一轮显示 0 属于正常**；
- 本机实测的 `cache_creation_input_tokens` 始终为 0，即 Trae 目前只报读、不报写。

## 复现与验证

```bash
node scripts/probe-cache-convention.mjs   # 上游是否真的报缓存（真机实测）
pnpm run check                            # typecheck + 240 tests + build
```
