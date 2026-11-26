## v4.19.2（2026-11-26）

> **一个「映射表」冒充 JSON Schema，让 Trae 每一轮都 400。** 这一版修掉 issue #98：会话里挂上 `mode_prompt` 之后，走 Trae 每一轮都报 `tools.15.function.parameters must be a JSON Schema of type object`。换别的 provider 同一套工具正常——不是账号、凭据、网络或本插件坏了。

### 这个版本修了什么

报错原文已经很直白：

```
tools.15.function.parameters must be a JSON Schema of type object
```

`tools[15]` 是工具列表里第 16 个，就是 `mode_prompt`。它带出去的 `parameters` 长这样：

```json
{
  "mode":   { "type": "string", "required": true, "enum": ["project","creator-plus"] },
  "action": { "type": "string", "required": true, "enum": ["read","write"] },
  "text":   { "type": "string" }
}
```

这不是 JSON Schema，是「属性名 → 属性 schema」的**映射表**：没有根级 `type: "object"`，没有 `properties` 容器，`required` 只有属性内那种 draft-3 布尔值。Trae 的 DeepSeek 后端要求 object 根，而且 `tools.N` **整批一起校验**——一个不合法，整轮就 `400`。

### 它为什么能走到 wire 上

`mode_prompt` 由第三方插件 `@local/dsh-modes-pack` 注册，走的是 `ctx.tools.register()`。在 `@deepseek-ai/dsh-tools` 里，两个入口对 `parameters` 的处理**完全不同**：

| 入口 | 编译 `parameters` 吗 |
| --- | --- |
| `defineTool()` | **编译**。把映射表变成 `{ type: "object", properties, required }`（`lib/index.js:274-283`，`defineTool()` 在 `:320` 调用它） |
| `tools.register()` | **不编译**。只校验 `output.schema`（`:437`），`definition.parameters` 原样收下（`:433-445`） |

同一份映射表，走 `defineTool()` 会被编译、走 `register()` 会原样穿过——产物长得完全不一样，而失败只发生在某一个严格 provider 的入口。多数 provider 对 schema 宽松，所以只有 Trae 爆。

### 为什么 v4.18.x 那个补丁没挡住

上一版（issue #49）加的 `normalizeTraeToolSchema` 只做一件事：把属性内的 draft-3 `required: true` 提升成父级数组。它的逻辑挂在 `typeof source['properties'] === 'object'` 这个分支上——**而 #98 这个形状根本没有 `properties` 键**，整段被跳过，原样返回。它也不补根级 `type`。两个都缺。

### 改了什么

给 `normalizeTraeToolSchema` 补上第二个半边：

1. **认出裸属性映射表并包裹**，产物与 `defineTool()` 一致：`{ type: "object", properties, required }`。特意**不加** `additionalProperties: false`——DSL 编译器本来也不加，加了会反过来禁止工具真正要收的参数。
2. **判断范围刻意收窄**。只在两个位置尝试包裹：`normalizeTraeToolSchema` 的直接入参，以及任何 `parameters` 键的值。**`properties` 容器本身不参与判断**——它同样是「名字 → schema」的映射，按形状猜会把每个合法 schema 的属性再包一层，产生 `{ type: "object", properties: { properties: … } }`。
3. 空对象、只含 `type` 的叶子、工具记录都不会被误包。

两条 wire path 都经过它：raw-chat 走 `buildTraeRawChatDraft`，SOLO 走 `prepareSoloBody`。同一份 issue payload 现在两条路径都产出：

```json
{"type":"object","properties":{...},"required":["mode","action"]}
```

### 测试

`tests/raw-chat.spec.ts` 净增 3 条：裸映射表长出 object 根；修复穿到 raw-chat draft 而合法 schema 逐字节不变；不是映射表的东西不被乱包。按仓库守则**先写会失败的测试**（`Tests 2 failed | 12 passed`）再实现到通过；并用变异验证过它们真能抓回归——把包裹分支关掉，这两条立刻红。

第一版实现踩过一个坑值得记下来：按形状猜，把 `properties` 容器本身也当成了映射表，每个合法 schema 的属性被再包一层，`solo.spec.ts` / `raw-chat.spec.ts` 里 8 条既有用例立刻红。改成上下文驱动（只有 `parameters` 位置才尝试包裹）才对。

验证：118 文件 / 1548 例全过（原 1545 + 新 3）；typecheck 双 tsconfig 0 error；build 完成；`verify:privacy` 17 项全过、无 SKIP。

### 边界（写下来免得被当成已保证）

- **只修「缺 object 根」这一种不合法。** 其它畸形 schema（属性里写 `required: 5`、`type` 拼错、`required` 列了不存在的字段）仍然会把整轮打挂——插件不是 schema 校验器，也不该替调用方静默改写语义。
- **注册侧的正解不在这里。** `modes-pack` 应当二选一：用 `defineTool()` 包裹，或把 `parameters` 换成原始 JSON Schema。本版是插件侧的最后一道防线，不是替代品。
- 只影响 Trae 的两条请求路径；其它 provider 不经手这个函数。

### 给上游的建议

`tools.register()` 不校验 `definition.parameters` 是一个静默陷阱：同一份映射表走两个入口产物完全不同，而失败只发生在某一个 provider 的入口。建议让 `register()` 对 `parameters` 跑一次与 `defineTool()` 相同的 `assertSupportedJsonSchema()`（至少要求 object 根），错误就会在**注册时**暴露，而不是等到某个严格 provider 的入口。

**Full Changelog**: https://github.com/dingminhua/dsh-connect-trae/compare/v4.19.1...v4.19.2
