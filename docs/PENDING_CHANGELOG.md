# 待写入 CHANGELOG 的条目（下一个版本）

> **这份文件是一块暂存区，不是文档。** 发版时把下面的内容整段追加到
> `CHANGELOG.md` 顶部（`# Changelog` 之后、最新已发布版本之前），然后删除本文件。
>
> **为什么不能直接写进 `CHANGELOG.md`：** 它是**随包文件**（在 `package.json` 的
> `files` 里）。已发布的 tag `v4.7.0` 之后若改动任何随包文件，
> `pnpm run verify:release` 会（正确地）报出「tag 之后改动了发布内容」——
> 因为那意味着线上包不再等于「tag 指向的源码」。而未发布版本的条目本来就
> 不属于已发布的那份 CHANGELOG。
>
> 放在 `docs/` 下是安全的：`docs/*.md` 不进发布包（只有 `docs/assets/` 下两张
> PNG 随包），所以改它不会污染发布内容。

---

## 未发布

### 变更

- **输入框积分浮层的「刷新积分」按钮换成「设置」按钮**（m01198）—— 一点就打开
  本插件自己的设置页，浮层同时关闭。
  - **为什么换掉而不是并排放两个**：这个浮层的读者此刻的问题是「这数字去哪改」，
    而原来的答案要求先关浮层、再在插件页里找到这一行。积分本身不需要按钮——
    **打开浮层、切换账号、每 5 分钟**都会重新读一次，刷新按钮提供的那个动作
    本来就已经在别处发生了。两个短标签并排不是排不下（浮层宽 248px，标题加
    两个按钮仍有余量），而是**其中一个是多余的**：浮层的头部只该有一个控件，
    而它应该是那个浮层自己答不出来的问题。
  - **走宿主的 `pluginNavigation.openBundle`，不是自己拼路由**。这台宿主上
    插件设置不在「设置」页里，而在**插件页**的 bundle 页——`plugins.bundle.config`
    / `plugins.row.config` 就是配置面；「设置」只留只读的内置清单。所以「打开
    插件设置」= 「在插件页上打开这个 bundle」，官方口子就是那个服务。
  - **按精确包名，且只试一个名字**：`openBundle` 拿 `pkg.name` 做**全等**比较，
    Loader 的条目 id（`include:dsh-connect-trae`）永远匹配不上。也**不**退化成
    「多试几个拼写」——目标未知时页面会渲染成**列表**，第二个名字会把第一个的
    导航撤销掉。
  - **回退到 `layout.selectPanel('plugins')`**：`pluginNavigation` 由插件页那个
    bundle 提供，不是外壳。profile 可以不含它，而且**加载顺序不是本插件能假设
    的**——所以探测放在**按下时**而不是 `apply` 时：在 `apply` 里探一次会把
    `undefined` 永久记下来，按钮从此在整个会话里都是死的。回退是**回退**：
    `'plugins'` 是另一个包的私有 key，而 `openBundle` 才是它公开的口子；
    `selectPanel` 在 key 没注册时会**抛**，所以调用点是 guard 而不是信任。
  - **打不开就说出来，不装死**：`false` 落到浮层自己的错误行（`composer.openSettingsFailed`），
    而且浮层**不关**——按一下屏幕上什么都没变，与「按钮坏了」无法区分。
    它有自己的 state，不与「读上游失败」共用一个标志：两句话说的不是一件事，
    共用标志会让一次点击抹掉另一次的说明。
  - **没有路线时不画这个按钮**：与页面标题栏的返回按钮同一条规则——做不了事的
    控件不画。
  - **路由单独成模块**（`src/client/settings-route.ts`）：客户端入口导入的是浏览器
    专用包，Node 测试环境装不进来，值得断言的东西必须落在入口之外——与
    `panel-switch.ts` 是同一个缝。判定住在那里，按钮住在组件里。

### 修复

- **`registerPointsSlot` 的 `inject` 契约类型改对了**：它原来把注入体写成
  `TraeUsageCardInjected`，而实际注入的是 `{ t, settingsScope, position }`——
  多出来的 `position` 之所以没报错，靠的是对象字面量的多余属性检查没有触发，
  而不是类型正确。现在写成 gate 自己的 `ComposerPointsGateProps`，两个多出来的
  属性是**契约的一部分**，不是意外。

### 文档

- README / README.en 的「输入框读数」一段改为「设置」按钮，并说明积分本身为什么
  不再需要刷新按钮。
- **重画 `docs/assets/dsh-connect-trae-composer-credits.png`**：旧图里右上角还是
  「刷新积分」，若不换，README 的配图会与界面不一致。新图由新增的
  `tools/composer-shot.tsx` 生成（真实 zh 文案 + headless Chrome 实拍，536×412）。

### 测试

- 新增 `tests/composer-settings-route.spec.tsx`（14 例），四组：
  - **路由**：`openBundle` 按精确包名优先、`pluginNavigation` 缺席时回退到
    `selectPanel('plugins')`、两者都没有时返回 `false` 而不抛、`openBundle` 抛时
    仍回退、**两者都抛时返回 `false`**、以及**每次调用都重新探测**（后出现的服务
    要能找到）。
  - **按钮**：有路线时画出来、按下后**关掉浮层**、无路线时不画、打不开时显示
    错误行且**浮层不关**、错误行与「读上游失败」互不覆盖。
  - **穿过 gate**：把路线接到 `ComposerPointsGate` 上真的能按到——否则路线可以
    接进入口却被 gate 丢掉，而上面每一条断言都还是绿的。
  - **没留下残骸**：两个字典里的 `composer.refresh` / `composer.refreshing`
    都已删除；新 class 有规则、旧 class 的规则**也已删除**（防止后来者以为它还在用）。
- `tests/composer-points.spec.tsx` 里那条「行内没有刷新按钮、刷新在浮层里」的用例
  在原处改写为「行内没有自己的控件」，并显式断言**浮层里也不再有任何刷新按钮**
  （`.dsm-trae-composer-panel-refresh` 为 null）与「没有路线时不画设置按钮」。
  这条用例原来锁的规则正是被替换掉的那条，所以**在原处改**而不是删掉：它同时
  守着「行内只有一个触发器」这个没变的不变量。
- 新增 `tools/composer-shot.tsx` 并注册进 `vitest.card.config.ts`。它暴露了两个
  这个仓库已经踩过一次的坑，都写进了文件注释：**浮层是 portal 到 `document.body`
  的**，只序列化渲染容器会得到一个空浮层（第一版就是这样，AUDIT 全部 null）；
  **jsdom 的盒子全是 0**，所以锚定定位会把浮层放到视口外，预览里必须用
  `!important` 钉住位置才拍得到。
- 全仓 **99 个文件 / 1273 例**通过；两个 tsconfig 分别 typecheck 通过；构建通过。
