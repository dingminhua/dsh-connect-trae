# 待写入 CHANGELOG 的条目（下一个版本）

> **这份文件是一块暂存区，不是文档。** 发版时把下面的内容整段追加到
> `CHANGELOG.md` 顶部（`# Changelog` 之后、最新已发布版本之前），然后删除本文件。
>
> **为什么不能直接写进 `CHANGELOG.md`：** 它是**随包文件**（在 `package.json` 的
> `files` 里）。已发布的 tag `v4.0.1` 之后若改动任何随包文件，
> `pnpm run verify:release` 会（正确地）报出「tag 之后改动了发布内容」——
> 因为那意味着线上包不再等于「tag 指向的源码」。而未发布版本的条目本来就
> 不属于已发布的那份 CHANGELOG。
>
> 放在 `docs/` 下是安全的：`docs/*.md` 不进发布包（只有
> `docs/assets/dsh-connect-trae-usage-card.png` 随包），所以改它不会污染发布内容。

---

### 修复

- **受限网络下模型目录走聊天网关备用 host，目录分组 function 兜底 `wireFunction`**（`fix(cn)`）。企业网只放行
  少数域名时，`solo.trae.cn` 的 CONNECT 被代理拒绝（403）→「刷新模型」500 fetch failed → 目录行拿不到
  `get_detail_param` 的 function（可聊 function 的 `config_info_list` 为空）→ 聊天按默认 `solo_work_lite`
  发请求 → 模型不在该 function 的 config 名单里就 4001（`config_name rejected`）。修复分三层：
  - **目录 host 回退**：官方 remote host 网络错误 / 超时 / 5xx 时，按序尝试聊天网关的同一路径
    （CN 为 `trae-api-cn.mchost.guru/api/remote/v1`，实测同路径同响应结构）；401/403/404 等语义性拒绝**不回退**。
    进程内记住最近一次**给出了非空目录**的 host。官方 host 失败后进入 5 分钟冷却：冷却期内先走记住的备用
    host、官方 host 排在链尾（备用也挂了时仍有一次机会），冷却到期后官方 host 重新排第一 —— 只把官方 host
    「排在第二」并不能让它被重试，因为循环在第一个成功处返回，所以必须显式冷却重试，恢复的网络才会在
    一个冷却窗口内重新接管。回退只作用于 remote/v1 目录这一个 base；`get_detail_param`、`llm_utils_chat`
    照旧走各自原有 host。
  - **目录分组 function 归因**：`fetchModels` 不再丢弃 `data.list[].function`——解析时把**可聊**分组的 function
    附到每个模型（同一模型出现于多个分组时按 `TRAE_DIRECTORY_FUNCTIONS` 的实测优先级取，而非请求参数
    `functions=` 的顺序；后者是历史列表，与 wire roster 自己的收集顺序不同，混用会让同一模型在「roster 有没有
    返回」两种网络下拿到不同 function）；`mergeTraeModelSources` 的 `wireFunction` 优先取 `get_detail_param`
    的结论，目录分组兜底（roster 知道账号的付费/可用状态，目录不知道）。
  - **非可聊 function 只降级、不丢行**：`solo_agent`、`builder_v3` 是 IDE/Remote-agent roster，聊天通道实测
    4011/4001，所以**不把这两个 function 写进 `wireFunction`**；模型本身**保留**，改由默认 chat function
    调用。原因是那 9 个只出现在 `solo_agent` 分组里的模型（`gpt-5.5`、`gpt-5.6-*`、`gpt-6-astra`、`glm-5.2`、
    `kimi-k2.7-code`、`Dola-Seed-2.0-Code`、`deepseek-v4-flash-0731`，见 `docs/ISSUE19_DIAGNOSIS.md`）实测
    在 `solo_work_remote / solo_work_lite / solo_agent_remote` 下**都能正常应答**——它们正是 issue #19 要
    暴露的模型，把它们整行丢掉等于在本次修复针对的受限网络里重新藏起 issue #19 的成果。仅带 `wireFunction`
    （无 `wireConfigName`）的目录行，聊天请求会带上该 function，但 `config_name` 仍由 resolver 提供
    （目录 id 只是展示名，网关 `config_name` 大小写敏感，见 issue #38）。默认 function 与 fallback 模型常量未动。

### 测试

- 回归用例：host 回退（官方网络错误 → 备用 host 同路径同查询；401 不回退；5xx 回退；**空目录继续尝试下一个
  base 且不被记住**；记住最近成功 host；**冷却到期后官方 host 重新排第一**；显式 baseUrl 钉住单 host）、
  分组 function 归因（可聊分组优先；**同一 function 名重复出现时不丢模型**；容量来自后分组时保留先到先得的
  function）、合并兜底与 `withChatCallableFunctions` 的**降级而非丢弃**、bridge 对 wireFunction-only 目录行
  保留 resolver 的 `config_name`（大小写）、以及受限网络端到端（wire roster 为空时 9 个 `solo_agent`-only
  模型仍然在目录里）。
- 全仓 **920** 例通过，0 skipped；`tsc` 两个工程干净；`build` 通过。
