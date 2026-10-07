## v2.13.2（2026-10-07）

> **修复 2.12.0 起客户端整半无法加载。2.13.1 的归因是错的，这一版是真正的原因。**

```
web boot: 1 entry did not activate
dsh-connect-trae: import failed
```

受影响版本：**2.12.0、2.13.0、2.13.1**。

### 真正的根因

2.12.0 为积分浮层引入了 `import { createPortal } from 'react-dom'`。**`react-dom` 不在 `tsdown.config.ts` 的 `CLIENT_EXTERNALS` 名单里，于是被内联打包**，其 CJS 构建开头就是：

```js
if (process.env.NODE_ENV !== "production") { … }
```

浏览器里没有 `process` → 模块**求值时**抛 `ReferenceError: process is not defined` → 整个客户端半边 import 失败。

### 证据

| 检查项 | 2.13.1 | 修复后 |
| --- | --- | --- |
| 产物中 `process.env` 出现次数 | **5** | **0** |
| 产物体积 | **1,072,561 B**（含内联 react-dom） | **119,427 B** |
| 产物 require | react, react/jsx-runtime, primitives | react, **react-dom**, react/jsx-runtime |

宿主本身**注册了** `react-dom`（`staticModules` 里有 `"react-dom":Rf,"react-dom/client":Df`），所以正确做法是外部化而不是内联。

### 修复

- `react-dom` 与 `react-dom/client` 加入 `CLIENT_EXTERNALS`。

### 2.13.1 的归因错在哪

2.13.1 判定原因是值导入了 `@deepseek-ai/dsh-client-ui-primitives`、浏览器无法解析。**这是错的。** 我把宿主前端 bundle 反出来看了它的模块加载器，`staticModules` 明确注册了该包。

我当时只对比了「2.11.1 有两个 require、2.12.0 有三个」，看到多的那个就下了结论，**没有验证那个 require 在浏览器里能否解析**。真正的变化是 `createPortal` 带来的 react-dom 内联——而证据（`process.env` 5 处、1MB 体积）一直摆在产物里。

2.13.1 把两个浮层 hook 改成本地实现这一点**保留**（少一个运行时依赖、测试无需 mock），但其注释中的错误归因已改正。

### 防止复发

`tests/client-runtime-imports.spec.ts` 重写为两条**真正的不变量**（之前的版本禁止一切 DSH 值导入，基于错误前提）：

1. **凡值导入必须已外部化** —— 否则 shell 已提供的包会被内联进来（react-dom 事故）。
2. **凡外部化的导入必须是 shell 注册过的模块** —— 否则 `require(...)` 解析不到。

- **已验证能抓住真实事故**：把 `react-dom` 移出 `CLIENT_EXTERNALS`（还原 2.12.0 状态）→ 2 例失败；导入未注册的包 → 1 例失败。
- 不需要构建产物，在引入问题的那一行就失败。

**完整比较**：[v2.13.1...v2.13.2](https://github.com/dingminhua/dsh-connect-trae/compare/v2.13.1...v2.13.2)
