## v2.13.1（2026-10-07）

> **紧急修复：2.12.0 引入的客户端整半无法加载。**
>
> ```
> web boot: 1 entry did not activate
> dsh-connect-trae: import failed
> ```
>
> 受影响版本：**2.12.0、2.13.0**；2.11.1 及更早不受影响。

### 根因

2.12.0 为积分浮层加了锚定定位，为此在客户端入口**值导入**了 `@deepseek-ai/dsh-client-ui-primitives`。

插件的客户端 bundle 由 shell 的模块加载器载入（`window.__ModuleLoader__.load({ factory: (require) => … })`），它只注册了极少数模块名。tsdown 会把该值导入转成外部 `require(...)`，浏览器无法解析——**整个客户端半边加载失败**。

**这个不变量一直写在仓库里**：`tests/client-activation.spec.tsx` 明确记录「入口的运行时依赖只有 React 和本地文件——所有 DSH 包都是 type-only 导入、编译期被擦除」。2.12.0 破坏了它，而**所有测试依然全绿**：测试里该包被 mock、Node 也能从 node_modules 解析它，**问题只存在于浏览器中**。

### 修复

- 两个 hook（`useAnchoredPosition` / `useDismissOnOutsidePointer`）**改为本地实现**（新增 `src/client/popover.ts`），零 DSH 导入。行为对齐 shell 版本：上/下放置与视口夹取、滚动（capture）/缩放/浮层尺寸变化时重测、「按下位置既不在触发区也不在浮层内则关闭」。
- 移除入口的 primitives 值导入及为此引入的依赖注入绕路。
- 产物恢复为**只有 `react` 与 `react/jsx-runtime` 两个 require**。

### 防止复发

- **新增 `tests/client-runtime-imports.spec.ts`**：静态扫描 `src/client/**`，**任何 DSH 包的值导入即失败**（`import type` 允许）。**已验证能抓住 2.12.0 那个错误**。它跑在常规测试里、不需要构建产物，**在引入问题的那一行失败**。
- 新增 `tests/popover.spec.tsx`（14 例）覆盖本地 hook 的真实几何与关闭规则。

### 测试

- 全仓 438 → **455**。**变异验证 5 次全部被抓**。
- `client-activation.spec.tsx` 中 2.12.0 加的 primitives mock 已删除，恢复「加载真实入口、零 mock」。

### 教训

「所有测试全绿」不能证明插件能加载。本仓库的测试必须 mock DSH 包（Node 环境需要），因此**构建产物里出现了什么 require，测试看不见**。现在这条静态守卫补上了这个盲区。

**完整比较**：[v2.13.0...v2.13.1](https://github.com/dingminhua/dsh-connect-trae/compare/v2.13.0...v2.13.1)
