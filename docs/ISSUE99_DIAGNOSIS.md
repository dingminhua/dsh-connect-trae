# issue #99 调查：DSH 0.2.3 起路由准入默认 `required`，插件只读路由对无 Cookie 调用方回 401

> issue：<https://github.com/dingminhua/dsh-connect-trae/issues/99>
> （「宿主侧读取 `/plugins/dsh-connect-trae/usage` 稳定 401：DSH 0.2.3 起路由准入默认
> required，需声明 auth: "anonymous"」）
> 调查时间：2026-11-24　方法：解包三版 `dsh-host-webserver` 比对 + 读本机已装宿主 + 读源码
> 状态：**报告属实，根因正确**。处理决定：**推迟到 DSH 0.2.3 正式版**，与 devDependency
> 升级合并做（理由见第 6 节）。

---

## 0. 结论

DSH `0.2.3-alpha.1` 起，`dsh-host-webserver` 给每条插件路由加了 `auth` 选项，**缺省值是
`required`**。本插件的只读路由没有声明它，于是**没有会话 Cookie 的调用方**（宿主侧进程内
`fetch`、辅助脚本）一律被挡在 401，而浏览器里的页面一切正常——因为页面请求带着
`dsh-desktop-session` cookie。

报告者的根因判断、影响面判断、修复建议都是对的。本文件记录**复核依据**与**推迟的理由**。

---

## 1. 逐版本核实（不是照抄报告）

从 npm 拉三个版本，解包比对 `lib/index.js`：

| host-webserver | `lib/index.js` 字节数 | `authPolicy` | 说明 |
| --- | --- | --- | --- |
| `0.2.2-rc.5` | 26,614 | **不存在** | `register()` 只把 route 塞进表里，不看 `auth` |
| `0.2.3-alpha.1` | 29,752 | 存在 | 首次引入准入机制 |
| `0.2.3-alpha.2` | 29,752 | 存在 | 与 alpha.1 同字节数 |

字节数与报告给的完全一致。本机已装宿主（`/Applications/DeepSeek Harness.app` 内的
`dsh/node_modules/@deepseek-ai/dsh-host-webserver`）是 **0.2.2-rc.5**，所以**本机复现不了
这个 401**——这也是本次只能做静态核实的原因。

### 缺省值确认

```js
authPolicy(auth, request) {
    return typeof auth === "function" ? auth(request) : auth ?? "required";
}
```

`auth` 未声明 → `undefined ?? "required"` → `"required"`。报告引用的代码一字不差。

### 401 的确切来源（报告没展开的一层）

`authorize()` 本身在拿不到裁决时返回的是 **503**，不是 401：

```js
const admission = this.ctx.bail(this, "webserver/authorize", request, policy)
  ?? (policy === "anonymous" ? { kind: "allow" } : { kind: "deny", status: 503 });
```

401 来自 `webserver/authorize` 这个 **bail 监听器**的裁决——即宿主自己的会话中间件。它收到
`policy === "required"` 且请求没有可用的 Peer 时，回的就是 401。响应体映射在
`lib/index.js:505`：

```js
res.end(admission.status === 401 ? "unauthorized"
      : admission.status === 503 ? "authentication unavailable" : "forbidden");
```

报告里那句 `body: "unauthorized"` 正是 401 分支，与这条路径吻合。

**含义**：声明 `auth: "anonymous"` 之所以有效，不是因为插件多做了什么校验，而是因为它让
监听器收到的策略变成 `anonymous`，不再要求 Peer。这一点值得写清楚——否则下一个人会以为
`auth` 是插件侧的开关。

---

## 2. 本插件的路由分类

9 条路由，按「放宽是否安全」分两类：

| 路由 | 方法 | 类型 | 是否应放宽 |
| --- | --- | --- | --- |
| `/plugins/dsh-connect-trae/usage` | GET | 只读 | **是** |
| `/plugins/dsh-connect-trae/account-credits` | GET | 只读 | **是** |
| `/plugins/dsh-connect-trae/account-status` | GET | 只读 | **是** |
| `/plugins/dsh-connect-trae/accounts`（refresh） | POST | 写入 | 否 |
| `/plugins/dsh-connect-trae/transfer` | POST | 写入 | 否 |
| `/plugins/dsh-connect-trae/models/refresh` | POST | 写入 | 否 |
| `/plugins/dsh-connect-trae/models/test` | POST | 写入 | 否 |
| `/plugins/dsh-connect-trae/checkin` | POST | 写入 | 否 |
| `/plugins/dsh-connect-trae/pool` | POST | 写入 | 否 |

与报告的清单一致。写入路由现在 401 是**正确行为**，不应放宽。

---

## 3. 关于「不扩大攻击面」这个理由

报告写的是：

> 该路由本来就有回环守卫（`loopbackOrigin(req)`，非回环 403），所以这只是把既有的准入事实
> 写进路由声明，**不扩大攻击面**。

**结论成立，理由不准确。** `loopbackOrigin()`（`src/web-status.ts:442`）只看 `Origin` 头：

```ts
const origin = req.headers.origin
if (origin === undefined || origin.trim() === '') return true   // 无 Origin → 直接放行
```

它挡的是**浏览器跨源请求**，挡不住本地进程——本地进程根本不带 `Origin` 头，第一行就
`return true`。所以「有回环守卫所以安全」这个推论是错的。

真正让放宽成立的，是另一件事实：**在 0.2.2 及更早，这些路由本来就没有任何鉴权**。
0.2.2 的 `register()` 不看 `auth`，`WebRoute` 类型里也没有这个字段，那时任何本机进程都能读。
0.2.3 的 `required` 缺省值是**新加的收紧**，不是既有防护的延续。

所以准确的表述是：**声明 `anonymous` 是把 0.2.2 的既有事实显式化，而不是新开一个口子。**
这个区别很重要——如果按报告的理由去理解，会误以为「有回环守卫就够了」，而实际上
**放宽之后，本机任意进程都能读到账号名、积分余额、到期时间**。这是真实的暴露面变化，
只是它回到了 0.2.2 的水平。

---

## 4. 本机为什么现在改不了

两个独立的阻塞，都指向同一个版本：

1. **类型环境没有 `auth` 字段。** `devDependencies` 钉在 `0.2.2-rc.5`，其 `WebRoute`
   定义为 `{ kind, path, handler }`，直接写 `auth: 'anonymous'` 会报 TS 错误。要改就得
   再引入一个类似 `PiAiImageBudgetFields023` 的本地接口——**第二次为同一个根因打补丁**。
2. **本机装的是 0.2.2-rc.5**，改完无法真机验证（0.2.2 的 `register()` 会静默忽略
   `auth`，测试只能证明「不报错」，证明不了「401 变 200」）。

issue #96 的教训正好在这里：声明覆盖了正式版 0.2.3，但开发与测试一直钉在 0.2.2，于是
0.2.3 的接口变化没被类型检查拦住，直接漏到了用户那里。**再用一次本地接口绕过去，等于把
同一个坑挖第三次。**

---

## 5. 待做（0.2.3 正式版发布后）

按顺序，一次做完：

1. `devDependencies` 三个包提到 0.2.3 正式版（`dsh-llm-pi-ai` / `dsh-attachment` /
   `dsh-attachment-local`），并加 `@deepseek-ai/dsh-host-webserver`；
2. 删掉 issue #96 留下的 `PiAiImageBudgetFields023` 本地接口，改回直接
   `Pick<ResolvedPiAiProviderProfile, ...>`；
3. 给上表三条只读路由加 `auth: 'anonymous'`，注释写明「0.2.3 起缺省 required，宿主侧
   无 Cookie 的只读调用方会 401」，并写明第 3 节的真实理由；
4. **写一条先红后绿的测试**：在假 `ctx.webServer` 上断言这三条路由的注册对象带
   `auth === 'anonymous'`，且五条写入路由**不带**（防止顺手放宽写入路由）；
5. 本机装 0.2.3 后真机验证 401 → 200。

第 4 条是关键：这个 bug 的本质是「注册时少了一个字段」，只有断言**注册对象的内容**才能
挡住它，断言 HTTP 行为需要真宿主。

---

## 6. 处理决定

**推迟到 0.2.3 正式版。** 理由不是「不急」，而是：现在改需要第三次绕过类型环境，而
0.2.3 正式版一发布，第 5 节的四步本来就要做，届时 `auth` 是真实字段，改动是一次干净的
加法而不是又一次打补丁。

报告者的实际诉求（`dsh-pet-credits` 的 trae 那一行）在此期间可以用他已经在用的办法缓解：
在已安装产物上打补丁。但要说清楚**它会在下次升级时被覆盖**——他已经在 issue 里自己写了
这一点（4.18.7 → 4.18.8 升级后补丁就没了）。

---

## 7. 顺带确认的一件事

`/plugins/dsh-connect-trae/pool` 是 **POST**，属于写入路由，不在放宽之列。报告未列出它，
分类正确。
