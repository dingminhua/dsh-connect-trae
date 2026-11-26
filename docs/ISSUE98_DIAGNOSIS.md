# issue #98 诊断：`tools.N.function.parameters must be a JSON Schema of type object`

> 现象：会话里挂上 `mode_prompt` 之后，走 Trae 每一轮都 `400`。换别的 provider
> 同一套工具正常。
>
> 结论：**不是账号、凭据、网络或本插件的问题**，是一个注册到 DSH 的工具把「简写
> 参数映射表」当成了 JSON Schema 发到上游。本仓库能做的是**插件侧最后一道防线**：
> 在请求离开插件前补上缺失的 object 根（v4.19.2）。正解在注册侧。

## 一、上游到底拒了什么

Trae 的 DeepSeek 后端在入口处逐个检查 `tools.N.function.parameters`，要求
**object 根**，而且 `tools.N` **整批一起校验**——一个不合法，整轮请求就 `400`：

```
tools.15.function.parameters must be a JSON Schema of type object
```

`tools.15` 是工具列表第 16 个（下标从 0 开始），在本会话的两次 `request/header`
里都是 `mode_prompt`。它带出去的 `parameters` 是：

```json
{
  "mode":   { "type": "string", "required": true, "enum": ["project","creator-plus"] },
  "action": { "type": "string", "required": true, "enum": ["read","write"] },
  "text":   { "type": "string" }
}
```

这不是 JSON Schema，是「属性名 → 属性 schema」的**映射表**：没有根级
`type: "object"`，没有 `properties` 容器，`required` 只有属性内那种 draft-3 布尔值。

## 二、它为什么能走到 wire 上

`mode_prompt` 由第三方插件 `@local/dsh-modes-pack` 注册（`index.js:441-466`），它
直接调 `ctx.tools.register()` 并传入上面这份 DSL 映射表。

关键的接线在 `@deepseek-ai/dsh-tools`：

| 入口 | 是否编译 `parameters` |
| --- | --- |
| `defineTool()` | **是**。`parameterSchemaSpecToJsonSchema()` 把映射表编译成 `{ type: "object", properties, required }`（`lib/index.js:800-809`、`845`） |
| `tools.register()` | **否**。只 `assertSupportedJsonSchema(output.schema)`，`definition.parameters` 原样收下（`lib/index.js:2762-2770`） |

于是走 `register()` 的那份映射表一个字节没变地上了 wire。多数 provider 对 schema
宽松，Trae 这个后端严格，就爆在这里。

`required: true` 写在属性里这件事本身也是 draft-3 遗留，`defineTool()` 的编译管线
会把它提升成对象级 `["mode","action"]`——所以「用 `defineTool()` 包裹」同时解决两个问题。

## 三、为什么 issue #49 的修复没挡住

`normalizeTraeToolSchema`（v4.18.x，issue #49）只做一件事：把属性内的 draft-3
`required: true` 提升成父级的 `required` 数组。它的包裹逻辑挂在
`typeof source['properties'] === 'object'` 这个分支上——**这个形状根本没有
`properties` 键**，于是整段被跳过，原样返回。

它也不补根级 `type: "object"`。两件事都缺，所以救不了。

## 四、修复（v4.19.2）

`normalizeTraeToolSchema` 补上第二个半边：

1. **认出一个裸属性映射表并包裹**，产物与 `defineTool()` 一致：
   `{ type: "object", properties, required }`。**不加
   `additionalProperties: false`** —— DSL 编译器本来也不加，加了会反过来禁止工具
   真正要收的参数。
2. **判断范围刻意收窄。** 只在两个位置尝试包裹：`normalizeTraeToolSchema` 的直接
   入参，以及任何 `parameters` 键的值。**`properties` 容器本身不参与判断** ——
   它同样是「名字 → schema」的映射，按形状猜会把每个合法 schema 的属性再包一层，
   产生 `{ type: "object", properties: { properties: … } }`。
   （第一版实现就踩了这个，`solo.spec.ts` / `raw-chat.spec.ts` 里 8 条既有用例立刻红。）
3. 空对象、只含 `type` 的叶子、工具记录都不会被误包。

两条 wire path 都会经过它：raw-chat 走 `buildTraeRawChatDraft`，SOLO 走
`prepareSoloBody`（后者额外 `JSON.stringify` 一次）。

实测同一份 issue payload 的两条路径产物：

```
RAW : {"type":"object","properties":{"mode":{...},"action":{...},"text":{...}},"required":["mode","action"]}
SOLO: {"type":"object","properties":{"mode":{...},"action":{...},"text":{...}},"required":["mode","action"]}
```

## 五、边界：这条修复修不到什么

- **只修「缺 object 根」这一种不合法。** 其它畸形 schema（属性里 `required: 5`、
  `type` 拼错、`required` 列了不存在的字段）仍然会把整轮打挂。插件不是 schema
  校验器，也不该替调用方静默改写语义——那会把「工具写错了」变成「工具悄悄行为不同」。
- **注册侧的正解不在这里。** `modes-pack` 应当二选一：用 `defineTool()` 包裹，或把
  `parameters` 换成原始 JSON Schema。本版是插件侧的最后一道防线，不是替代品。
- 只影响 Trae 的两条请求路径；其它 provider 不经手这个函数。

## 六、给上游（`dsh-tools`）的建议

`tools.register()` 不校验 `definition.parameters` 是一个**静默陷阱**：同一个映射表
走 `defineTool()` 会被编译、走 `register()` 会原样穿过，两种路径的产物长得完全不一样，
而失败只发生在某一个 provider 的入口。可选方向：

- `register()` 对 `parameters` 跑一次与 `defineTool()` 相同的
  `assertSupportedJsonSchema()`（至少要求 object 根），让错误在**注册时**暴露；
- 或者文档里明确写「`register()` 收的是原始 JSON Schema，简写 DSL 只属于 `defineTool()`」。
