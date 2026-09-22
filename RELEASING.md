# 发布流程（Release Flow）

> 本文档是 `dsh-connect-trae` 的**唯一权威发布流程**。发布前请通读一遍。
>
> 🤖 **由 AI 助手代跑发布时，请先读 [`docs/RELEASE_EXPERIENCE.md`](docs/RELEASE_EXPERIENCE.md) 第 6 节**
> （「给 AI 助手发布时的备忘」）：记录了沙箱如何伪装成环境故障、为什么**不能用 tarball 能否下载**
> 判断发布成败（2.0.5 曾因此差点误报失败）、npm 日志会被自己后续命令冲掉等实操坑。

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

**打包内容**：`package.json` 的 `files` 字段已限定只发布 `lib/`、`docs/assets/dsh-connect-trae-usage-card.png`、`screenshots.json`、`cordis.patch.yml`、`README.md`、`README.en.md`、`CHANGELOG.md`、`THIRD_PARTY_NOTICES.md`、`LICENSE`，`tests/` 和 `node_modules/` 不会进入发布包。

**发布前检查**（可选但推荐）：

```bash
npm pack --dry-run
```

### 6. 2FA 确认（若账号开启两步验证）

`npm publish` 若提示 EOTP，按 npm CLI 给出的 URL 在浏览器登录确认即可，终端内的 `npm publish` 会自动继续。

### 7. 验证发布成功

```bash
npm view dsh-connect-trae version            # 应显示 X.Y.Z
npm view dsh-connect-trae dist-tags.latest   # 应为 X.Y.Z
```

> 刚发布后 registry 读缓存可能有短暂延迟，稍等重查即可。

### 8. 发布后一致性核验（推荐）

确认「npm 上的包」确实等于「tag 指向的源码」——防止发布时工作树里有未提交改动、或包构建自别的提交：

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

## 常见问题

- **`npm publish` 报 EOTP**：账号开启了 2FA，按第 6 步在浏览器确认，不要绕过。
- **`npm publish` 报 E409 `Cannot publish over previously staged version`**：该版本号已被占（可能是同一次发布的重试，或编号被预占）。先用 `npm view dsh-connect-trae versions` 确认它是否已实际发布；若已发布则无需重发，若确未发布又无法复用编号，按第 2 步顺延到下一个版本号（参考 1.4.1→1.4.2 的编号顺延记录）。
- **忘了把 CHANGELOG 的标题日期定稿**：见第 4 步的说明——tag 已推送或包已发布时不要移动 tag，留给下个版本修正。
- **发布后 `npm view ... version` 还是旧版本**：registry 缓存延迟，稍等重查 `npm view ... versions`。
- **本地开发与发布的关系**：本地开发用 `link:` 安装，与 npm 发布互不影响；npm 发布的包是 `lib/`、README 等静态文件，同一份源码。
