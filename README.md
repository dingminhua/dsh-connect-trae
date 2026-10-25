<p align="center">
  <img src="docs/assets/dsh-connect-trae-usage-card.png" width="860" alt="dsh-connect-trae settings panel" />
</p>

<h1 align="center">dsh-connect-trae</h1>

<p align="center"><b>把本机登录的 Trae 模型接入 DeepSeek Harness，并提供用量/积分概览与每日签到领取。</b></p>

<p align="center">
  <a href="README.en.md">English</a> ·
  <a href="#安装">安装</a> ·
  <a href="#工作原理">工作原理</a> ·
  <a href="#模型覆盖范围">模型覆盖范围</a> ·
  <a href="CHANGELOG.md">更新日志</a> ·
  <a href="https://github.com/dingminhua/dsh-connect-trae/issues">问题反馈</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/dsh-connect-trae"><img src="https://img.shields.io/npm/v/dsh-connect-trae?style=flat-square&label=npm&color=cb3837" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/dsh-connect-trae"><img src="https://img.shields.io/npm/d18m/dsh-connect-trae?style=flat-square&label=downloads&color=cb3837" alt="npm downloads"></a>
  <a href="https://github.com/dingminhua/dsh-connect-trae/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/dingminhua/dsh-connect-trae/ci.yml?branch=main&style=flat-square&label=tests" alt="test status"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/dingminhua/dsh-connect-trae?style=flat-square" alt="MIT license"></a>
  <a href="https://github.com/dingminhua/dsh-connect-trae/stargazers"><img src="https://img.shields.io/github/stars/dingminhua/dsh-connect-trae?style=flat-square" alt="GitHub stars"></a>
  <a href="https://dshfind.com/plugins/dingminhua/dsh-connect-trae"><img src="https://dshfind.com/api/badge/dingminhua/dsh-connect-trae" alt="dshfind plugin"></a>
</p>

一个独立的 [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) bundle 插件。它把本机已登录的 Trae 账号（**国内版、企业版与国际版均支持**）接到 DSH 的模型选择器：模型负责生成结构化工具调用，`bash` / `read` / `write` / `edit` 等工具由 DSH 本地执行；同时提供用量概览（国内版 Work/通用积分、企业版租户额度、国际版订阅状态）、每日签到领取与模型管理界面。**国内版、企业版与国际版是三个并行的供应商（`trae` / `trae-enterprise` / `trae-global`），可同时使用**；插件设置卡片以 tab 区分三者，方便统一管理。

**支持 macOS、Windows 与 Linux**：CI 在 `ubuntu-latest` 与 `windows-latest` 上跑完整 typecheck / 测试 / 构建；Windows 侧的目录探测、应用版本头与锁行为均有针对性处理，详见 [Windows 说明](#windows-说明)。

> 除每日签到领取外，插件的所有查询都是只读的、不消耗额度；签到领取也只在你点击按钮时才发生。

> **边界：本插件不与任何其它插件联动。** 账号、凭据、模型目录、账号池与设置命名空间都只属于本插件；`trae` 失败不会借用别的插件的账号或额度，反之亦然。理由与具体含义见[与其它插件的关系](#与其它插件的关系)。

## 功能特性

- **三供应商并行接入** —— 国内版注册为 DSH 的 `trae` provider（`DeepSeek-V4-Flash`、`DeepSeek-V4-Pro` 等），企业版注册为 `trae-enterprise`，国际版注册为 `trae-global`（Gemini / GPT / MiniMax 阵容），**三边模型同时出现在 DSH 模型选择器里**：不同会话可以各选一边，互不干扰。
- **企业版是独立计费通道，不是国内版的别名** —— 同一张 CN 凭据若属于 `tob_online` 租户，会被**两个**网关同时服务：消费池（扣个人积分）与租户池（扣企业额度）。同一模型、两种付费方，所以「谁付钱」由你显式选，插件不替你猜。`trae` 永不碰企业网关；`trae-enterprise` **不回落**，被拒绝就如实报错，不会悄悄改用个人额度重跑。企业版**默认关闭**——纯个人账号用不了企业池，默认放开等于塞一条一用就失败的 provider。
- **可单独关闭任一面板** —— 三个 tab 各带一个勾选（国内版与国际版默认勾选，企业版默认不勾）：取消勾选即把该面板的供应商**整个从 DSH 模型选择器撤掉**（不是只藏起 tab），并且不再发起任何请求；重新勾选即恢复，账号、目录、勾选与上下文预算全部保留。用不到国际版就把国际版关掉即可。
- **插件卡片 tab 切换** —— 设置卡片顶部为「国内版 / 企业版 / 国际版」三个 tab，各含独立的账号选择、用量概览与模型管理；每个 tab 的账号、目录、勾选与未保存草稿完全隔离——在一个 tab 里切账号或刷新模型，不会触碰另一边的运行时目录与会话。国内版与企业版共用同一份 CN 凭据池，但**各有各的账号绑定与模型勾选**：两个池的名录并不相同（`DeepSeek-V4.1-Flash` 只有企业池列），所以勾选互不覆盖。
- **卡片内再按「账号 / 模型 / 诊断」分栏**（学自同族 `dsh-connect-workbuddy`）—— 上面那排地区是**作用域**（这张卡片讲的是哪个供应商），这一排是同一张卡片里的**分栏**：账号栏管「谁在服务、还剩多少、签到与账号池」，模型栏管「勾哪些模型、图片输入、上下文预算、保存」，诊断栏只读地列出面板名、供应商 id、服务账号、两种令牌到期时间、目录/已启用模型数、账号池与签到支持与否，以及本面板最近一次报错的**原文**。**4.4.7 起诊断栏还多一行「损坏副本留存」**：读不出来、因此被改名留存的账号副本会在这里被点名（连同它曾经保存了几个账号）——被顶掉的账号「去哪了」这个问题，从此不用再去 `~/.dsh` 里翻文件名；未登录那一屏也会显示同一条通知，因为账号消失之后用户落地的正是那一屏。分栏的理由是**提交语义不同**：账号改动点一下即生效，模型改动是草稿、必须点「保存」——一列长页会把保存按钮放到离它要保存的东西三屏之外。切栏不重新拉取、不丢未保存的模型草稿、账号池日志也不重建；未登录时不出分栏，那一屏说明不会被看不见的 tab 藏起来。**模型栏把所有模型一次性铺开，没有内层滚动条**——不再是一个套在滚动页面里的小窗口，唯一滚动的就是卡片自己那一页。
- **账号池：自动选号 + 失败换号（默认关闭）** —— 本机读完几个账号后，「该用谁的额度」可以交给插件按规则排序：**先排除不可用的**（凭据被拒、套餐不覆盖、账号已不存在、限流未到重试时间、额度耗尽），再在可用账号里**优先快到期的那点额度**（与其放着过期，不如先花掉），最后才比总额、token 新鲜度，并以账号 id 兜底成**全序**（同样的输入永远得到同样的顺序，不会在两行之间来回抖）。三个面板**各有各的池**：国内版与企业版共用同一份 CN 凭据，但企业版只挑租户账号、国内版不会漂到租户号上。开着池时，发请求前先按上面的顺序选中一个账号，并且**真实请求失败会换下一个账号重试（最多 3 个）**——只有账号级失败才换（`401` 凭据被拒、额度耗尽、限流、上游 5xx）；模型 id 写错、请求本身不合法**不换号**，因为那不是账号的问题，换号只会把同一个错误烧两遍、还冤枉一个没机会服务的账号。换号失败的真相会写进池的探针记录，下一次排序直接把它排到后面，而每一次结论都能在卡片上看到：`可用` / `限流` / `额度耗尽` / `凭据被拒` / `套餐不覆盖` / `上游不提供` / `本次未测出`，以及「什么时候可以重试」。**关掉池就回到严格绑定**，不会有任何残留 override。卡片里的「全部测速」会把每个成员按目标模型各测一次，结果**边跑边显示**（一行一个答案，不等整批跑完），并落盘成下次排序的依据。

  > 池是**显式选择**：默认关闭。它不会替你在没打开池的情况下换账号——「换账号等于换人计费」，所以这件事只能由你点头。池打开后卡片会明确写出**当前是谁在付费**（Host 报告的是「下一个真正发送请求的账号」，不是保存的那个绑定）。

- **倍率内嵌模型名** —— 模型名称按 Trae 自身菜单的格式显示积分倍率（如 `GLM-5.2 · x0.79`），倍率随目录刷新更新。
- **活动优惠徽标** —— Trae 把促销规则发在目录里（`activity_discount`：折扣比例、原价、闲时时段与时区），插件按**当前时钟**判定后，在模型名旁边画一枚胶囊：`5 折` / `闲时 5 折` / `限时 5 折`，悬停写明原价、现价与时段。判定放在**渲染时刻**而不是解析时刻，所以夜间折扣不会在第二天早上继续挂着；上游说「此刻没打折」就不画，**不从倍率反推**，也不给没有结束时间的活动编「限时」。这是纯提示：不改请求、不改计费，国际区（订阅制）没有这项数据因此不显示。详见 [docs/PROMO_BADGE.md](docs/PROMO_BADGE.md)。**同一枚胶囊也画在 DSH 的模型选择器里**（宿主 `conversation.input.model.label` 插槽），挑模型时就能看见——毕竟徽标画在设置卡片里时，你已经选完了。选择器里**倍率只出现一次**：名字里已有的目录倍率会被拆出来，有折扣时换成**折后价**（与卡片同一套时钟判定，同一份数据），打开选择器不会额外触发上游读。
- **DSH 本地工具循环** —— 通过 Trae `llm_utils_chat` 获取待执行的结构化 `tool_calls`，交由 DSH 自带的本地工具执行，再将工具结果回传模型。
- **文生图（`trae_draw_image`）** —— 把登录账号的 Trae 文生图能力接进会话：模型画一张图，插件把**图片字节一起取回来**、写进会话目录再显示给你。**默认关闭、按面板单独开**——生图真实消耗积分（实测 CN 个人版 `1920x1920` 一张约 8.8），所以它和识图那种「让不让看图」的开关不同，只能由你点头。协议、尺寸边界、取图那两步，以及为什么「取图」那条 GET 其实是又一次生成，见下方「[文生图](#文生图trae_draw_image)」。
- **国内国际双区域自动识别** —— 自动发现 Trae CN / TRAE SOLO CN / Trae / TRAE SOLO 四个本地安装的登录账号；区域由凭证自带的 `userRegion` 声明自动判定（host 后缀与 edition 标签兜底），无需手动指定。
- **目录与勾选按面板隔离** —— 三个面板各一套模型目录、勾选、图片开关与上下文预算，各自读各自的槽位。名录从**该面板所钉的那条网关**读取——原本钉在企业池的客户端去读消费池名录，会永远发现不了自己池的独占模型。
- **识图能力跟随 Trae 自身的标注** —— Trae 把某个模型标为 `multimodal` 时，插件直接按多模态对外声明，无需你在卡片上逐一手勾（issue #16）。判据是「**你手动勾选的 ∪ Trae 标注多模态的**」：Trae 明确标 `false` 或未标注的模型保持纯文本，你可以照旧手动为它们打开图片输入。卡片上被自动开启的那一行显示为已勾选且只读，并说明原因。详见下方「图片输入（识图）」。
- **多账号切换** —— 支持重新读取 Token 列表并选择账号；Token 不写入 DSH 设置。**你的选择会被记住并长期生效**：插件不会因为某个账号额度用尽、或检测到另一个可用账号就自作主张替你切换（换账号意味着换人计费）——唯一的例外是你**亲自打开**的账号池（见下一条），那是一个显式选择，而不是插件的自作主张。所以当绑定的账号额度耗尽时，卡片会**明确告诉你**，并把本机其他还有额度的账号连同其可用积分数列出来，由你一键切换——而不是让面板一直空着、也不自动把你切走。「刷新账号与 Token」每次都会回报结果（找到几个账号、当前仍绑定谁），不会再「点了没反应」。下拉里显示的是产品名（`Trae` / `TRAE SOLO` / 国际版），便于分辨凭据来自哪个安装。
- **账号导入 / 导出** —— 不用再为了用第二个账号而把凭据手工写进默认路径、顶掉上一个。在卡片账号区的「导入 / 导出账号」里：**导出**勾选若干账号下载一份 JSON；**导入**选择文件后先看**脱敏预览**（只显示账号标识与「是否有 Token」，不含凭据本身）再勾选导入。文件格式与同族 `dsh-connect-workbuddy` **互通**，两边导出的文件可以互相导入。导入按账号去重（同一账号再导入即覆盖更新），**认不出所属区域或因缺 Token 的记录会被跳过并计数**——国内版与国际版是两条并行计费通道，跨区导入会导致跨区计费，所以这里只认同能**正向识别**的区域（企业版共用 CN 凭据池，不构成第三条导入通道）。导出文件里是**有效 Token，请当作密码保管**。（issue #37）
- **只读用量与模型管理** —— 国内版查看 Work 积分与通用积分，国际版查看订阅/试用状态；刷新/启用 Trae 模型；只读查询不消耗额度。
- **积分临近到期会提醒** —— 剩余额度只回答「还有多少」，回答不了「**哪一笔先到期**」；提醒条按到期紧迫程度逐级加重（**7 天 → 24 小时 → 已过期**），写明金额、套餐数和最早到期时间，避免只盯总额时悄悄丢掉最先到期的额度。国内版在用量页与输入框积分面板两处都显示（国际版是订阅制，没有逐包到期数据）。
- **一键测试启用模型** —— 给**已启用**的每个模型发一条最小消息（一句 `ping`、不带工具），逐个告诉你能不能真的应答：**可用** / **需要更高档位**（Trae `1005`，你的套餐不覆盖）/ **上游不提供**（`4001`，SOLO 通道没有这个模型）/ **被限流**（`4011`，Trae 限了这条通道）/ **登录凭据被拒** / **本次未测出**。最后一项是一等公民：超时、断连、代理、5xx **一律不算「不可用」**——只有上游明确的拒绝才算负面结论。**这是插件里唯一消耗额度的操作**（签到改变的是账号状态，不消耗），只在你点击时运行，结果只留在当前会话里不写入设置。
  > `4011` 是**限流**不是「模型不可用」（issue #33 实测）：它额度耗尽走的是另一个码 `4008`，所以「额度还有很多却报 4011」两句话可以同时成立。被限流的模型**等你一会儿再试**即可，不要删。
- **一键测试所有模型** —— 同一套探测，作用于当前 region 的**全部可见模型**（不限于已启用的）。想知道「没启用的那些到底还能不能用」时用它——比如套餐降级后，或 Trae 调整了模型阵容之后。
- **每日签到领取（逐账号）** —— 国内版**每个账号行各有一个签到按钮**，当日奖励直接写在按钮上（`签到 +150`）；该账号当天已领显示「已领取」并禁用，**本机今日名额已被别的账号用掉**时显示「本机已签」并禁用——如实区分「这个账号领了」和「这台设备领过了」，绝不把后者说成「已领取」。这是插件里**唯一会改变账号状态**的操作，由你主动点击触发；一次点击只针对该行账号、只发一次请求。Trae 的签到按「**每台设备每天一次**」计（换账号不会重置当天名额），所以逐账号签到始终是主路径。账号池里另有一个「全部签到」，它**不是**把同一件事盲目重复：一旦上游回 `9095`（本机今日已领），整批立刻停止并把剩余账号如实标成「本机已签」，产出的是真相而不是一排假失败。国际版没有签到活动，因此不显示该按钮。
- **输入框读数** —— 在输入框工具栏（「专家」与模型选择器之间）显示一块可点击读数，5 分钟自动刷新。**两个区域都显示，但显示的东西不同，这是数据决定的**：国内版是积分制，显示「Trae CN · <通用积分>」；国际版是订阅制，它的用量文档里根本没有积分字段，所以显示「Trae 国际版 · <套餐>」（如 `Pro` / `Free`）。**整块可点击**，弹出浮层显示一张**表格**：本区域**每个账号一行**，国内版列**通用积分**、国际版列**套餐**，**点行即可切换账号**（写入与卡片相同的 `accounts` 字段、合并时不丢掉另一个区域的选择），并把手动刷新按钮放在浮层里。**只在当前会话选中的模型属于本插件时出现**——选其它供应商的模型时整块不渲染。这样两个连接器插件不会争同一个位置（侧边栏底部是共享的根级行，输入框工具栏是按会话、按供应商的）。

  <img src="docs/assets/dsh-connect-trae-composer-credits.png" width="536" alt="Trae credits panel: a table of accounts with their general balance, and the composer readout below" />

  **读数显示在哪里可以选**（学自同族 `dsh-connect-workbuddy` issue #62）。默认在**输入框工具栏**（即上面说的位置）；如果那里被别的插件占了、读数不显示，改成**输入框下方**——那是「轮次 / 步数 / token」统计所在的那一行，读数是**追加**在官方统计之后，不会顶掉它们。位置**按面板分别设置**（三个面板各存各的），在卡片「设置」区紧挨「在输入框工具栏显示积分读数」那个勾选框。之所以要有第二个位置：输入框工具栏是**共享的 list 插槽**，外壳自己的控件和其他插件都注册在那里，而共享插槽**无法保证每个占用者都可见**——同族的报告者装了第三方插件后读数就整个消失了（本插件早年放在侧边栏底部时也被挤成过一个「Tr」的残片）。

- **安全 loopback shim** —— 每区域一个随机端口 + 进程内随机 secret，真实 Trae token 不交给 pi-ai。

## 工作原理

```text
DSH PiAiAdapter（每个 provider 一套）
  -> 安全 loopback shim（每区域一个随机端口 + 进程内随机 secret）
  -> TraeSoloBridge
  -> 国内版 https://trae-api-cn.mchost.guru/api/agent/v3/llm_utils_chat
  -> 企业版 https://console.enterprise.trae.cn/api/agent/v3/llm_utils_chat
  -> 国际版 https://coresg-normal.trae.ai/api/agent/v3/llm_utils_chat
  -> Trae SSE / pending function_call
  -> OpenAI SSE tool_calls
  -> DSH 本地执行工具并回传结果
```

每个面板各持一套完整的运行时栈——凭据 store、模型 catalog、wire 映射、上游客户端、回环 shim、adapter——按凭证自带的区域声明隔离可见账号，所以**多个区域的账号可以同时在线、同时被不同会话使用**。

**面板不是区域。** `cn` 与 `ai` 恰好与两个区域一一对应，但企业池共用 `cn` 凭据却计费到另一个账户、供另一份名录，它需要自己的开关、自己的账号绑定与自己的模型选择——那正是「面板」这个概念。把面板与区域分成两个概念，`enterprise` 就能用同一套设置管道处理，存储形状不变：它只是 `regions` 映射里的又一个槽位。

国内区因此并列发布两个 provider，**路由在构建 provider 的客户端时固定**，不存在「按调用猜一次」：shim 为每个 provider 提供一条 bearer 路由并按 bearer 分派，未知 token 直接 401，不会退回第一条路由。企业网关要求每次调用带 `session_id`，而消费网关会拒绝带它的请求体，所以只在该路由上加。

用量概览走 `https://api.trae.cn/trae/api/v2/pay/*` 与 `/trae/api/v2/ug/*` 只读接口（国际账号走其自有网关的订阅状态端点）；每日签到领取是其中唯一的写操作，走 `POST /trae/api/v2/ug/checkin_credits/claim`，需要携带本机安装的设备号（`x-device-id`，与聊天通道同源）。该设备号也正是签到「每台设备每天一次」的判定依据，所以换账号不会重置当天名额。刷新得到的 token 按区域存放在 `$DSH_HOME/.trae-auth.cn.json` 与 `$DSH_HOME/.trae-auth.ai.json`（两个账号同时在线互不覆盖；旧的单文件 `.trae-auth.json` 作为迁移来源保留读取）。

> 详见 `docs/IMPLEMENTATION_PLAN.md`、`docs/SOLO_ROUTE_DECISION.md`、`docs/USAGE_API_RESEARCH.md`。

## 与其它插件的关系

**本插件不与任何其它插件联动。** 这是一条边界，不是一句口号：

- **不共享状态。** 账号、凭据、模型目录、账号池、访问令牌、设备号都只属于本插件；插件只读写自己的文件（`$DSH_HOME/.trae-auth.*.json`、`.trae-auth.deleted.*.json`、`.trae-pool.*.json`）与自己的设置命名空间，**不读、不写、也不为任何别的插件供数**。它确实会编辑 Trae 桌面应用自己的登录文件，但那是另一个**应用**，不是另一个插件。
- **不做跨插件的账号或额度调度。** 账号池只在本插件自己的账号之间排序与换号；`trae` 失败就是失败，不会去「借」另一个连接器插件的账号、额度或通道，也不会把请求转交给别的插件重试。反方向同样成立：没有任何插件能通过本插件代发请求。
- **不协商槽位。** 卡片与 composer 读数是否出现，由**本插件的 provider 是否被选中**决定（读 DSH 自己的 `modelSelection` 投影），不靠插件间通信分配位置。两个连接器插件同时安装时，它们靠「各自只在自己的 provider 被选中时出现」共存——这是**互不干扰**，不是协作。
- **不共享开关。** 关掉本插件的某个面板，只撤下本插件的 provider 与请求，不会改动另一个插件的供应商、模型、绑定或设置。

**为什么立这条边界。** 插件之间一旦互相依赖，任何一个插件的升级、卸载或版本线变化，都会悄悄改变另一个插件的行为；而 DSH 的加载顺序、多版本并存与用户自定义 profile 让这种耦合无法可靠表达。立住这条边界，「出问题的是谁」永远可以定位到**一个**插件，而不是一串。

> 同一族插件之间**互相学习**（`dsh-connect-workbuddy` 的教训被写进本仓库的注释与测试），但**不互相调用**——学习是编译期的事，联动是运行时的事，这两件事必须分开。

## 图片输入（识图）

插件对外声明「这个模型是否接受图片」，DSH 据此决定附图是**原样发出**还是**降级成文字描述**。所以这条声明是硬开关，不是一个无关紧要的标记。

判据是**两个来源的并集**（issue #16）：

| 来源 | 含义 |
|---|---|
| Trae 目录自带的 `multimodal` 字段 | Trae 自己对「这模型读不读图」的回答。Trae IDE 本体的附图按钮就是纯粹由这个字段驱动的，没有用户开关 |
| 你在卡片上手动勾选的 `imageModelIds` | 显式选择。即便 Trae 后来不再标注该模型，你的勾选也不会被撤掉 |

要点：

- **只有 `multimodal === true` 才自动开启。** 字段缺失（旧版本保存的目录、兜底目录）或明确 `false`，都按纯文本处理——宁可不发，也不对一个能力不确定的模型谎报「支持图片」。
- **自动开启并不等于自动发图。** 它只是让 DSH 允许你给该模型附图；图片始终由你在对话里自己贴，插件不会替你发送任何东西。
- **被自动开启的行在卡片上显示为已勾选且只读。** 因为并集语义下取消勾选会被立刻重新加上，给它一个可点的框是在撒谎。目前不为单个模型提供「强制关闭」的出口；如果你需要这个开关，可以在 issue #16 下提出。
- 手动勾选对 Trae 标注 `false`（或未标注）的模型依然有效，这是为那些「上游没标但实际可用」的情况留的口子。

## 文生图（`trae_draw_image`）

TraeWork / SOLO 侧那套文生图服务带出来了：在会话里让模型**画一张图**，插件把图片字节取回来、落成会话目录里的文件，再按相对路径显示在聊天里。取图走 `get_resource_url` 解析签名地址，不会重新生成、不额外计费——见下表。

**默认关闭，按面板单独开。** 生图**真实消耗积分**（实测 CN 个人版 `1920x1920` 一张约 8.8 积分），所以它不是识图那种「让不让看图」的声明，而是一个要你点头的支出口：卡片模型栏勾上「允许模型自主生图」（`drawImageEnabled`），该面板的 `trae_draw_image` 才注册进 DSH；取消勾选立即撤下。面板各存各的开关；企业版与国际版面板不提供——企业版租户网关是另一条计费面，国际版按另一套套餐计费，两者的生图行为都没有测过，不在这里假装支持。

**口径（全部实测，不是从二进制里猜的）：**

| 项目 | 事实 |
|---|---|
| 端点 | `POST /api/ide/v1/tool_text_to_image`（另有 SSE 变体 `..._stream`），模型 `seedream_5` |
| 请求体 | 只有 `{prompt, image_size?}`。多带已知字段（`mode_type` / `session_id` / `image_urls` / `watermark`）网关直接回 400 空 body——未知字段反而被忽略 |
| 成功响应 | 扁平结构 `{"message":"success","uri":"tos-cn-i-…/cn/<uid>/gen_image/<ts>_<hex>_jpeg_1920x1920"}`，**没有** `{code,msg,data}` 信封 |
| 尺寸 | 总像素必须落在 **3686400 ~ 16777216**：`1024x1024` 太小被拒（`code 3003`，不扣费）、`4608x4608` 太大被拒；预设 `2k`/`3k`/`4k` 可用，缺省 `1920x1920` |
| 取图 | **两步、零额外计费**：`POST /api/ide/v1/get_resource_url`，body 只能是 `{"uri_list":["<key>"]}`（`{uri}`/`{path}`/`{resource_uri}`/`{uris:[…]}`、GET `?uri=` 都只回 200 + 空 `url_map`），应答 `{"url_map":{"<key>":"<byteimg 签名 URL>"}}`；再直接 GET 那个签名地址（**不带任何 Trae 头**，签名在 query 里）拿字节——实测 `image/jpeg`、1,155,578 字节、头 `ffd8ffe0` |
| 那条 GET 的真实身份 | 决定性探针：POST 拿到 `…/1792954795741_44f94116_jpeg_1920x1920` 后，用同一 `(prompt, size)` 打 GET，回来的是**另一个** uri（`…/1792954810505_b107ac11_jpeg_1920x1920`），耗时 27 秒、一个像素都没有——等于又画一张、再扣一次（两次共约 17.6）。非法尺寸探针（`100x100`）也印证：报错直接来自 Ark 的 `[callArkImageGeneration]` |

**图是真的取回来了。** 工具成功时返回 `url`（Trae 对象 key，留作排障）、`path`（相对会话目录的本地文件，如 `trae-images/trae-20261026-0420-ab12cd.jpg`）、`model`、`prompt`、`size` 和一句 `hint`；渲染层输出 `![Trae 文生图](trae-images/…)`——DSH 的聊天按 session cwd 解析这个相对路径，再过宿主的 `api/file` 鉴权路由取字节，所以图直接显示出来。只有字节真的没拿到时（`IMAGE_UNAVAILABLE`：图已生成、积分已扣）才退化成「只有对象 key」的行内代码；那种失败照样进 30 秒冷却——生图按张计费，重试等于再买一张。

**改图与文生视频没有放开。** 改图要先走 TOS 上传预签名（本插件没有这条链路）；视频要轮询素材结果，是另一条异步管线。两者都不做，也不留半截入口。

## 模型覆盖范围

插件提供的是 Trae **SOLO 通道**的模型（`DeepSeek-V4-Flash-Official`、`DeepSeek-V4-Pro-Official`、`GLM-5.3`、`GLM-5.2`、`Kimi-K3`、`MiniMax-M3`、`Qwen3.8-Max`、`Doubao-Seed-*` 等），三个面板均走这条通道。企业池另有一份名录（例如 `DeepSeek-V4.1-Flash` 只有企业池列），所以两边勾选互不覆盖。

以下 2 个模型目前来自 **TraeCode（Trae IDE）通道**，尚未开放到 SOLO 通道：

| 模型 |
| --- |
| `kimi-k2.8-preview` |
| `qwen3.8-flash` |

它们**会出现在模型列表里**（Trae 的目录列出了它们），但插件侧暂时没有可调用它们的通道。选中后发送消息会得到一条**明确的错误**，例如：

```
Trae does not serve this model under the SOLO function the request used
(config_name rejected) · Trae code 4001 · upstream: We're sorry, the param is invalid…
```

即「上游不提供该模型」被如实说明，而不是静默失败或像网络故障。**官方把它们开放到 SOLO 通道后，插件会自动可用**（判据就是能不能拿到调用 id），无需升级插件。

> **同一条报错的另一种成因（3.5.1 已修，issue #38）**：`DeepSeek-V4` 四行曾报**同样的 4001**，但成因相反 ——
> 它们在上游名单里**本来可以调用**，只是 CN 区的 wire 把同一族列了三行且共享展示名，旧代码让**最后**一行
> （元数据残缺的小写行 `deepseek-v4-flash`）抢走了展示名键，桥接层据此把 `config_name` 改写成小写拼写，
> 上游拒收。**判别方法**：看这个模型在上游名单里有没有调用 id —— 有而报 4001，就是这一类。
> 3.5.1 起两张映射表都改为先到先得，不再发生改写，四行已实测恢复正常。

> **为什么现在会显示（2026-10-02 起的策略）**：此前这类「目录里有、但拿不到调用 id」的模型会被**直接隐藏**，理由是「放出来只会报错」。但可调用名单是**按账号档位**下发的——在免费账号上测不到，不等于付费账号用不了（issue #19 的报告人就是 Pro：他的账号能调用本机免费账号被门禁挡住的模型）。**隐藏用户自己 Trae IDE 里有的模型，比让他看到一条明确的错误更糟**，所以改为：全部呈现 + 如实报错。

> `deepseek-v4.1-flash` 曾在此列——`docs/DS41_CALLABILITY.md`（2026-09-15 取证）实测 8 个 SOLO function
> 全部返回 `4001 param is invalid`。**上游后来把它开放到了 SOLO 通道**：当前实时目录里它带
> `wireFunction: solo_work_remote`，可正常调用（已实测刷新确认）。文档此前未同步，现已从表中移除。

> `glm-5.3-flash` 同样曾在此列，**4.4.0 起已移除**：上游后来开放了它，当前实时 wire 名单里它带
> `wireFunction: solo_work_remote`（实测）。**目录侧那一行一直都在**——它此前被列出来的原因是
> Remote 目录列出了它而 wire 名单没有，于是既拿不到调用 id、也从未进入可调用名单；
> 4.4.0 修好了「wire 有而目录没有」与「目录问了但没问全」两处之后，它作为**普通可调用模型**出现。

> 注意区分：**`GLM-5.3` 是支持的**（走 SOLO 通道）。`glm-5.3-flash` 现在**也支持了**——
> 它与 `GLM-5.3` 始终是两个不同的模型，但前者已开放到 SOLO 通道。

如果你现在就要用这 3 个模型，请直接在 **Trae IDE 本体**中使用。

## 最大输出与上下文预算

模型卡上的「最大输出」来自 Trae `get_detail_param` 的 `model_detail_list[].max_tokens` —— 上游**是**发布这个值的（CN 实测 80/80 config 都带）。4.0.1 起它随目录合并一路带到卡片、`/models/refresh` 与 DSH 模型注册；此前合并层漏传了这个字段，整区模型全部显示空白（issue #42，诊断见 `docs/ISSUE42_DIAGNOSIS.md`）。**仍然空白的行是诚实的**：目录里有、但 SOLO 名单里没有对应 config 的模型（上面那 3 个 TraeCode 通道行）拿不到任何候选值，宁可空白也不编一个上限。这个值是元数据，插件不把它写进请求体（输出上限由 Trae 服务端决定）。

上下文窗口在 Trae 公布的默认（dev）档与 Max 档之间选，**4.4.8 起对宽窗模型多一个 500K 中间档**，按面板逐模型存成 `contextBudgets`。500K **不是**上游公布的窗口，是本地的半步：dev 常见 200K/256K/272K，Max 常见 1M，从默认直接跳到 Max 是 5 倍，而 1M 的计费并不是每个会话都用得上。所以它是**有门槛的**：只有当该模型的 Max ≥ 500K、且 500K 确实比 dev 宽、又确实比 Max 窄时才出现——`applyContextBudgets` 用**同一条规则**（`contextBudgetOptions`）校验，落盘值不是该模型可选窗口就一律退回 dev 档，绝不会把模型撑到它没有的窗口（比如某模型后来被上游把 Max 调到 256K，旧的 500K 会安静地失效而不是溢出）。

想整区一次切换：模型管理区有「**整区切到 500K**」（给本区所有 Max ≥ 500K 的行写入 500K，其余不动）、「**整区切到 Max**」（给每个带 Max 档的行写入其 `maxContextWindow`，没有 Max 档的行不动）和「**全部恢复默认上下文**」（清空本区预算）三个按钮，作用在草稿上、按「保存」生效，与逐行单选落盘的结果完全一致（issue #42 附带需求——CN 有 18 个 Max 模型，以前要点 18 次）。

## 安装

推荐使用 DSH 插件命令安装 npm 已发布版本：

```sh
dsh plugin --profile desktop add dsh-connect-trae
```

或直接通过 npm 安装：

```sh
npm install dsh-connect-trae
```

安装、更新或卸载 bundle 后，需要重启对应的 DSH 进程。

## DSH 版本兼容

**要求 DSH 0.1.7-rc.1 及以上**（2.3.0 起不再支持 0.1.7 之前的宿主；peer 依赖范围已按此收窄）。
**peer 上界为 `<0.3.0-0`：0.1.7 与 0.2 两条线均受支持（含 0.2.1-rc.3，已实测）。**

### 同时支持 pi-ai 的两代上下文（3.4.2 起）

DSH 自己横跨 `@earendil-works/pi-ai` 的两代，而**本插件解析到哪一代由你的安装环境决定**，
未必是宿主那一代——插件声明它是 peer，这是对的，但两代对「上下文长什么样」的定义不同：

| | 旧代（≤0.85） | 新代（0.86+） |
| --- | --- | --- |
| 形状 | `{ systemPrompt, tools, messages }` | `{ messages: [ {role:'system', content, toolsAdded}, … ] }` |
| 系统提示 | 顶层 `systemPrompt` | **只**挂在那条 system 消息上 |
| 工具声明 | 顶层 `tools` | **只**挂在那条 system 消息的 `toolsAdded` 上 |

错配**两个方向都会坏**，所以 3.4.2 起插件会按自己解析到的那一代双向适配（issue #27）：

- **新宿主 + 旧库**：必崩——旧代的 token 估算没有 `role === 'system'` 分支，会去迭代一个字符串并抛
  `Cannot read properties of undefined (reading 'length')`。这一步在请求构造之前，所以表现为
  「任意模型都崩、耗时极短、usage 恒为 0」。
- **旧宿主 + 新库**：不崩，但现代 api 只读那条 system 消息，顶层字段被**静默忽略**——系统提示与
  **全部工具声明**丢失（模型永远不会产生 toolCall）。这类故障更隐蔽，同样已修。

代际判据是**本插件自己解析到的那份包**（读它的 manifest 版本；读不到时看包布局），
**不是宿主版本**——因为嵌套的旧副本会盖过宿主的新副本，反之亦然。启动时日志里会有一行
`dsh-connect-trae: pi-ai <版本> (<代数>)`，`legacy` 表示你这份安装解析到了 ≤0.85 的旧代。

分界线是 **0.86**：`dist/utils/transcript.js`、`normalizeContext`、估算器的 system 分支、
以及「不再读顶层字段」这四件事同时出现在 0.86.0。按 `0.87` 划分会把 0.86.x 误判成旧代而错误折返，
反而丢掉提示与工具。

0.2.0 线对本插件**没有契约破坏**——逐符号核对确认插件消费的 API 全部未变（[完整的 0.2.0-rc.1 影响面核对](https://github.com/dingminhua/dsh-connect-trae/blob/main/docs/DSH_0.2.0_RC1_IMPACT_CHECK.md)）。但 0.1.7 起 DSH 有一道**bundle 级 peer 门禁**：
peer 范围不满足的 bundle 会被**整体跳过**，只往 stderr 写一行，界面上表现为「插件凭空消失」。

### DSH 0.2.1 线（pi-ai 1.1.0）同步结论

宿主 `0.2.1-rc.1` 把 `@earendil-works/pi-ai` 从 `^0.85.1` 抬到了 **`^1.1.0`**（`0.2.1-rc.2` / `0.2.1-rc.3` 均保持不变），这是 0.2 线里
唯一有实际行为影响的变化。三项结论：

1. **请求体没有丢东西（已实测）**。1.1.0 的 api **只**读 transcript 里的 system 消息，
   顶层 `systemPrompt` / `tools` 完全不再读取；而 `dsh-llm-pi-ai` 的 `piContext()` 仍然产出
   旧版信封。本插件 3.4.2 起就有的双向适配正好覆盖这一点——把真实宿主信封喂进真实
   `1.1.0` + 本地 SSE 捕获线上请求体，得到 `roles: ["system","user"]`、system 文本完好、
   `tools: 1`；**去掉适配则变成 `roles: ["user"]`、system `null`、`tools: 0`**（不报错）。
   这条对照已固化为 `tests/pi-ai-context.spec.ts` 的线上请求体矩阵。
2. **类型面补齐**。1.1.0 把 `ProviderStreams` 的第二参改成带 `unique symbol` 品牌标记的
   `TranscriptContext`，只有 `normalizeContext()` 能产出。适配层在这条边界上做一次显式转型
   （`src/adapter.ts` 的 `withContextAdaptation`），并在两处调用点写明为何品牌在此处不可诚实获得。
3. **peer 范围无需改动**。DSH 用 `semver.satisfies(runtime, range, { includePrerelease: true })`
   求值，且只校验 `@deepseek-ai/dsh*` 命名空间，因此 `>=0.1.7-rc.1 <0.3.0-0` 对 `0.2.1-rc.1` / `0.2.1-rc.2` / `0.2.1-rc.3` 均已判通过
   （已实测）。**注意**：预发布悬崖只在**默认选项**下成立——那是 `dsh-connect-workbuddy` 侧
   调研文档所描述的困境，本插件不适用。

开发树的 `@earendil-works/pi-ai` 钉在 **1.1.0**（宿主实际随包的版本，`0.2.1-rc.3` 实测仍是 1.1.0）而非 `^1.1.0`，
使本地 typecheck 与测试跑在与用户完全一致的契约上；`schemastery` 的 override 同步抬到
`3.18.5`（`dsh-llm-pi-ai@0.2.1-rc.3` 声明 `~3.18.5`）。

### `0.2.1-rc.3` 同步结论（4.4.6 起）

宿主推进到 `0.2.1-rc.3`（桌面版 `CFBundleVersion` 与随包 `dsh-desktop-runtime` 同为 `0.2.1-rc.3`）。
上游这一版只落地了 5 个提交，其中 3 个是 UI 的「导航项自定义」（插件化面板的固定/取消固定、
More 菜单、埋点），1 个是 DeepSeek API-key 通道改走官方 `/models` 目录，1 个是版本号。

对**本插件**而言：

- 插件消费的 13 个宿主包里，**只有 `dsh-client-ui-primitives` 有代码变化**，且**全是新增**：
  `Tooltip` 的 `TooltipSide` 增加 `'left'` 并改用实测边框盒做「首选 → 对侧 → 垂直侧」的换边放置，
  `MenuItemButton` 增加 `current`、`Menu` 增加 `minWidthFromAnchor`，图标新增 `IconAppsAddOutline*`。
  本插件对 `dsh-client-ui-primitives` 只有**类型层引用**（`import type {} from ...`），
  运行时不碰这些组件，**无需任何适配**。
- 其余 12 个包（`dsh-llm`、`dsh-llm-pi-ai`、`dsh-settings`、`dsh-host-webserver`、`dsh-atomic-write`、
  `dsh-home-paths`、`dsh-attachment`、`dsh-client-ui-renderer`、`dsh-client-ui-settings`、
  `dsh-client-ui-settings-plugins`、`dsh-client-ui-slots`、`dsh-client-locale`）**逐字节未变**。
- 插件注册的全部槽位（`plugins.bundle.config`、`plugins.row.config`、`conversation.input.left`、
  `conversation.composer.dock`、`conversation.input.model.label`）在 rc.3 中**仍然存在且契约未变**；
  宿主新增的 `conversation.session.header.views.actions` 等槽位与本插件无交集。
- peer 范围**无需改动**：`0.2.1-rc.3` 对 `>=0.1.7-rc.1 <0.3.0-0` 已判通过（已实测）。

细节见 [`docs/DSH_0.2.1_RC1_SYNC.md`](https://github.com/dingminhua/dsh-connect-trae/blob/main/docs/DSH_0.2.1_RC1_SYNC.md) 第十节。


### peer 上界为什么不写 `<0.2.0`

2.3.1 曾写 `<0.2.0-0`，意图是「先不支持 0.2.0 正式版」。这个写法**是错的**：
SemVer 里 `0.2.0-rc.1 < 0.2.0-0`，于是它把**整个 0.2.0 预发布线**也一并排除，
用户装上第一个 0.2.0 预发布版后插件立即整体失效（2.3.1 的实际故障）。

| 写法 | 0.1.7 线 | 0.2.0 alpha/rc | 0.2.0 正式 | 0.3.0 |
| --- | --- | --- | --- | --- |
| `>=0.1.7-rc.1 <0.2.0-0` ❌ | ✅ | ❌ | ❌ | ❌ |
| `>=0.1.7-rc.1 <0.2.0` | ✅ | ✅ | ❌ | ❌ |
| `>=0.1.7-rc.1 <0.3.0-0` ✅ | ✅ | ✅ | ✅ | ❌ |

`tests/dsh-peer-range.spec.ts` 钉住这条不变式：逐条断言每个 peer 范围**必须**放行
0.1.7 与 0.2 两条线、**必须**挡住 0.3 线，并禁止 `<0.2.0-0` 这种写法回归。

> **为什么需要专门的测试**：范围写错时 `tsc` 通过、全部单测通过、`pnpm install` 通过、
> CI 全绿——只有真实宿主会拒绝加载。这正是 2.3.1 一路绿着上线的原因。

0.1.7 把设置体系整体重建，插件按 0.1.7 的契约工作：

- **宿主端注册**：`SettingsForms.configure({auto}, owner)`（0.1.7 起 `installSection` 已删除），命名空间取**宿主实际服务的 Loader 条目 id**（`ctx.fiber.entry?.options.id`，回落到 `trae`）——harness 按精确匹配查找 provider 的命名空间，写死 `trae` 会让 provider 被判「未配置」。
- **客户端设置面**：`configForms`（0.1.7 起 `settingsScope` 已移除）。`inject` 只声明 `slots` / `locale`，设置面用 `ctx.get()` 软探测——Cordis 的依赖闸门是硬闸，`inject` 里任一服务在运行线上不存在，`apply()` 就永远不会执行（这正是 2.2.0 及更早版本在 0.1.7 上卡在 `pending (waiting for service: settingsScope)` 的原因）。
- **配置卡片槽位**：`plugins.bundle.config` / `plugins.row.config`（`settings.plugin.item` 已删除）。
- **schema 可写声明**：可写字段必须标 `volatile()`（`asVolatile`），否则写入被 0.1.7 的写入门直接拒绝；0.1.7 以 `{get(): T}` 活引用交付配置值，所有读取与合并路径都先解包（`unwrapVolatile` / `unwrapVolatileDeep`）。
- **折叠箭头用纯 CSS**，不静态导入任何 primitives 图标——图标命名族随版本变动，静态导入不是稳定契约。

## 平台支持

| 平台 | 状态 | 说明 |
| --- | --- | --- |
| **macOS** | ✅ 完全支持 | 开发与验证环境；目录名均经真机确认 |
| **Windows** | ✅ 支持 | CI 跑 `windows-latest`；账号目录、应用版本头、锁行为均有专门处理。**已在一台真机（Windows 10.0.22621 + TRAE SOLO CN）通过验证**，见下方 |
| **Linux** | ✅ 支持 | 含 WSL2 + Trae CLI 场景（issue #5）；目录名按多候选探测 |

三个平台共享同一套逻辑：账号读取、解密、区域判定、签到与用量查询均与平台无关，平台差异只集中在**路径解析**（`src/paths.ts`）与**设备指纹**（`src/identity.ts`）两处。

## Windows 说明

- **账号数据目录**：插件读取 `%APPDATA%\<目录名>\User\globalStorage\storage.json`（与**安装目录无关**——Electron 系应用的用户数据固定放 `%APPDATA%`，装到 D 盘也一样）。插件会**并列探测**多个目录拼写（`Trae CN` 与 `trae-cn`、`TRAE SOLO CN` 与 `trae-solo-cn`），命中任一即可；Windows 文件名不区分大小写，因此不会重复探测同一目录。
- **应用版本头**：插件从安装目录 `<LOCALAPPDATA>\Programs\<安装目录名>\resources\app\product.json` 读取 `appVersion`（`LOCALAPPDATA` 缺失时回退 `<home>\AppData\Local`），随请求发送 `x-app-version` / `x-ide-version`；读不到时这些头不发送，不影响登录与聊天。
- **设备指纹**：`x-device-type` 发 `windows`，`x-os-version` 为 `Windows <版本>`。机器 ID 取自数据目录的 `telemetry.machineId`（或同目录 `machineid`），该推导在 Windows 上成立。
- **文件锁**：宿主 `dsh-atomic-write` 原生处理 Windows 的独占创建语义（`EPERM` / `EBUSY` 重试），无需插件侧适配。
- **Raw Chat 探测（已知限制）**：`model-cache` 依赖 `sqlite3` 命令行，Windows 默认未安装，该探测会失败并**安全回退**。Raw Chat 默认关闭，不影响主流程。
- **权限位**：写凭据副本时传 `mode: 0o600` / `dirMode: 0o700`，Windows 忽略 POSIX 权限位——不报错，属已知且无害。

### 真机验证结果（2026-09-26，Windows 10.0.22621 + TRAE SOLO CN）

`node scripts/verify-windows.mjs` 实测**全部通过**（退出码 0）：

| 检查项 | 实测结果 |
| --- | --- |
| 目录探测 | 命中 `%APPDATA%\TRAE SOLO CN\User\globalStorage\storage.json`（其余候选为 missing） |
| 账号解析 | 解出 1 个账号，`solo` / `cn` 区域 |
| `x-device-type` | `windows` ✅ |
| `x-os-version` | `Windows 10.0.22621` ✅ |
| `x-device-id` | 16 位纯数字（来自数据目录，非兜底哈希）✅ |
| `x-app-version` | `0.1.56`，取自 `%LOCALAPPDATA%\Programs\TRAE SOLO CN\resources\app\product.json` ✅ |

**这确认了什么**：`win32DirName` 作依据是**正确**的——`TRAE SOLO CN` 这个拼写确实是 Windows 真机上的实际目录名，且 `product.json` 的安装路径推导与设备指纹各字段都成立。即「Windows 上插件读得到 Trae 登录」已由真机证据支持，不再是推断。

#### 脚本之外的运行路径（同一台真机，2026-09-26）

上表四项只覆盖**路径探测与设备指纹**，不等于「整个插件在 Windows 上跑得通」。因此另外单独实测了插件的主流程（直接调用 `lib/` 的导出，即产品代码本身）：

| 运行路径 | 实测结果 |
| --- | --- |
| `TraeCredentialStore.resolve()` | ✅ 返回凭据，host `https://api.trae.cn`，token 有效期正常解析 |
| `identityHeaders()` 全部请求头 | ✅ 10 个头全部生成（`x-device-id` / `x-machine-id` / `x-device-cpu` / `x-ide-version-code` 等） |
| 用量查询（只读，不消耗积分） | ✅ 拿到 9 个积分包，总额 2050 / 已用 1522.85 |
| 模型目录拉取（只读） | ✅ 拉到 **42 个模型** |
| 原子写 `writeFileAtomic` | ✅ 写入 + 回读一致 |
| 并发文件锁 `withFileLock` | ✅ 8 个并发写串行化正确，**无丢失更新**（Windows 独占创建语义由宿主处理，验证成立） |
| `SSE` 解码 | ✅ 代码按 `\r?\n` 切分，CRLF 与分块均支持 |

也就是说：登录、身份、用量、模型目录、并发写入这些**主流程在 Windows 上均实测可用**。

> **已知限制（本机实测确认其行为）**：`model-cache` 依赖 `sqlite3` 命令行，本机未安装，实测抛 `ENOENT`（`spawn sqlite3 ENOENT`），调用方 `.catch(() => undefined)` 正确兜底——**不影响主流程**，Raw Chat 默认关闭。
>
> **该模块的目录拼写缺口已修复**（同轮发现并修掉）：它原先把 `state.vscdb` 路径**硬编码为 `Trae CN` 单一拼写**，而 `paths.ts` 是多候选，且它自己重算了一遍目录而没复用 `traeStorageCandidates`。在本机（真实目录名为 `TRAE SOLO CN`）上，旧代码指向的 `...\Trae CN\...\state.vscdb` **根本不存在**；只因 `sqlite3` 缺失、该调用必然失败并兜底，才把一个**错误的路径**藏在了另一个看似合理的错误（依赖缺失）后面。
>
> 修法是让缓存路径**从凭据路径推导**——`state.vscdb` 与 `storage.json` 同在 `globalStorage`，因而同一个候选目录既管登录也管缓存；`raw-resolver` 现在把命中的候选传下去，多版本共存时不会读到另一个安装的模型表。真机复测：新代码正确选中 `%APPDATA%\TRAE SOLO CN\User\globalStorage\state.vscdb`（存在），旧代码只找 `Trae CN`（不存在）。

> **仍然未验证的部分**：本机只装了 TRAE SOLO CN，因此 `Trae CN` / `trae-cn` 这两个拼写**仍未经真机确认**——但它们在此机器上不存在只反映「本机没装这个版本」，不代表拼写有误。装了 Trae 中国版的 Windows 用户仍欢迎跑一次上面的命令回报。

> **安装 Trae 中国版或别的情形？一条命令即可回报**：`node scripts/verify-windows.mjs` —— 它用插件自身的构建产物列出在这台机器上探测的每条路径、能否解出账号、以及设备指纹，输出**已脱敏**（用户名替换为 `<user>`，账号名与设备号只给长度），可直接贴进 issue。**完整的验证步骤与结论判读见 [`docs/WINDOWS_VERIFY_GUIDE.md`](https://github.com/dingminhua/dsh-connect-trae/blob/main/docs/WINDOWS_VERIFY_GUIDE.md)**；手工逐步排查见 [`docs/WINDOWS_TOKEN_PROBE.md`](https://github.com/dingminhua/dsh-connect-trae/blob/main/docs/WINDOWS_TOKEN_PROBE.md)（**只要目录名与 key 名，不要 token**）。若目录名仍对不上，可用 `authFile` + `edition` 直接指定完整路径救急。

## 开发

```sh
pnpm install
pnpm run check   # typecheck + test + build
```

本地开发用 `link:` 安装到 desktop profile（改码后重启 DSH Desktop 生效）：

```sh
dsh plugin --profile desktop add /path/to/dsh-connect-trae
```

## 致谢

- [Wang-JQ77/dsh-trae-api](https://github.com/Wang-JQ77/dsh-trae-api)（MIT）— Trae 认证、会话和模型协议研究的参照实现。

## 第三方开源依赖

本项目参考的与 Trae 接入直接相关的开源项目，以及它们的许可证与合规说明，见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。引入新的 Trae 相关外部依赖或复用其他项目代码时，请同步更新该文件并遵守对应许可证要求。

## 许可证

本项目采用 [MIT](LICENSE) 许可证，版权归属：**Copyright (c) 2026 LaoDing**。
