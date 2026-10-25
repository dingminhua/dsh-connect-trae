# 待写入 CHANGELOG 的条目（下一个版本）

> **这份文件是一块暂存区，不是文档。** 发版时把下面的内容整段追加到
> `CHANGELOG.md` 顶部（`# Changelog` 之后、最新已发布版本之前），然后删除本文件。
>
> **为什么不能直接写进 `CHANGELOG.md`：** 它是**随包文件**（在 `package.json` 的
> `files` 里）。已发布的 tag `v4.4.7` 之后若改动任何随包文件，
> `pnpm run verify:release` 会（正确地）报出「tag 之后改动了发布内容」——
> 因为那意味着线上包不再等于「tag 指向的源码」。而未发布版本的条目本来就
> 不属于已发布的那份 CHANGELOG。
>
> 放在 `docs/` 下是安全的：`docs/*.md` 不进发布包（只有
> `docs/assets/dsh-connect-trae-usage-card.png` 随包），所以改它不会污染发布内容。
>
> 这个文件本身就是这条规则的一次应用：**未发布的说明写在不进包的地方。**

---

## 未发布

### 新增

- **文生图接进会话：`trae_draw_image`**（`feat(tools)`）。
  - 用登录账号画一张图，并**尽力把字节取回落成本地文件**。默认关闭、**按面板单独开**：
    卡片模型栏勾上「允许模型自主生图」（`drawImageEnabled`）该面板才注册这个工具，
    取消勾选立即撤下；企业版面板不提供（租户网关是另一条计费面，行为未验证，不假装支持）。
  - **协议是实测出来的，不是从二进制里猜的**：`POST /api/ide/v1/tool_text_to_image`
    （另有 SSE 变体），请求体**只认** `{prompt, image_size?}`——多带 `mode_type`/`session_id`/
    `image_urls` 之类的已知字段直接 400 空 body，未知字段反被忽略；成功响应是**扁平**的
    `{"message":"success","uri":"tos-cn-i-…"}`，没有 `{code,msg,data}` 信封。模型 `seedream_5`。
  - **尺寸边界**：总像素必须落在 **3686400 ~ 16777216**（`1024x1024` 报
    `image size must be at least 3686400 pixels`、`4608x4608` 报 at most，两者都**不扣费**）；
    预设 `2k`/`3k`/`4k` 可用，缺省 `1920x1920`。
  - **计费口径写进工具文案**：实测 `1920x1920` 一张约 **8.8 积分**，上游不回传扣费数字。
    取图那一跳（同 `(prompt, size)` 带 `x-ide-sign` 再请求一次）**是否额外计费尚未验证**——
    缓存未命中时可能一张图扣两次，所以工具明确告诉模型「不要为了换张图重跑同一条 prompt」，
    并在失败后加 **30 秒冷却**（冷却内重试不会打到上游）。
  - **取不到图不算失败**：生成成功而字节没回来时，工具仍返回成功，`url` 是对象 key、
    `note` 写明原因——要求模型如实说「图生成了，但这里打不开」，不假装成功也不假装失败。
  - **范围**：改图（需先走 TOS 上传预签名）与文生视频（异步素材轮询）**不做**，也不留半截入口。
  - 新增 **17** 例单测 `tests/image-gen-trae.spec.ts`：尺寸边界与像素区间、请求体字段对齐
    （只发 `{prompt, image_size}`、缺省不填）、扁平响应解析（含 `code 3003`）、`x-ide-sign`
    的 md5 稳定性与取图 URL、SSE 帧只认小写事件名。

### 文档

- `README.md` / `README.en.md` 新增「文生图」一节与功能列表条目：开关语义、实测协议表、
  计费与那条**未验证**的取图跳转，以及「取不到图不算失败」。

### 修复

- **发布核验不再重建工作树，宿主不再被核验动作掀翻**（`fix(scripts)`）。
  - **事故**（2026-10-24 14:40:08 / 14:41:01 / 14:42:16）：桌面版渲染进程连崩三次
    （`EXC_BREAKPOINT`/`SIGTRAP`），应用白屏，最后要人工重启。取证在
    `~/Library/Logs/DiagnosticReports/DeepSeek Harness Helper (Renderer)-*.ips`。
  - **成因**：开发者常态是把 bundle 以**软链**装进 profile
    （`node_modules/dsh-connect-trae -> <本仓库>`），于是运行中的 DSH 宿主服务的正是本仓库
    `lib/` 的字节；而 `scripts/verify-release.mjs` 的第 4 步（确定性重建比对）原本
    **在工作树里**跑 `npm run build`——等于当着活着的宿主改写它正在服务的客户端 bundle，
    宿主重新 import，渲染进程崩。
  - **修法**：重建改到**临时 worktree**（`git worktree add --detach <tag>` + 软链
    `node_modules`）里做，工作树的 `lib/` 一个字节都不动；`git worktree remove` 在收尾时
    清理。用 worktree 而不是 `git archive | tar -x`，是因为测试机上的 PATH 上有**假的
    `tar`**（发布测试用它冒充 registry），走 tar 会解出错的树。
  - **守卫**：`tests/verify-release.spec.ts` 新增一例「工作树不被重建」。变异验证：把重建
    改回 `cwd: repo` → 该例立刻变红（fixture 的 build 会真的写 `lib/`）。
- **构建前会提醒「这次会改写正在被宿主服务的字节」**（`chore(scripts)`）。
  新增 `scripts/warn-live-host.mjs`，接到 `prebuild` 钩子：检查「有没有 profile 软链到本仓库」
  且「有没有活着的宿主进程」，两者同时成立就打印警告。**它从不失败构建**——热更新的正当
  流程必须还能走；崩了重启应用即可。

### 文档

- `DEVELOPMENT.md` 新增首节「危险动作：不要在宿主运行时重建 `lib/`」：讲清软链装法、
  事故时间线与三种场景下该怎么做（不开了随便构建 / 只验证发布用 `verify:release` /
  要热更新就接受代价 / 发版前先关宿主）。
- `RELEASING.md` 第 8 步补一句：第 4 步的重建在临时 worktree 里做，理由与对策指向上面那节。
- **在核心位置写明「不做插件之间的联动」这条边界**。
  - `README.md` 开头加一条醒目的边界声明，并新增 `## 与其它插件的关系` 一节（英文版同步）：
    不共享状态、不做跨插件的账号/额度调度、不协商槽位、不共享开关，以及立这条边的理由。
  - `src/index.ts` 的**模块头**加 SCOPE BOUNDARY 注释：本模块只与 DSH Host 和 Trae 上游
    两方对话，不读写任何其它插件的文件或状态。
  - 补一条区分：同一族插件之间**互相学习**（workbuddy 的教训被写进本仓库的注释与测试），
    但**不互相调用**——学习是编译期的事，联动是运行时的事。
