# 歌词底层架构重构方案

## 目标

把当前“按时间点把多行歌词分组，再在组内判断主/翻译/音译”的实现，升级为“统一文档模型 + 轨道级识别 + 附属轨挂接”的架构，彻底降低以下问题的误判率：

- 主歌词、翻译、罗马音顺序不固定
- 翻译 / 罗马音与主歌词时间不完全一致
- 同一歌词文件中存在 parser 原生附属字段与独立行混用
- 日文 / 韩文 / 中文歌词和 Latin 转写、英文翻译之间误判
- 同步同语种多行时，被错误合并成主歌词 + 翻译

## 当前实现与目标差距

当前核心链路已经比较清晰：

1. `parser.ts` 负责把原始歌词统一成 `ParsedLine[]`
2. `classifier.ts` 负责按时间近邻分组并在组内分类
3. `converters.ts` 负责输出 `SemanticLine[]` 和 `LyricLine[]`
4. `state.ts` 负责加载与运行时状态

问题在于：当前分类单位仍然偏“行组”，而不是“整条轨道”。这会导致以下限制：

- 只能利用局部上下文，无法利用整首歌的覆盖率、对齐稳定性、依附关系
- 同时间戳附近的歧义行只能保守处理，无法在全局上确认其身份
- parser 原生的 `translatedLyric` / `romanLyric` 与独立歌词行，没有进入统一的轨道语义层

## 重构原则

- 最小改动优先：不推翻现有 UI、设置、桌面歌词、AMLL 渲染接口
- 保持兼容：外层仍继续消费 `SemanticLine[]` / `LyricLine[]`
- 先补核心模型，再迁移分类逻辑，再补验证
- 允许保守回退：无法可靠识别时进入 `unknown / secondary`，不强行误判

## 目标架构

### 1. 统一文档模型

新增内部标准结构：

- `LyricDocument`
  - `metadata`
  - `tracks[]`
  - `issues[]`
  - `confidence`
- `LyricTrack`
  - `id`
  - `role`
  - `lang`
  - `timingMode`
  - `sourceFormat`
  - `confidence`
  - `lines[]`
  - `attachments[]`
- `LyricTrackLine`
  - `id`
  - `startMs`
  - `endMs`
  - `text`
  - `words[]`

### 2. 分层处理流程

新的核心流程：

1. 输入层：保持现有 `get_song_lyrics`
2. 解析层：继续由 `parser.ts` 产出标准 `ParsedLine[]`
3. 文档归一化层：把 `ParsedLine[]` 转成 `LyricDocument`
4. 轨道识别层：按整轨评分，确定 `main / translation / romanization / unknown`
5. 挂接层：把附属轨按时间和序列关系挂到主轨
6. 兼容导出层：继续导出 `SemanticLine[]` / `LyricLine[]`

## 具体实施步骤

### Phase 1：引入内部文档模型

- 在 `src/composables/lyrics/types.ts` 新增 `LyricDocument`、`LyricTrack`、`LyricTrackLine`、`LyricTrackRole`
- 保留现有 `ParsedLine`、`SemanticLine`、`LyricLine`，保证外层调用不受影响

### Phase 2：把解析结果归一化为候选轨道

- 把 parser 原生 `translatedText` / `romanText` 拆成独立候选轨道内容
- 将含 `romanText` 的逐词信息也纳入候选轨道
- 基于时间顺序、脚本分布、显式 role、cluster slot 生成 track candidates

### Phase 3：实现整轨评分与主轨选择

- 主轨评分维度：
  - 时间覆盖率
  - 行数覆盖率
  - 逐词时间完整度
  - 是否被其他轨稳定依附
  - 是否更像原唱脚本
- 附属轨评分维度：
  - 与主轨的时间对齐度
  - 行数对应率
  - 顺序一致性
  - 脚本互补关系
  - 英文自然度 / 音译形态特征

### Phase 4：按主轨挂接翻译与罗马音

- 以唯一 display main track 为中心输出
- 翻译和罗马音永远作为附件挂到主轨
- 对无法稳定挂接的轨道，保留为 `secondary` 或 `unknown`

### Phase 5：兼容导出与运行时接入

- `buildSemanticLines()` 改为从 `LyricDocument` 导出
- `state.ts` 保持外部行为不变，但内部改为使用新文档模型
- 现有播放器歌词、桌面歌词、迷你播放器不直接感知重构

### Phase 6：补测试与可观察性

- 保留现有 raw lyrics 样例测试
- 增加轨道级测试：
  - parser-native 附属轨拆分
  - 时间轻微漂移下的主轨挂接
  - 英文翻译与罗马音区分
  - 同语种歧义轨保守降级

## 风险控制

- 不直接修改 UI 层结构，风险集中在 `lyrics` 核心目录
- 所有旧导出接口继续保留，减少连锁修改
- 当轨道评分不足时，回退到 `unknown / secondary`
- 优先通过测试样例验证，不在第一阶段引入用户可见配置变更

## 成功标准

- `prepareParsedLyrics()` 和 `buildSemanticLines()` 对外兼容
- 现有歌词渲染链路不需要大改
- 多语种歌词识别更稳定，尤其是：
  - 日文 + 中文 + 罗马音
  - 韩文 + 中文
  - 中文 + 拼音
  - 英文 + 中文
  - 含轻微时间漂移的双语歌词
- 测试通过，且新增轨道级测试覆盖关键新逻辑
