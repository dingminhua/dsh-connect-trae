# issue #46 回复草稿

> 用途：回复 <https://github.com/dingminhua/dsh-connect-trae/issues/46>
> （yuantao313：「模型列表不对齐，无法获取DeepseekV4.1 Flash 1017模型ID · 插件中无法获取Trae的1017模型，只能使用正式版」）
>
> **状态：已修复**（本稿对应 `docs/ISSUE46_DIAGNOSIS.md`）。
> 取证：本机 CN 实时凭据，只读、零额度，探针 `scripts/probe-issue46-*.mjs` 随仓库提交。
> 可直接复制横线以内的内容。

---

先谢谢报告——截图把问题点得很准。**「模型列表不对齐」是真的，但根因和「1017 是一个新模型ID」的
直觉不太一样**，而且查下来是一个值得修的缺陷。我用本机 CN 凭据把整条链实测了一遍，下面是证据。

## 一、上游确实发布带日期的独立 config_name——不是别名

这点先纠正一下直觉：**`DeepSeek-V4.1-Flash-1017` 背后是另一个真实的 `config_name`**，
不是同一个模型的显示别名。上游有一族模型按版本发布独立配置，实测（逐行 dump 上游名单）：

| config_name | display_name | 归属 function |
|---|---|---|
| `kimi-k2` | `Kimi-K2-0905` | `chat_v3` |
| `kimi-k2-0905` | `Kimi-K2-0905` | `solo_coder` |
| `seed-code-pro-0430` | `Doubao-Seed-2.1-Pro` | `solo_work_remote` |

注意 `kimi-k2` 和 `kimi-k2-0905` **是两个不同的 id**，能力还不一样（116000 vs 200000/1M 档）。
所以 IDE 能同时列出 `DeepSeek-V4.1-Flash-1017` 和 `DeepSeek-V4.1-Flash` 两行 —— 它们本来就是两个条目。

顺带说明：在**我本机的账号**上，三份上游名单（IDE 全量 22 个 function、SOLO wire 5 个、Remote 7 个）
里 `1017` 出现 **0 次**，安装包和 IDE 日志全文检索也是 0 次。名单按账号/套餐裁剪，
所以你那一份有、我的没有，是正常的。

## 二、插件为什么看不到它们：**模型表系统性排除了「带日期的配置」**

插件的目录由两张表 join 出来，**主表是 Remote 目录**，而 `mergeTraeModelSources()`
只遍历主表 —— wire 名单里有、主表里没有的行，被**整体丢掉**。

实测最关键的一条：

| 名单 | 带日期的 config_name |
|---|---|
| Remote 骨架（插件的主表） | **0 个** |
| SOLO wire roster | 3 个 |

**这不是巧合，是一整类别的系统性缺失。** 上游把「当前快照」放在 wire 名单、把「带日期的版本快照」
放在别处，而插件的主表恰好只收前者 —— 于是每一个带日期的模型，插件都拿不到。

还有第二处：插件请求 Remote 目录时**没问几个 function**。`kimi-k2` 在 Remote 侧只归属 `inline_chat`，
而插件没问它。把查询放宽到 IDE 的那组 function 后，Remote 目录 33 → 41 行，多出来的全是真模型
（`kimi-k2`、`doubao_1_8`、`deepseek-V3`、`glm-4.7`…）。

两处叠加的后果：wire 名单每次 73–81 个 config，合并后只剩 33 行，**50 个被丢弃**。
其中约 30 个是工具配置和账号的自定义模型（丢掉是对的），但这 20 个不该丢：

```
kimi-k2 / kimi-k2-0905      glm-4.6 / glm-4.7 (+ -auto 孪生)
minimax-m2 / minimax-m2.1     qwen3-coder        glm-5-turbo
seed-code-pro-0430            Doubao_1_6         glm-5.1_advisor  等
```

这和仓库里 #19 / #42 是**同一个洞的两面**：#19 的结论是「名单的沉默不能证明模型不可调用」，
当时保护的是「Remote 有、wire 无」的方向；这次是反方向，没被执行到。

## 三、已修复（三处）

- **A. Remote 目录多问几个 function**（加 `inline_chat`、`chat` 等）。
  实测骨架 33 → 35 行，新增 `kimi-k2`（显示为 `Kimi-K2-0905`）、`doubao_1_8`。
- **B. 合并层补齐 wire 侧的行**，但有严格门槛 —— 必须是**真模型**而非工具配置
  （上游 `usage` 会写明是 `chat_completion` 还是 `summary`/`title_generation` 这类工具）、
  必须是 **Trae 预设**而非账号自己的自定义模型、必须有**真显示名**、且显示名**不能已被占用**
  （否则同一模型会以两个 id 出现两次）。实测把 50 行 wire-only 收敛到 7 个真模型。
- **C. 显示名**：这里有个反直觉的结论 —— **「以 wire 为准」是错的**。实测 wire 名单与 IDE 名单
  **有 32/81 行不一致**，而 Remote 骨架只有 **3/33** 不一致。原因是上游**按 function 发布不同的
  显示名**，插件的 wire client 读的是聊天 function，常常落在另一个名字上。所以显示名仍以骨架为准。

**修复效果（实测）**：目录 33 → **42 行**，新增 9 个此前拿不到的模型。

另外顺带修掉一个真 bug：上游对同一 config 在不同 function 下发布不同名字，而插件的 wire client
是先到先得，于是 `doubao-for-auto` 这种「拥有它的 function 恰好不知道名字」的模型，
在插件里显示成了 config id 本身。现在改成**行归拥有者、名字取最充实的那一份**。

## 四、想请你确认一件事

**你那台机器上，升级后 `DeepSeek-V4.1-Flash-1017` 应该会出现在列表里** —— 它正好落在
「骨架排除、wire 有」这一类，而这一类现在会被补上。

如果升级后**仍然没有**，那说明它在我没覆盖到的另一种形态里（比如它只存在于某个我还没问到的
function，或它的 `usage`/`config_source` 与我这边不同）。那时候麻烦你跑一下这个探针
（`scripts/probe-issue46-roster.mjs`，只读、零额度，随仓库提交），把输出贴回来 —— 我能直接看出
它卡在哪一层。

## 五、两点如实说明

- **新补上的 7 个模型我没有逐个实测能否调用**（那要花额度）。按 #19 的原则，缺的是「证据」不是「行」，
  但「真的能调用」这一条还需实测。
- `kimi-k2` 归属 `inline_chat`，而插件的可调用 function 列表里没有它 —— 它的可调用性我还没取证，
  需要和 #19 的 function 矩阵一起验。

改动都在 `src/catalog.ts`（合并层 + 提升门槛）、`src/solo.ts`（读 `usage`/`config_source`、
名字取最充实的一份）、`src/solo-remote.ts`（多问几个 function），配套回归测试在
`tests/catalog.spec.ts` 与 `tests/solo.spec.ts`。

## 六、顺带修掉的另一个缺陷：账号池开关保存后失效

排查过程中你可能还遇到过一个相邻症状：**在插件里打开账号池并保存，再打开插件又显示为没保存。**

这是一个**独立的缺陷**，与 1017 无关，但根因同类：插件有 4 处写 `regions` 的地方，其中
「保存模型列表」那处是**从零重建整个 region slot** 的，而它并不知道 slot 里还有 `pool`
这个字段 —— 于是这个写入**整体替换** slot，把账号池偏好冲掉了。

所以流程是：**开账号池 → 保存模型列表 → 池被关掉 → 重开显示「未保存」**。

（同一个写入还把 `creditPosition` 也冲掉了 —— 保存模型列表会把积分读数的座位重置回默认。）

修法是让这次保存**继承 slot 里它不拥有的字段**，只覆盖模型目录那五个。已加回归测试。

> 这与仓库里 #42 记录的 `wireConfigName` 丢失是同一类缺陷：整块替换 slot 时，
> 保存方不知道的字段就消失了。
