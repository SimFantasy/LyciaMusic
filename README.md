# Lycia Player
# 铃音播放器

<div align="center">

[English](./README_EN.md)

</div>

铃音播放器 是一个面向本地音乐收藏的桌面播放器，重点放在音乐库整理、播放体验、歌词显示和 Windows 桌面集成上。

<div align="center">
  <img src="app.png" width="28%" alt="Lycia Player 预览">
</div>

## 项目状态

- 开发阶段：Alpha
- 主要平台：Windows 10 / 11
- 当前定位：个人使用优先，持续迭代中
- 交流 QQ 群：1085716541

本项目基于个人兴趣开发。功能会优先围绕自己的本地音乐使用场景推进，部分功能测试覆盖仍有限，未经严格测试，遇到问题欢迎通过 Issue 反馈。

## 功能亮点

- 本地音乐库：扫描本地 `mp3`、`flac`、`wav` 音频，支持增量更新、封面读取和基础统计。
- 播放体验：支持播放队列、进度控制、音量控制、输出设备切换、系统媒体控制和系统托盘。
- 歌词显示：支持音频标签歌词、同名 `.lrc` 文件、桌面歌词浮窗，以及基于 AMLL 的逐字歌词显示。
- 文件整理：提供文件夹管理、侧边栏管理、批量重命名预览、外部标签编辑和刷新入库。
- 界面体验：提供首页、播放页、歌单、统计、设置等常用页面，适合日常本地音乐管理。

## 界面截图

| 首页 | 播放页 |
| --- | --- |
| <img src="./screenshots/首页.png" width="100%"> | <img src="./screenshots/播放页.png" width="100%"> |

| 首页概览 | 文件夹 |
| --- | --- |
| <img src="./screenshots/首页2.png" width="100%"> | <img src="./screenshots/文件夹.png" width="100%"> |

| 文件夹管理 | 统计 |
| --- | --- |
| <img src="./screenshots/文件夹-管理模式.png" width="100%"> | <img src="./screenshots/统计.png" width="100%"> |

| 歌单 | 设置 |
| --- | --- |
| <img src="./screenshots/歌单页面.png" width="100%"> | <img src="./screenshots/设置-常规.png" width="100%"> |

| 音乐库设置 | Lyricify 支持 |
| --- | --- |
| <img src="./screenshots/设置-音乐库.png" width="100%"> | <img src="./screenshots/支持Lyricify.png" width="100%"> |

## 使用源码运行

环境要求：

- Node.js `>= 18`
- Rust stable
- Windows 10 / 11
- WebView2

安装依赖：

```bash
npm install
```

启动桌面应用：

```bash
npm run tauri dev
```

仅调试前端页面：

```bash
npm run dev
```

构建安装包：

```bash
npm run tauri build
```

## 技术栈

- 前端：Vue 3、TypeScript、Vite、Tailwind CSS 4
- 桌面端：Tauri v2、Rust
- 数据存储：SQLite
- 歌词显示：AMLL 相关实现与适配

## 已知限制

- 当前主要适配 Windows。
- 项目缺少测试，部分边缘场景可能存在问题。

## 反馈与贡献

欢迎通过 Issue 提交 bug、建议或使用反馈。个人精力有限，开发节奏不会很快；也欢迎使用 AI 工具继续扩展功能并提交 PR。

## License

AGPL-3.0-only

歌词相关实现采用并改编了 AMLL（Apple Music-like Lyrics）项目代码，具体来源与补充说明见 [NOTICE](NOTICE)。

---

更新日期：2026-05-03
