# DSH 插件发布经验备忘（复用自 dsh-subagent-default-model）

> 本文档把团队已验证项目 `dsh-subagent-default-model` 的发布与插件工程经验浓缩成可复用备忘，
> 供 `dsh-connect-trae` 及后续 DSH 插件项目同步。
> 权威发布流程仍以本仓库根目录 [`RELEASING.md`](../RELEASING.md) 为准；本文档是「为什么这么做 + 别踩的坑 + 环境配置」。

## 1. 本机 git / npm 环境配置（一次性，首次发布前确认）

> ⚠️ 这些是发布提交/打 tag 时依赖的环境配置，属于「手动填写一次」的项。换新机器或新项目时先核对。

### 1.1 git 提交署名（user.name / user.email）

发布流程里的 `git commit` / `git tag` 会带上提交作者，GitHub 上显示的名称和邮箱来自这里。

```bash
git config --global user.name  "LaoDing"
git config --global user.email "shangxinyu2002@gmail.com"
```

- **必须与 LICENSE 版权归属一致**：本项目 LICENSE 版权为 `Copyright (c) 2026 LaoDing`，提交署名 `LaoDing` 与之一致，不要改成 npm 账号或其它名称。
- 若某仓库想用不同署名，可在该仓库内 `git config user.name/email` 设置 local 级；否则默认继承全局。

### 1.2 git 代理（访问 GitHub 用）

本机访问 GitHub 走本地代理 `127.0.0.1:7897`：

```bash
git config --global http.https://github.com.proxy http://127.0.0.1:7897
```

- npm 侧同理（`~/.npmrc` 配置了代理），`npm publish` / `npm install` 才能访问 npm registry。
- 在其它机器发布且能直连时，无需代理配置。

### 1.3 npm 登录

```bash
npm whoami   # 应显示 dmh2002；若报 need auth，先 npm login
```

### 1.4 一键核对清单

```bash
git config --global user.name
git config --global user.email
git config --global --get http.https://github.com.proxy
npm whoami
```

四项输出应分别为：`LaoDing`、`shangxinyu2002@gmail.com`、`http://127.0.0.1:7897`、`dmh2002`。

## 2. 发布流程要点（速查）

完整步骤见根目录 `RELEASING.md`，此处只列关键纪律：

1. **发布前**：跑完整检查（本项目 `pnpm run check`：typecheck + test + build）；核对 LICENSE 版权仍是 `Copyright (c) 2026 LaoDing`。
2. **版本号**：只改 `package.json` 的 `version`；CHANGELOG 顶部新增 `## X.Y.Z (YYYY-MM-DD)`，按 Features / Fixes / Docs 分组。
3. **tag 纪律**：`git tag -a vX.Y.Z -m "..."` 必须是 **annotated tag**；tag 必须指向包含本次代码的提交。
   - 若误打 tag 指向旧提交：`git tag -d vX.Y.Z` → 重打 → `git push -f origin vX.Y.Z`，再用 `git rev-list -n1 vX.Y.Z` 确认指向 HEAD。
4. **打包白名单**：`package.json` 的 `files` 字段已限定发布内容（`lib/`、`cordis.patch.yml`、README 双语、CHANGELOG、THIRD_PARTY_NOTICES、LICENSE、截图等）；`npm pack --dry-run` 核对无秘密、无测试垃圾、无本地路径。
5. **npm publish 与 2FA**：账号开 2FA 时 `npm publish` 会报 `EOTP` 并给出浏览器 URL，打开确认即可；不要绕过 2FA。
6. **发布后验证**：`npm view dsh-connect-trae version` 与 `dist-tags.latest`；刚发布后 registry 读缓存有短暂延迟，稍等重查。
7. **权限边界**：commit / tag / push / npm publish / 市场提交，都必须在用户明确确认后执行。

## 3. DSH 插件工程红线（来自 dsh-subagent-default-model 踩坑总结）

这些红线是 DSH 插件能否被正确识别、设置行能否出现、更新能否生效的关键：

1. **`package.json` 必须暴露 `./package.json`**（exports 里要有 `"./package.json": "./package.json"`）→ 否则 dsh-client-modules 扫描会跳过该插件，设置行不出现。
2. **客户端 `inject` 必须包含所需服务**（settings 行激活必需 `connection`、`slots`；本项目还注入 `locale`、`settingsScope`、`remote` 等）→ 少了则设置卡片不渲染。
3. **设置 namespace 无需白名单**：DSH 0.1.1-rc.2 起 `dsh-host-apiproxy` 已移除 `WEB_SETTINGS_NAMESPACES` 白名单，`settings.describe` 直接返回全部已注册 namespace → 无需任何 patch。
4. **首次注册只做一次**：`dsh plugin --profile desktop add /路径` 以 `link:` 安装，重复注册会重装依赖树 → 不要重复执行。
5. **更新后必须重启 DSH 进程**：bundle patch 与 host/client 半边在启动时加载 → 改代码 / 装新版本后重启 DSH Desktop（⌘Q → 重开）才生效；仅改 settings.yaml 是热加载，无需重启。
6. **本地开发用 `link:`，不重装依赖树**：`dsh plugin --profile desktop add /Users/dmh2002/DshProject/dsh-connect-trae`，node_modules 里是源码软链，改码后重启生效；不要在 desktop profile 里手动跑 `pnpm install` 重装整树。
7. **cordis.patch.yml 只做最小插入**：注册插件 id 即可，如本项目 `- insert: - id: dsh-connect-trae / name: dsh-connect-trae`，不改 profile 默认模型。
8. **license / copyright 字段**：`package.json` 的 `license: "MIT"`、`copyright: "Copyright (c) 2026 LaoDing"` 与根 LICENSE 三者保持一致；README「许可证」章节应写全（协议 + 版权归属 + 概要 + 指向 LICENSE），不要只留一行 `[MIT](LICENSE)`。

## 4. 发布后验证（DSH 侧）

- 在干净 profile 从 npm 安装：`dsh plugin --profile desktop add dsh-connect-trae`（或 `cd ~/.dsh/profiles/desktop && npm install dsh-connect-trae`），重启 DSH Desktop。
- 确认：设置 → 插件配置 → DSH Connect Trae 卡片出现、provider 注册（模型选择器出现 Trae 模型）、短流式对话可用、用量概览只读可读。

## 5. 常见问题

| 问题 | 原因 | 解决 |
| --- | --- | --- |
| 设置卡片不出现 | 插件未装入 profile / 未重启 / exports 缺 `./package.json` | `dsh plugin --profile desktop add` 后重启 DSH Desktop；核对 exports |
| 保存按钮灰色 | 必填字段未填全 | 填满所有必填路由字段 |
| `npm publish` 报 EOTP | 账号开启 2FA | 按 npm CLI 给的 URL 在浏览器确认 |
| 发布后 `npm view` 还是旧版本 | registry 读缓存延迟 | 稍等重查 `npm view ... versions` |
| 子代理 / provider 用父模型 | provider 或 model 缺失 | 确保 provider 和 model 都填写 |

## 6. 给 AI 助手发布时的备忘（2026-09-22 发布 2.0.5 实录）

> 上面几节假定执行者是**人**，能自己看终端、自己判断。本节专门记录**AI 助手代跑发布流程**时踩的坑。
> 每条都来自 2.0.5 发布当天的真实过程，含一次差点误报的假故障。

### 6.1 最危险的一条：**别用 tarball 能不能下载来判断「发布成功没有」**

**2.0.5 发布当天，我（AI）差点向用户报告「发布失败」。**

事实经过：`npm publish` 日志里明确写着 `PUT 202` + `Your package is being processed and
may take a few minutes to become available` + `exit 0`——**这是成功**。但我随后去查：

```
GET /dsh-connect-trae            → latest 仍是 2.0.4
GET /dsh-connect-trae/2.0.5      → 404
GET /dsh-connect-trae/-/....tgz  → 404（返回 21 字节的 {"error":"Not found"}）
```

于是我做了个「对照实验」：**2.0.4 的 tarball 能下载（283956 字节），2.0.5 不能** →
据此判定「老版本可取、新版本不可取，说明确实异常」。

**这个对照实验看起来严谨，其实无效。** 因为 2.0.4 已经发布数天、CDN 早已铺满；
2.0.5 刚发布几十秒，`latest` 元数据与 tarball 二进制的传播速度**不同步**。
两条记录处于不同传播阶段，本就不可比。

**事后回看，2.0.5 的发布从头到尾都是健康的**：等传播完成后复核，
线上 tarball 的 shasum 是 `51bc1815d171424906cac8e0ea438c48913d0b1f`，
与 `npm publish` 日志打印的 shasum 完全一致；12 个文件与 `v2.0.5` tag 逐文件哈希全等。
**换句话说，那次「失败」完全是我这套判据造出来的假象。**

**正确做法（按可靠性排序）：**

1. **`npm install` 装一次** —— 最权威。能装上就是发布成功：
   ```bash
   cd /tmp && rm -rf pubcheck && mkdir pubcheck && cd pubcheck
   echo '{"name":"t","version":"1.0.0"}' > package.json
   npm install dsh-connect-trae@X.Y.Z
   ```
2. **比对已发布 tarball 的 shasum 与 `npm publish` 日志里打印的 shasum** —— 完全相等即成功、
   且证明包内容就是本次构建。取回方式：
   ```bash
   curl -sL -o d.tgz https://registry.npmjs.org/dsh-connect-trae/-/dsh-connect-trae-X.Y.Z.tgz
   shasum d.tgz     # 应与 publish 日志 "shasum:" 一行完全一致
   ```
   > ⚠️ **`npm` 只保留最近 10 份日志（`logs-max:10`），且每跑一条 `npm` 命令就轮转一次。**
   > 2.0.5 当天，我因为反复跑 `npm view` / `npm pack` 排查，把**那份 publish 日志冲掉了**，
   > 事后无法再引用其中的 shasum。**要留证据就趁早**——`npm publish` 刚结束、还没跑别的 npm 命令时：
   > ```bash
   > # npm publish 的日志文件名会打印在它自己的输出里；也可以直接取最新的一份
   > ls -t ~/.npm/_logs/*.log | head -1
   > grep -E "shasum:|integrity:|version:" "$(ls -t ~/.npm/_logs/*.log | head -1)"
   > # 想长期留证就复制出来（放在仓库外，别提交进 git）
   > cp "$(ls -t ~/.npm/_logs/*.log | head -1)" /tmp/publish-<版本>.log
   > ```
   > 即便日志已丢，第 1、3 条判据仍然可用，不必依赖它。
3. **只看元数据**（`dist-tags.latest`、`versions` 里有该版本、`gitHead` 等于 tag 指向的提交）——
   可以判断，但**必须等够时间**。实测 2.0.5 从 `publish` 到三条路径全部一致约需 **数分钟**。
4. ❌ **不要**用「tarball 能否下载」或「mirror 上有没有」下结论。npmmirror 等镜像滞后更久。

> 若确实需要判断「等多久算异常」：先 `sleep` 重试 3–4 次、间隔 20s 以上；
> 仍不一致时**报「尚未传播完成，需再等」，而不是报「失败」**。这两者对用户的含义完全不同。

### 6.2 沙箱会伪装成「环境坏了」

`~/.npm` 的读写权限、`git push` 的网络，都可能被 DSH 的文件/网络沙箱拦住，
而报错形态**很像本机环境坏了**：

| 现象 | 真实原因 | 判别方法 |
| --- | --- | --- |
| `npm whoami` 报 `EPERM`，指向 `~/.npm/_cacache` 或 `~/.npm/_logs`，甚至提示 `sudo chown` | **是沙箱**，不是权限损坏 | 沙箱放宽后同一命令立刻正常（实测：`workspace-write` 下失败，`danger-full-access` 下 `npm whoami` → `dmh2002`） |
| `pnpm run check` 报 `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY` | **是沙箱**：pnpm 的依赖状态检查想清空并重装 `node_modules`，无 TTY 时中止 | 放宽后 `pnpm run check` 正常 `exit 0`（实测） |

**结论**：遇到这些报错**不要**去改 `~/.npm` 权限、**不要**删 `node_modules` 重装。
先判断是不是沙箱；若无法放宽，就绕过：

```bash
# pnpm run check 的等价替代（不触发 pnpm 的依赖检查，风险最低）
./node_modules/.bin/tsc -p tsconfig.json && ./node_modules/.bin/tsc -p tsconfig.client.json
./node_modules/.bin/vitest run
./node_modules/.bin/tsdown
```

### 6.3 macOS 原生没有 `timeout`

给命令加超时保护时，`timeout 45 git fetch` 会直接 `bash: timeout: command not found`。
改用 `gtimeout`（需 coreutils）或干脆不加超时，用工具的 `timeoutMs` 参数控制。

### 6.4 CHANGELOG 日期：用**本机实际日期**，别抄 issue 时间

`RELEASING.md` 要求 `## X.Y.Z (YYYY-MM-DD)` 是**实际发布日**，且必须在打 tag 前定稿。
我在 2.0.5 时把日期误填成 issue #10 的创建时间 `2026-09-21`——那是 **UTC** 时间戳，
而本机是 CST，实际是 `2026-09-22`。

**发布前先跑 `date` 看本机日期**，不要从 issue / commit / 日志里的时间戳去推断。
（若已推送 tag 或已发布，**不要再移动 tag**，留给下个版本修正。）

### 6.5 发布前自检：确认新增测试真的在跑

「加了 4 个测试，但总数没变」是很容易被忽略的信号。2.0.5 时 `pnpm run check` 前后都报 240，
我没有放过它，而是用基线对拍确认：

```bash
git stash push -q src/ tests/                       # 暂存改动
./node_modules/.bin/vitest run | grep -E "Tests +[0-9]"   # 基线：236
git stash pop -q                                    # 恢复
./node_modules/.bin/vitest run | grep -E "Tests +[0-9]"   # 现在：240  ✓ 净增 4
```

也可用 `--reporter=verbose` 直接看到新用例名。**别假设「跑绿了」就等于「新测试跑到了」。**

### 6.6 索引/验证的通用纪律

- **推送前**先 `git fetch` 并核对领先关系，避免非快进：
  ```bash
  git rev-list --left-right --count HEAD...origin/main   # 期望 "<n> 0"
  ```
- **annotated tag 的哈希 != 提交哈希**：`git ls-remote --tags` 显示的是 tag 对象自身哈希
  （实测本地 `0e3ebc01` / 远端列出 `49047d73`），它**不是**异常。
  确认指向用 `git rev-list -n1 vX.Y.Z`，应等于 `git rev-parse HEAD`。
- **新增文件先查是否被忽略**：`git check-ignore -q <path>`（本项目 `.gitignore` 含 `lib/`，
  所以 `lib/` 是构建产物、不进 git，但**会**进 npm 包——两者白名单不同，别混淆）。
- **发布包内容比对**要**比文件哈希**，不要比 tarball 的整体 shasum：
  我自己重新 `npm pack` 出来的 shasum 与线上不同（gzip 时间戳/元数据归一化所致），
  但逐文件哈希一致。以**线上 tarball 的 shasum 等于 publish 日志记录的 shasum** 为准。

### 6.7 权限与确认边界（不可省略）

`RELEASING.md` 第 7 条已写明：**commit / tag / push / npm publish 都必须在用户明确确认后执行**。
实践中建议这样分工并**先说清**：

- AI 负责：跑检查、改版本号、写 CHANGELOG、commit、打 tag、push、核验发布结果；
- 用户负责：`npm login` 与 `npm publish`（涉及 2FA 浏览器确认，且凭据不应交给 AI）；
- **不要**代替用户执行 `npm login` / 改 `~/.npmrc` / 处理凭据。

---

*本文档为经验备忘，来源：`dsh-subagent-default-model`（本机 `../dsh-subagent-default-model`，GitHub `dingminhua/dsh-subagent-default-model`）。新增经验请继续追加，保持与根目录 `RELEASING.md` 的权威流程一致。*
