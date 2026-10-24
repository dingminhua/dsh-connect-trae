# 发布流程（Release Flow）

> 本文档是 `dsh-connect-trae` 的**唯一权威发布流程**。发布前请通读一遍。
>
> 九个步骤：① 确认代码/测试/版权 → ② 改版本号 → ③ CHANGELOG 定稿日期 → ④ 提交 + 打 tag + 推送
> → ⑤ `npm publish` → ⑥ 2FA → ⑦ 验证发布成功 → ⑧ 发布后一致性核验 → ⑨ 创建 GitHub Release。
> **⑤ 之后每一步都别省**：⑦⑧ 决定「是否真的发出去了、发的是不是这份源码」，⑨ 是用户在 GitHub 上
> 能看到的那份发布说明。
>
> 🤖 **由 AI 助手代跑发布时，请先读 [`docs/RELEASE_EXPERIENCE.md`](docs/RELEASE_EXPERIENCE.md) 第 6 节**
> （「给 AI 助手发布时的备忘」）：记录了沙箱如何伪装成环境故障、为什么**不能用 tarball 能否下载**
> 判断发布成败（2.0.5 曾因此差点误报失败）、npm 日志会被自己后续命令冲掉等实操坑。
> **补充（2.4.0 实录）**：凭据类错误（EOTP / 非交互 OTP）可能出现在**上传完成之后**，
> 同样会造成「明明发出去了却被判为失败」——判据一律回到 registry，见第 7 步。

## 前置条件

- npm 已登录：`npm whoami` 应显示 `dmh2002`（若报 `need auth`，先 `npm login`）。
- 账号若开启 2FA（两步验证）：`npm publish` 时需**在浏览器确认一步**。
- GitHub 仓库：`https://github.com/dingminhua/dsh-connect-trae`（默认分支 `main`）。
- 网络：本机已配置代理 `127.0.0.1:7897`（git 与 npm 均已配置；若在其他机器发布，直连即可）。

## 每次发布的完整步骤

### 1. 确认代码、测试与版权

```bash
cd /Users/dmh2002/DshProject/dsh-connect-trae
pnpm run check        # typecheck + test + build，应全部通过
grep -F "Copyright (c) 2026 LaoDing" LICENSE
```

> 本项目以 MIT 许可证发布，版权归属必须保持为 **LaoDing**；发布前不得把 LICENSE 中的版权主体改成 npm 账号、GitHub 账号或其他名称。

### 2. 更新版本号

手动改 `package.json` 的 `version` 字段。

> 后续步骤以目标版本号 `X.Y.Z` 指代。

### 3. 更新 CHANGELOG.md 并定稿日期

在 `CHANGELOG.md` 顶部新增一节 `## X.Y.Z (YYYY-MM-DD)`，按 `Features` / `Fixes` / `Docs` 分组记录本次变更。

> ⚠️ **标题里的日期必须在打 tag 之前就填成实际发布日期**，不要留 `## X.Y.Z (unreleased)` 之类的占位——`CHANGELOG.md` 会随包发布到 npm，占位标题会原样进入用户可见的发布包。

> 📌 **先看 `docs/PENDING_CHANGELOG.md`。** 上一个版本发布之后积压的变更条目暂存
> 在那里（因为 `CHANGELOG.md` 是随包文件，在已发布的 tag 之后改它会让
> `verify:release` 正确地报「tag 之后改动了发布内容」）。发版时把它的内容并进
> `CHANGELOG.md` 的 `## X.Y.Z` 一节，然后删除该文件。没有这个文件就说明没有积压。


### 4. 提交并打 git tag

**版本号、CHANGELOG 日期定稿、README 必须合并到同一个提交**，tag 指向该提交：

```bash
git add package.json CHANGELOG.md README.md README.en.md
git commit -m "chore: 版本升级至 X.Y.Z"
git tag -a vX.Y.Z -m "vX.Y.Z: <一句话说明>"
git push origin main
git push origin vX.Y.Z
```

> ⚠️ **不要把 CHANGELOG 日期定稿单独再提一个提交**（例如先提交 `版本升级至 X.Y.Z`、再补一个 `CHANGELOG 发布日期定稿`）。那样 tag 会指向一个只改了一行的提交，发布记录与「版本升级」提交脱节，回溯时看不出该版本包含哪些代码变更。正确做法是在提交**之前**就把日期写好，一次提交完成。
>
> 若确实已经漏改：**只要 tag 已推送或包已发布，就不要再移动 tag**（已发布版本对应的 tag 是不可变的历史锚点），把日期留给下一个版本修正；仅当包尚未发布、tag 也尚未推送时，才可以用 `git commit --amend` 合并后重新打 tag。

> ⚠️ **tag 必须指向包含本次代码的提交**。若目标 tag 已存在且指向旧提交，需先删除并强制移动，修正后用 `git rev-list -n1 vX.Y.Z` 确认指向当前 HEAD。

### 5. 发布到 npm

```bash
npm publish
```

**打包内容**：`package.json` 的 `files` 字段已限定只发布 `lib/`、`docs/assets/dsh-connect-trae-usage-card.png`、`scripts/verify-windows.mjs`、`screenshots.json`、`cordis.patch.yml`、`README.md`、`README.en.md`、`CHANGELOG.md`、`THIRD_PARTY_NOTICES.md`、`LICENSE`，`tests/` 和 `node_modules/` 不会进入发布包。

> `scripts/verify-windows.mjs` 是有意随包分发的：README 指引 Windows 用户运行它做真机验证，不随包则 npm 用户无法执行该步骤。它是自包含的单文件，只依赖 `lib/` 的导出。
> 注意 `docs/*.md`（含 `WINDOWS_TOKEN_PROBE.md`）**不进包**，因此 README 中引用它们的链接必须用 GitHub 绝对地址，否则在 npm 页面会 404。

**发布前检查**（可选但推荐）：

```bash
npm pack --dry-run
```

### 6. 2FA 确认（若账号开启两步验证）

`npm publish` 若提示 EOTP，按 npm CLI 给出的 URL 在浏览器登录确认即可，终端内的 `npm publish` 会自动继续。

> ⚠️ **2FA 报错不一定代表「没发出去」。** 见第 7 步——发布是否成功，**只能以 registry 的实际状态为准**，
> 不能以 `npm publish` 的退出信息为准。

### 7. 验证发布成功

```bash
npm view dsh-connect-trae version            # 应显示 X.Y.Z
npm view dsh-connect-trae dist-tags.latest   # 应为 X.Y.Z
```

> 刚发布后 registry 读缓存可能有短暂延迟，稍等重查即可。

> ⚠️ **「还没显示」不等于「没发出去」，但也要分得清是哪种。** 先看 `~/.npm/_logs` 里那次 publish 的日志：
> 有 `PUT 202` + "Your package is being processed" = registry 已受理，等几分钟（2.5.0 实测约 90 秒
> dist-tags 翻转）；**连 `PUT` 行都没有** = 请求未到达 registry（npm 11 的 web-auth 把 2FA 挑战放在
> PUT 之前，非交互会话会在此被拦），这才是真失败，需在交互终端执行。完整三态判别表见
> `docs/RELEASE_EXPERIENCE.md` 6.9。

> ⚠️ **发布失败时先查 registry，别先看错误信息。** 2.4.0 发布当天，`pnpm publish` 报了
> `ERR_PNPM_OTP_NON_INTERACTIVE`，据此判为「没发出去」——**判错了**：包在报这条错误之前就已上传完成
> （`registry.time` 与报错同一分钟），线上 `latest` 早已是 2.4.0。随后手动 `npm publish` 只得到
> `E409 You cannot publish over the previously published versions`，这才暴露真相。
>
> **判据**：`npm view dsh-connect-trae versions` 里出现了 `X.Y.Z`，就是发布成功——无论终端里报了什么。
> 反向也成立：只有 registry 上没有该版本，才算失败。凭据类错误（EOTP / E401 / 非交互 OTP）尤其容易
> 出现在上传**之后**的响应处理阶段，不能当作否定证据。

### 8. 发布后一致性核验（推荐）

确认「npm 上的包」确实等于「tag 指向的源码」——防止发布时工作树里有未提交改动、或包构建自别的提交：

```bash
pnpm run verify:release          # 核验 package.json 里的当前版本
pnpm run verify:release -- 3.7.0 # 核验指定版本（复查旧 tag 时用）
```

脚本（`scripts/verify-release.mjs`）一次做完四件事，共 20 项检查：

1. **tag 指向 HEAD**，并报告工作树是否干净；
2. **registry 上确有该版本**，且 `latest` 指向它；
3. **发布包里的每一个文件**都与 `git show vX.Y.Z:<path>` 逐字节比对——
   遍历**全部**文件而不是一份手工清单，因此新增的随包文件自动纳入；
4. 对 `lib/`（构建产物，未纳入 git）**由 tag 源码重建后**比对。

> 第 4 步的重建在**临时 worktree** 里做，**不碰工作树**。这不是洁癖：开发者常态是把
> bundle 以软链装进 profile，运行中的 DSH 宿主服务的正是本仓库 `lib/` 的字节，在这里
> 重建等于当着活着的宿主改写它正在服务的客户端 bundle——2026-10-24 14:40 这么干过，
> 渲染进程连崩三次（`EXC_BREAKPOINT`/`SIGTRAP`），最后要人工重启应用。细节与对策见
> [`DEVELOPMENT.md`](DEVELOPMENT.md)「危险动作：不要在宿主运行时重建 `lib/`」。

退出码即结论：`0` = 全部一致；`1` = 有不一致；`2` = 前置条件不满足（tag 不存在、
registry 上查无此版本）——**`2` 不是「发不出去」，是「还查不了」**，两者不要混为一谈。

> 本脚本**不进发布包**（`package.json` 的 `files` 不含 `scripts/verify-release.mjs`）：
> 它核验的是本仓库的 tag 与 git 历史，对 npm 用户没有意义。相反的，
> `scripts/verify-windows.mjs` 是**有意**随包分发的，供 Windows 用户做真机验证。

<details>
<summary>手工等价步骤（脚本不可用时）</summary>

```bash
# 1) 拉下已发布的包并解开
cd /tmp && rm -rf verify && mkdir verify && cd verify
npm pack dsh-connect-trae@X.Y.Z && tar -xzf dsh-connect-trae-X.Y.Z.tgz

# 2) 逐文件与 tagged 提交对比（仓库目录内执行）
cd /Users/dmh2002/DshProject/dsh-connect-trae
for f in CHANGELOG.md README.md README.en.md LICENSE THIRD_PARTY_NOTICES.md \
         cordis.patch.yml package.json screenshots.json; do
  a=$(shasum -a 256 "/tmp/verify/package/$f" | cut -d' ' -f1)
  b=$(git show vX.Y.Z:"$f" | shasum -a 256 | cut -d' ' -f1)
  [ "$a" = "$b" ] && echo "  ✓ $f" || echo "  ✗ $f"
done

# 3) lib/ 是构建产物（未纳入 git），改为「由 tagged 源码重建后比对」
pnpm run build
for f in lib/index.js lib/index.d.ts lib/client.js; do
  a=$(shasum -a 256 "/tmp/verify/package/$f" | cut -d' ' -f1)
  b=$(shasum -a 256 "$f" | cut -d' ' -f1)
  [ "$a" = "$b" ] && echo "  ✓ $f" || echo "  ✗ $f"
done
```

全部 `✓` 即发布链自洽（本仓库构建为确定性构建，同一源码重复构建产出相同文件）。

> 手工版本有两个已知盲点，脚本已闭合：清单只写了 8 个文件，而发布包有 15 个
> （`icons/`、`docs/assets/`、`scripts/verify-windows.mjs` 从未被核对过）；
> 以及 `git show` 默认按 UTF-8 解码，直接把 PNG 当文本会得到假的不一致。
</details>


### 9. 创建 GitHub Release

**每个发布版本都要有对应的 Release**（v2.0.6 起一直如此）。tag 只是 git 里的锚点，Release 才是用户在
GitHub 上能看到的发布说明，也是仓库首页右侧的版本入口。

在 <https://github.com/dingminhua/dsh-connect-trae/releases/new> 填写：

| 字段 | 填什么 |
| --- | --- |
| **Choose a tag** | 选 `vX.Y.Z`（第 4 步已推送） |
| **Release title** | `vX.Y.Z` |
| **Describe this release** | 见下方正文来源 |
| **draft / prerelease** | **都不勾**（与历史 Release 一致） |
| **附件** | 不加（历史 Release 均为 0 附件；包在 npm） |

**正文来源**：优先复用 `CHANGELOG.md` 的 `## X.Y.Z` 一节，改写成面向用户的措辞（可参考
`docs/RELEASE_NOTES_v2.4.0.md` 的写法：开头一段说明「这个版本修了什么」，再分新增/修复/测试，
末尾附 `v上一个版本...vX.Y.Z` 比较链接）。**正文必须与 CHANGELOG 的事实一致**，只是详略与语气不同。

> ⚠️ **Release 在 tag 之后创建，不要在之前。** Release 需要一个已存在的 tag（或由它顺带创建，
> 那就绕过了第 4 步「tag 指向版本提交」的约束）。先推 tag、再建 Release，两个锚点才指向同一提交。

> ⚠️ **Release 正文里的版本号、测试数、模型名单等数字要核对，不要凭印象写。** 例如「全仓 N 例测试」
> 取自 `pnpm run test` 的实际输出；README 里被移除的模型名要与当次实际生效的目录一致。

> **tag 之后若还有提交**（例如发布后补的文档、CI 修复），tag **不需要**跟着移动——只要那些提交
> 不影响发布产物即可（`docs/*.md` 不进包、`pnpm-workspace.yaml` 只影响本地与 CI 安装）。已推送的
> tag 是历史锚点，见第 4 步的说明。创建 Release 前用下面这条确认 tag 指向的树确实是待发布版本：
>
> ```bash
> git show vX.Y.Z:package.json | grep '"version"'   # 应显示 X.Y.Z
> git diff --stat vX.Y.Z HEAD                        # 应只有不影响发布产物的文件
> ```

## 常见问题

- **`npm publish` 报 EOTP**：账号开启了 2FA，按第 6 步在浏览器确认，不要绕过。**但先按第 7 步查一次
  registry**——2.4.0 当天 EOTP 出现在上传完成之后，包实际已经发布出去了。
- **`npm publish` 报 E409 `Cannot publish over previously published versions`**：该版本号在 registry 上已存在。
  **先按第 7 步确认它是否已实际发布**——若是，说明包已经发出去了，**无需重发**（2.4.0 就是这样：
  误判为「未发布」后重跑，只得到 E409，而线上 `latest` 早已是该版本，且两次的 shasum 完全一致）。
  仅当确认它确实未发布、又无法复用编号时，才按第 2 步顺延到下一个版本号
  （参考 1.4.1→1.4.2 的编号顺延记录）。
- **忘了把 CHANGELOG 的标题日期定稿**：见第 4 步的说明——tag 已推送或包已发布时不要移动 tag，留给下个版本修正。
- **发布后 `npm view ... version` 还是旧版本**：registry 缓存延迟，稍等重查 `npm view ... versions`。
- **本地开发与发布的关系**：本地开发用 `link:` 安装，与 npm 发布互不影响；npm 发布的包是 `lib/`、README 等静态文件，同一份源码。
