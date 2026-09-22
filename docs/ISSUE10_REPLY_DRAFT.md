# issue #10 回复草稿（发布 2.0.5 之后再贴）

> 用途：回复 https://github.com/dingminhua/dsh-connect-trae/issues/10
> （1309893790：「我测试了一下一直0缓存」「不知道接口原因还是 trae 上有缓存」）
>
> **先发布 2.0.5 到 npm，确认 `npm view dsh-connect-trae version` 显示 2.0.5
> 之后再贴。** 可直接复制横线以内的内容。

---

感谢反馈，你这个问题**问得很准**——「是接口原因」这个方向对了，而且**Trae 确实有缓存**，
只是**插件把缓存字段丢了**。已修复，v2.0.5 发布。

## 结论

**不是 Trae 不缓存，是插件没把缓存数据搬出来。**

| 环节 | 情况 |
| --- | --- |
| Trae 上游 | ✅ 真的在报缓存（实测命中 9216 tokens） |
| 插件解码层 | ❌ **把 `cache_read_input_tokens` 字段直接丢了** |
| DSH 显示 | ❌ 从未收到非零值，所以稳定显示 0 |

## 证据：Trae 上游确实在报缓存

我用插件自己的请求路径，把**逐字节相同**的长 prompt（约 9200 tokens）连发两次：

```
第 1 次（冷）  : prompt_tokens=5258  cache_read=0
第 2 次（相同）: prompt_tokens=9224  cache_read=5248
第 3 次（相同）: prompt_tokens=9224  cache_read=9216   ← 命中
```

上游返回的原文（第 3 次，真实捕获）：

```json
{"prompt_tokens":9224,"completion_tokens":173,"total_tokens":9397,
 "cache_creation_input_tokens":0,"cache_read_input_tokens":9216,...}
```

所以**上游一直有数据**，字段名是 `cache_read_input_tokens`。

## 根因：插件在解码时就把字段丢了

插件把 Trae 的事件翻译成 OpenAI 格式时，只搬了 4 个计数器：

```
prompt_tokens / completion_tokens / total_tokens / reasoning_tokens
```

`cache_read_input_tokens` 和 `cache_creation_input_tokens` **不在搬运清单里**，直接忽略。
更麻烦的是 DSH 只认**另一种拼写**（`prompt_tokens_details.cached_tokens`），
所以这不是「放行」就够，而是**必须做字段名映射**——这一步此前完全缺失，于是界面上永远 0。

## 修复内容（v2.0.5）

1. **解码层**：保留 Trae 的缓存字段，纳入类型定义（`prompt_tokens_details` 缺失时行为不变）。
2. **转发层**：映射为 DSH 认识的 `prompt_tokens_details.cached_tokens` / `cache_write_tokens`。
3. **算术正确性**：先确认了 Trae 的 `prompt_tokens` **包含**缓存量（OpenAI 口径），
   因此映射后不会重复扣减——验证账目守恒：`8 + 9216 + 0 = 9224`，与 `prompt_tokens` 完全相等。
4. 顺带修掉 Raw Chat 通道的**同一类缺口**（将来启用时会踩同一个坑）。

## 升级方式

```bash
npm i -g dsh-connect-trae@2.0.5
```

## 有一点请留意（避免误判「还是 0」）

修复只保证**上游报了缓存、插件就如实上报**，但**是否命中缓存取决于上游和你的使用方式**：

- **第一轮永远是 0**：新会话、新前缀第一次请求必然是冷启动，实测就是 `cache_read=0`，
  第二轮起才有值。所以「刚开一个会话看第一轮」看到 0 是正常的。
- **前缀要逐字节一致**才能复用：正常多轮对话（历史往后追加新消息）满足这个条件；
  中途改系统提示词、切换模型、大幅编辑历史，都会让前缀失效。
- 本机实测 Trae 目前**只报读、不报写**（`cache_creation_input_tokens` 恒为 0）。

建议升级后**连续问两轮以上**再看统计。

再次感谢反馈，这个问题要不是你提，缓存统计会一直是坏的 🙏
