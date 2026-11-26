# issue #98 回复草稿

> 用途：回复 <https://github.com/dingminhua/dsh-connect-trae/issues/98>
> （「为什么显示400报错」）
>
> **状态：插件侧已修**，随 `v4.19.2`（本稿写于 tag 之前）。
> 取证：读 `@deepseek-ai/dsh-tools` 的 `defineTool()` / `tools.register()` 实现，
> 在本地把 issue 里那份 `parameters` 原值喂进插件的两条请求路径复现并修复。
> 详细诊断见 [`docs/ISSUE98_DIAGNOSIS.md`](https://github.com/dingminhua/dsh-connect-trae/blob/main/docs/ISSUE98_DIAGNOSIS.md)。
> 可直接复制横线以内的内容。

---

@to2101 @eeetechen 谢谢，这个调查方向是对的，我把根因钉到具体那两行了，也说清楚插件这次能修到哪、修不到哪。

## 一、确认：`400` 跟 Trae 账号、凭据、网络都无关

报错原文是

```
tools.15.function.parameters must be a JSON Schema of type object
```

`tools[15]` 就是 `mode_prompt`，它带出去的 `parameters` 是一份**属性映射表**，不是 JSON Schema：没有根级 `type: "object"`，没有 `properties` 容器，`required` 只有属性内那种 draft-3 布尔值。Trae 的 DeepSeek 后端要求 object 根，而且 `tools.N` **整批一起校验**——一个不合法，整轮请求就 `400`。这解释了为什么「换个模型/换 provider 就好了」：别的 provider 对 schema 宽松。

## 二、它为什么能走到 wire 上（接线上的问题）

`@local/dsh-modes-pack` 走的是 `ctx.tools.register()`。在 `@deepseek-ai/dsh-tools` 里，这两个入口对 `parameters` 的处理**完全不同**：

| 入口 | 编译 `parameters` 吗 |
| --- | --- |
| `defineTool()` | **编译**。`parameterSchemaSpecToJsonSchema()` 把映射表变成 `{ type: "object", properties, required }`（`lib/index.js:274-283`，`defineTool()` 在 `:320` 调用它） |
| `tools.register()` | **不编译**。只校验 `output.schema`（`:437`），`definition.parameters` 原样收下（`:433-445`） |

于是走 `register()` 的那份映射表一个字节没变地上了 wire。同一份映射表，走 `defineTool()` 会被编译、走 `register()` 会原样穿过——**产物长得完全不一样，而失败只发生在某一个 provider 的入口**。这是个静默陷阱。

## 三、为什么 issue #49 的补丁没挡住

我上一版（v4.18.x，issue #49）加的 `normalizeTraeToolSchema` 只做一件事：把属性内的 draft-3 `required: true` 提升成父级数组。它的逻辑挂在 `typeof source['properties'] === 'object'` 这个分支上——**而 #98 这个形状根本没有 `properties` 键**，整段被跳过，原样返回。它也不补根级 `type`。两个都缺。

## 四、v4.19.2 修了什么

给 `normalizeTraeToolSchema` 补上第二个半边：

- 认出裸属性映射表，包成 `{ type: "object", properties, required }`，**与 `defineTool()` 的产物一致**。特意**不加** `additionalProperties: false`——DSL 编译器本来也不加，加了会反过来禁止工具真正要收的参数。
- 判断范围收得很紧：只在 `normalizeTraeToolSchema` 的直接入参和任何 `parameters` 键的值上尝试。**`properties` 容器本身不参与判断**——它同样是「名字 → schema」的映射，按形状猜会把每个合法 schema 的属性再包一层（我第一版实现就踩了这个，8 条既有用例立刻红）。

实测同一份 issue payload 现在两条路径的产物都是：

```json
{"type":"object","properties":{...},"required":["mode","action"]}
```

## 五、边界：这次修不到什么（重要）

**这次只修「缺 object 根」这一种不合法。** 其它畸形 schema（属性里写 `required: 5`、`type` 拼错、`required` 列了不存在的字段）仍然会把整轮打挂。插件不是 schema 校验器，也不该替调用方静默改写语义——那会把「工具写错了」变成「工具悄悄行为不同」。

**注册侧的正解还是要在 `modes-pack` 里做**，二选一：

1. 用 `@deepseek-ai/dsh-tools` 的 `defineTool()` 包裹这个定义，让 `parameters` 走和官方工具一样的编译管线（顺带把 draft-3 `required: true` 也解决了）；
2. 或者直接把 `parameters` 换成原始 JSON Schema：加 `"type": "object"`、对象级 `required: ["mode","action"]`。

插件侧这道防线是兜底，不是替代品。

## 六、给 `dsh-tools` 的建议

`tools.register()` 不校验 `definition.parameters` 这件事，建议上游补一下：让 `register()` 对 `parameters` 跑一次与 `defineTool()` 相同的 `assertSupportedJsonSchema()`（至少要求 object 根），错误就会在**注册时**暴露，而不是等到某个严格 provider 的入口。或者至少在文档里写死「`register()` 收原始 JSON Schema，简写 DSL 只属于 `defineTool()`」。
