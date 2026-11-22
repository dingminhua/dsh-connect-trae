# issue #94 诊断：输出上限该由谁决定——**上游，不是插件**

> issue：<https://github.com/dingminhua/dsh-connect-trae/issues/94>
> （自开：「模型条目缺 maxTokens 时请求不带 max_tokens，长输出会被上游默认值截断——要不要给保守默认值？」）
> 诊断时间：2026-11-22　方法：本机 CN 与国际区**实时凭据**实测（`scripts/probe-issue94-maxtokens.mjs`
> 只读探针 + `scripts/probe-issue94-default-cap.mjs` 一次性生成探针）+ 代码链阅读 + 宿主三段实现复核
> 结论：**上游本来就按「模型自己公布的输出上限」截断，插件给的任何默认值都不可能改变它。**
> 本 issue 不需要代码改动。

---

## 0. 一句话结论

| 问题 | 答案 | 证据 |
|---|---|---|
| 上游发布 `max_tokens` 吗？ | **发布**，而且几乎全覆盖 | CN 780 行里 738 行带值（94.6%）；国际区 **731/731（100%）** |
| 插件的目录条目带上了吗？ | **带上了**（issue #42 的修复），只有 join-miss 行没有 | 合并后 CN 33 行带 30、国际区 29 行带 25 |
| 请求带 `max_tokens` 吗？ | **不带**——SOLO 通道按设计丢弃它 | `prepareSoloBody` 只构造已证实的信封；`tests/solo.spec.ts` 已钉住 |
| 上游在请求不带时用哪个上限？ | **模型自己公布的 `max_tokens`**（`deepseek-v4.1-flash` 在 CN 实测 32000） | 三次实时生成，全部停在 32000 |
| 那插件要不要给个默认值？ | **不要** | 见 §4 |

---

## 1. 先把「请求不带 `max_tokens`」这件事说准

插件有两条可能的通道，**只有一条是活的**：

- **SOLO**（`llm_utils_chat`）：**活着的唯一一条**。`prepareSoloBody()` 显式构造上游信封，
  只放 `messages / model / config_name / function / stream / tools / reasoning_effort`，
  其余 OpenAI 字段（`temperature`、`max_tokens`、`tool_choice`、`response_format`…）**一律丢弃**——
  注释写明了原因：「`llm_utils_chat` is not an OpenAI-compatible endpoint…so optional Pi/OpenAI
  fields cannot make every model fail validation」。`tests/solo.spec.ts` 的
  「drops undeclared OpenAI parameters」一例把它钉死了。
- **Raw Chat**（`llm_raw_chat`）：**会**转发 `max_tokens`（`buildTraeRawChatDraft`），但它在
  `src/index.ts` 里是 `enabled: false`，注释写明「Raw Chat stays opt-in and unverified;
  **SOLO remains the only live path**」。

所以：**条目里的 `maxTokens` 在活着的通道上到不了上游**。它在插件里是**显示与元数据**
（卡片「最大输出」、DSH 的模型注册、pi-ai 的模型对象），不是对上游的约束。

> 我最初查错了两处，都记在这里，免得下一个人再走一遍：
> ① 以为 `prepareSoloBody` 会透传 `max_tokens`——它不；
> ② 以为「条目缺 `max_tokens` → 请求不带 → 走上游默认 → 所以截断」是 #93 的诱因——**不成立**，
> 因为请求**永远**不带这个字段，带不带都一样截。

---

## 2. 上游的实测上限（2026-11-22，CN 实时凭据）

三次真实生成，都通过插件自己的桥接（`TraeSoloBridge` → `TraeSoloUpstreamClient`），
模型 `deepseek-v4.1-flash`，提示词要求连续输出到 50000 行：

| # | 请求里的 `max_tokens` | 实际 `completion_tokens` | `finish_reason` | 停下来时的行数 |
|---|---|---|---|---|
| A | 无 | **32000** | **stop** | 10095 |
| B | 32000 | **32000** | **stop** | 10590 |
| D2 | 64000 | **32000** | **stop** | 10601 |

**两个结论：**

1. **上游按模型自己公布的 `max_tokens`（CN 的 `deepseek-v4.1-flash` = 32000）截断**，与请求里
   写没写、写多大无关（三次都精确停在 32000）。
2. **上游到上限时给的是 `finish_reason: "stop"`，不是 `"length"`。**

第 2 条对 issue #93 有直接影响：**只「保留上游真实原因」的修法救不了报告者那一例**——
上游说的是 `stop`，不是 `length`。真正救它的是 4.18.6 里那条**结构性**判据（参数文本有没有闭合）：
上游说 `stop`、参数没闭合 → 报 `length` → 下游丢弃残缺调用而不是抛 `MALFORMED_RESPONSE`。

> B 与 D2 里请求带的 `max_tokens` 根本没到上游（§1），所以**「上游认不认请求里的
> `max_tokens`」至今未测**——在活着的通道上这个问题不成立，故不再花额度去测。

---

## 3. 两个区的覆盖（只读探针，2026-11-22）

`scripts/probe-issue94-maxtokens.mjs`（用插件自己的 `readTraeIdentity` / `refreshTraeCredential` /
`buildTraeCnHeaders` / `buildTraeModelDetailRequest`，所以不会与插件实际发出的请求形状漂移）：

| | wire 名单 | detail 行 | 带 `max_tokens` 的行 | 合并后目录条目 | 带值的条目 |
|---|---|---|---|---|---|
| CN | 570 config | 780 | **738（94.6%）** | 33 | **30** |
| 国际区 | 456 config | 731 | **731（100%）** | 29 | **25** |

- CN 的输出上限取值：`0 / 4000 / 4096 / 8192 / 16000 / 20000 / 30000 / 32000 / 32768 / 64000 /
  128000 / 131072 / 384000`。
- 国际区：`0 / 4000 / 4096 / 8192 / 16000 / 20000 / 25000 / 32000 / 64000 / 128000 / 384000`。
- **国际区比 CN 更全**（这条在开 issue 时是「未测」，现在有答案了）。
- 合并后仍缺值的行，**全部是 join-miss 行**——它们在 SOLO 的 wire 名单里没有 config，
  无从取值：CN 是 `DeepSeek-V4-Flash` / `DeepSeek-V4-Pro` / `qwen3.8-flash`，
  国际区是 `gpt-5.6-sol` / `gpt-5.6-terra` / `gpt-5.6-luna` / `glm-5.2`。
  这与 issue #42 记的「join-miss 行如实留空」是同一批。

顺带钉住 #93 报告者那条模型的两区取值：

| | 目录条目 | 上下文 | 输出上限 |
|---|---|---|---|
| CN（provider `trae`） | `deepseek-v4.1-flash` | 200000 | **32000** |
| 国际区（provider `trae-global`） | `deepseek-v4.1-flash__dev` | 184000 | 16000 |
| 国际区 | `deepseek-v4.1-flash__max` | 936000 | **64000** |

---

## 4. 那还要不要给「保守默认值」？——不要

理由按重要性排：

1. **给不了**：活着的通道不转发 `max_tokens`，插件手里没有能改变上游行为的旋钮。
2. **给了也没用**：上游按模型自己公布的数截断（实测 32000 = 公布值）。插件再发一个数，
   最多变成「重复上游已经知道的事」。
3. **给错了更糟**：给小了，用户的上限被插件**人为降低**（比上游默认更糟）；给大了，
   插件就在报一个它无法兑现的数。
4. **唯一真正缺值的行是 join-miss 行**：它们没有 wire config，也就**没有可公布的上限**——
   这正是「如留空」比「猜一个」诚实的地方。

**因此本 issue 需要的不是代码改动，是把话说准**：条目里的 `maxTokens` 是**显示与元数据**，
不是对上游的约束；用户想提高输出上限，只能换一个**公布的上限更大**的模型/配置
（例：国际区 `deepseek-v4.1-flash__max` 是 64000，CN 的 `custom_model_tokenpony_deepseek_v4_1_flash`
是 384000），或者**少让推理阶段吃掉额度**（见下）。

---

## 5. 那 #93 报告者的截断到底怎么发生的

上游的上限（CN 的 `deepseek-v4.1-flash` = **32000**）是**推理与答案共用的**——
pi-ai 的源码注释写得很直白：

> Reasoning and the answer share max_tokens here, so an uncapped reasoning phase can consume the
> whole response and leave no answer and no tool call.

他用的是 `reasoningEffort: high`，而那次要往工具参数里塞 ~10 KB 的内联脚本。
**推理阶段吃掉了 32000 里的大部分，答案（工具调用）被切在半路**——于是工具参数 JSON 没闭合。
桥接层旧代码把这件事报成 `tool_calls`（4.18.6 已修），下游才把它升级成 `MALFORMED_RESPONSE`。

**真正能缓解的手段**（而不是「配一个 `max_tokens`」——那到不了上游）：

1. **把 reasoning effort 降一档**，让推理阶段别把额度吃光；
2. **别把大段内联脚本塞进一次工具调用**，拆成多次调用；
3. **换一个公布上限更大的配置**（国际区 `__max` 变体是 64000；CN 侧的
   `custom_model_tokenpony_deepseek_v4_1_flash` 是 384000）。

---

## 6. 顺手记一笔：#93 的修复为什么不能只「保留上游原因」

上游到上限时给的是 `stop` 而不是 `length`（§2）。所以 issue #93 里建议的
「保留上游真实原因」**救不了报告者那一例**（上游说的是 `stop`，保住了仍然是 `stop`，
下游照样抛 `MALFORMED_RESPONSE`）。真正起作用的是 4.18.6 里那条**结构性**判据：
上游说 `stop`、但参数文本没闭合 → 报 `length`。这条判据在
`src/tool-call-completeness.ts`，由 `tests/issue93-truncated-tool-call.spec.ts` 钉住。

---

## 7. 探针（都只读 / 一次性生成，随仓库提交）

| 脚本 | 作用 | 花费 |
|---|---|---|
| `scripts/probe-issue94-maxtokens.mjs` | 两区的 wire 名单 + 远程目录 + 插件自己的合并 → 每个 config 的 `prompt_max_tokens` / `max_tokens` 与分布 | 无（只读端点） |
| `scripts/probe-issue94-default-cap.mjs` | 请求不带 `max_tokens` 时上游实际截在哪 | 一次生成（本次三次合计 **约 18 额度**，已用余额前后差值量过） |

```sh
node scripts/probe-issue94-maxtokens.mjs          # 需本地 Trae 凭据有效
TRAE_PROBE_ONLY=d node scripts/probe-issue94-default-cap.mjs
```
