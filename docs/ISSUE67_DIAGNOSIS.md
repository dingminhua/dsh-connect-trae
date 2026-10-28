# issue #67 诊断：缓存命中率恒为 0%，不是插件丢了数字

> issue：<https://github.com/dingminhua/dsh-connect-trae/issues/67>
> （「无论简单或复杂提问，缓存命中均为百分之零」，10 个会话复现，tps 浮动 60–80）
> 诊断时间：2026-10-28　方法：读代码 + 上游实测（CN/AI 双区、4 个账号、7 个模型、4 种 function）+ DSH 会话日志
> 状态：**上游行为，非插件缺陷**。本版把「上游没有分配缓存池」变成可观测事实。

---

## 0. 一句话结论

**插件没有丢缓存数字。** 上游 `llm_utils_chat` 现在跑在 `llm_raw_chat_v2` 管线上、后端是火山方舟
（Volcengine Ark）的 `ep-…` 端点，它在 `metadata` 里用 `prompt_cache_pool_record: null` 明确告诉
我们：**这次请求根本没有分配前缀缓存池**。没有池，`cache_read_input_tokens` 就只能是 0 ——
所以 0% 命中率是**正确的读数**，不是被吞掉的字段。

| 现象 | 根因 | 本版的处理 |
| --- | --- | --- |
| 缓存命中恒 0% | 上游不为这些请求分配 prompt cache 池（`prompt_cache_pool_record: null`，100% 请求如此） | 解码并上报该事实，用户能区分「上游没给池」与「插件丢了数」 |
| 简单/复杂提问都一样 | 缓存是**前缀**级的；池没分配时，prompt 长短不影响结果 | 同上；文档说明机制 |
| tps 60–80 浮动 | 与缓存无关：TTFT 的差别来自**整请求复用**（同一条请求重发才快），复用不产生 `cached_tokens` | 不修（非缺陷） |
| 2026-10-25 曾真实命中过 | 当时上游仍给 `trae-global` 分配缓存池（实测 `cacheReadTokens` 2048→46720） | 佐证：是上游变了，不是插件变了 |

**一个容易踩的坑（请勿据此下结论）**：DSH 里另有一批 `cacheReadTokens` 非 0 的记录
（`session-cc6ff6f0`，751/754 命中），逐行读 `data.message.source.provider` 可确认它们属于
`workbuddy` / `dsh-opencode-go`，**没有一行是 `trae`**。用它们证明「trae 有缓存」是错的。

---

## 1. 证据链（按数据流）

```text
DSH pi-ai adapter
      │  POST /v1/chat/completions（OpenAI 形状）
      ▼
src/shim.ts  回环 shim
      ▼
TraeSoloBridge                     src/solo-bridge.ts
      ▼
TraeSoloUpstreamClient             src/solo.ts
      │  POST https://trae-api-cn.mchost.guru/api/agent/v3/llm_utils_chat
      ▼
Trae SSE（200，即使拒绝也是 200）
      ├─ metadata      { prompt_cache_pool_record: null }   ← 关键：无缓存池
      ├─ timing_cost   { name: "llm_raw_chat_v2",
      │                  provider_model_name: "ep-20261020221437-cfj9b" }  ← 火山方舟端点
      ├─ output        { response, reasoning_content }
      ├─ token_usage   { prompt_tokens, cache_read_input_tokens: 0,
      │                  cache_creation_input_tokens: 0, ... }
      └─ done
```

### 1.1 插件侧：字段一直被正确转发

issue #10 的修复（`prompt_tokens_details.cached_tokens`）**已发版且仍在**：

- `src/sse.ts` 把 `cache_read_input_tokens` → `cacheReadTokens`；
- `src/solo-bridge.ts` 把它转成 OpenAI 的 `prompt_tokens_details: { cached_tokens }`；
- 已安装的 4.6.3 `lib/index.js` 里 `cached_tokens` 出现 2 次、`cache_read_input_tokens` 1 次。

pi-ai 1.1.0 的 `parseChunkUsage` 读 `prompt_tokens_details?.cached_tokens`，并把
`input = max(0, prompt - cacheRead - cacheWrite)`。也就是说：**只要上游给了非 0，界面就会显示**。

反证：同一个 DSH 版本里 `workbuddy` / `dsh-opencode-go` 的 `cacheReadTokens` 正常非 0 —— 显示链路
没坏。

### 1.2 上游侧：池没有分配

`metadata.prompt_cache_pool_record` 在 **100% 的实测请求**里都是 `null`（CN/AI 双区、4 个账号、
`agent-task` / `raw-chat` / `model-detail` 三种头、以及各种字段注入）。它非空才代表上游挂了缓存池。

`timing_cost.name` 恒为 `llm_raw_chat_v2`，`provider_model_name` 是火山方舟端点 id（`ep-…`，CN 与 AI
各自不同）。这与 2026-09-22（issue #10 测量时）不是同一条服务路径。

### 1.3 复现 issue #10 的原始实验：现在是 0

`scripts/probe-cache-convention.mjs` 就是当初产出 5248 / 9216 的那份脚本，原样重跑：

| 轮次 | prompt_tokens | cache_read（2026-09-22） | cache_read（2026-10-28） |
| --- | --- | --- | --- |
| t1 | 5258 | 0 | 0 |
| t2 | 9224 | **5248** | **0** |
| t3 | 9224 | **9216** | **0** |

同一脚本、同一套 header、同一份前缀 —— 变量只有上游。这是最强的单点证据。

### 1.4 覆盖面：不是某个模型/区域/函数的特例

- 7 个模型 × 2 区 × 4 个 function（含 `DeepSeek-V4-Flash-Official`、`glm-5.3`、`kimi-k2.6`、
  `gpt-5.2@solo_agent_remote`），每个跑 2 轮 → 全部 `read=0 write=0`；
- 超长 prompt（92,038 tokens）CN ×3 + AI ×3 → 全 0；
- 13,511 tokens 带 tools、19,837 tokens 带 `reasoning_effort: high` → 全 0；
- 真实 agent 循环形状（稳定 system + 2 个 tool + tool_call/tool_result + 3 轮，18,936 tokens）→ 全 0；
- 手工构造 body 注入 `session_id` / `conversation_id` / `prompt_completion_id 0..3`（绕过
  `prepareSoloBody` 白名单，且 `metadata.session_id` 回显正确证明字段被采纳）→ `5235/5247/5260`
  全 `read=0`。

### 1.5 决定性实验：TTFT 证明「整请求复用 ≠ 前缀缓存」

用 `timing_cost.first_sse_event_time` 测首字节：

| 实验 | 结果 | 含义 |
| --- | --- | --- |
| 同一条请求重发 | 冷 3097 ms → 热 1207 ms | 有加速 |
| 三个**不同**前缀 A/B/C 交错 A,B,C,A,B,C | 首轮 3133/3121/2719；次轮 1037/997/683 | 按内容键控，非端点预热 |
| 预热 A 之后来一个全新前缀 D | D 仍 3125 ms（冷），再发 961 ms | 不是端点级预热 |
| **同一 25k 前缀 + 不同后缀** | **2772 ms（仍是冷的）**，自身重发 1299 ms | **共享前缀不带来加速** |
| 同一 system + 不同 user | 2910（冷）→ 1096（重发）→ 新 user 1806 / 3124 | 换 user 就重新变冷 |
| 增长中的 agent 对话 T1–T5（20035→20095） | 2897 → 1102 → 1234 → 1341 → 1009 | 每轮都是「新请求」 |

**结论**：加速是**整条请求的精确复用**（memoization），不是 token 级前缀缓存。共享 25k 前缀的
请求依旧冷启动 —— 前缀缓存实际上是关着的。而整请求复用**不产生任何 `cached_tokens`**，所以它既
解释了 tps/延迟的浮动，也解释了为什么命中率仍是 0。

### 1.6 上游变了的旁证：2026-10-25 真的命中过

`session-4255a972-d3df-42da-9a63-54ee984c4972`（provider `trae-global`，2026-10-25T18:43Z）的 4 行
assistant 记录，`cacheReadTokens` 依次 2048 → 41600 → 45824 → 46720，`inputTokens`
39640/4247/921/14570。同一插件、同一账号体系，两天后归零。

IDE 侧构建版本在 10-25 与 10-27 的日志里都是 `2.3.93438` —— **客户端没变**，变的是服务端。

---

## 2. 排查过的「可能是插件」方向（均被否定）

| 假设 | 验证 | 结论 |
| --- | --- | --- |
| #10 的转发又坏了 | `lib/index.js` 含 `cached_tokens`；单测覆盖 | 否 |
| `prepareSoloBody` 白名单丢字段 | 手工构造原始 body 绕过白名单，结果不变 | 否 |
| 缺 `session_id` 导致不缓存 | 手工注入并确认 `metadata.session_id` 回显 | 否 |
| `enable_user_prompt_cache` 开关没开 | 顶层 / `extra_info` / `ab_versions` / `client_config_ab_versions` 四处注入 | 否，管线不变 |
| header profile 不对 | `agent-task` / `raw-chat` / `model-detail` 全试 | 否 |
| `app_version` 为空导致降级 | body 与 header 两种方式注入 IDE 版本号 | 否，`app_version` 仍为 `""` |
| 需要 v2 raw chat 路径 | `/api/ide/v2/llm_raw_chat` → `4001`；v1 → `4023` | 否，SOLO 是唯一活路 |
| DSH 显示层吞了 | 同版本 `workbuddy` 正常非 0 | 否 |

**顺带发现**：`src/sse.ts` 原本把 `metadata` / `timing_cost` 都归到 `unknown` 直接丢弃。功能上无害，
但让用户无法区分「上游没给池」和「插件丢了数」——这正是本 issue 的观感来源。本版改为解码为
`diagnostic` 并上报。

---

## 3. 本版改动

1. `src/sse.ts`：新增 `TraeStreamEvent` 的 `diagnostic` 变体，解码 `metadata`（`prompt_cache_pool_record`）
   与 `timing_cost`（`name` 管线名、`provider_model_name`）。**区分 `null` 与「字段不存在」**。
2. `src/solo-bridge.ts`：
   - `bridgeTraeSource` / `bridgeTraeSoloStreamOrFail` / `TraeSoloBridge` 接受可选 `log`，把上述事实
     上报（`promptCachePoolRecord` / `pipeline` / `providerModelName`）；
   - `openTraeSource` 的 peek 判定**显式排除 `diagnostic`** —— 否则 `metadata` 会被当成「已应答」，
     紧随其后的拒绝（如 1005）就会退化成截断的 200 流（issue #19 的老毛病复发）。
3. `src/index.ts`：4 个 `new TraeSoloBridge(...)` 处把 `ctx.logger.warn` 接进去。
4. 回归测试：`tests/sse.spec.ts` 解码断言；`tests/solo-bridge.spec.ts` 上报断言 + 「metadata 之后
   的拒绝仍变成 402」断言。

诊断事件不进入答案文本、不影响 usage 映射，因此**不改变**任何对外行为。

---

## 4. 给用户的建议

- 0% 命中率在当前上游下是**预期读数**，不用再排查插件；
- 缓存收益目前只体现为**同一请求重发**时更低的 TTFT，这不会显示成缓存命中；
- 若某天 `metadata.prompt_cache_pool_record` 非空，`cached_tokens` 会自动恢复显示 —— 插件侧无需再改；
- 日志里出现 `upstream request diagnostics` 即可确认当时的真实情况。

---

## 5. 复现命令

```bash
# issue #10 的原始脚本（对照 2026-09-22 的 5248 / 9216）
node scripts/probe-cache-convention.mjs

# 单测
pnpm vitest run tests/sse.spec.ts tests/solo-bridge.spec.ts
```
