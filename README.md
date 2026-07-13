# HTML Mender

HTML Mender 是一个面向教师课件的本地 HTML 编辑器，提供接近演示文稿软件的可视化编辑体验。它支持单个 HTML、多个 HTML 和完整 ZIP 项目包，并保留页面资源、页面版本和项目工作台记录。

## 主要功能

- 导入单个 HTML、多个 HTML 或 ZIP 项目包。
- 在浏览器中编辑文字、图片、音视频、形状和页面布局。
- 管理多页课件，支持新增、复制、排序、删除和恢复页面。
- 每页独立保存版本，可查看、恢复和导出历史版本。
- 完整导出 HTML 或 ZIP，并保留项目中的 CSS、JavaScript 和媒体资源。
- 支持 Windows 安装版和免安装版，两种版本的数据都保存在用户自己的工作区中。

## 本地运行

需要安装 [Node.js 22 LTS](https://nodejs.org/)。

```bash
npm ci
npm test
npm start
```

启动后访问：

```text
http://127.0.0.1:8787/
```

## Windows 桌面版

本项目同时支持安装版和免安装版：

```bash
npm run dist:win
```

构建结果位于 `release` 目录：

- `HTML-Mender-Setup-版本号.exe`：安装版。
- `HTML-Mender-Portable-版本号.exe`：免安装版。

也可以在 GitHub 仓库的 **Actions** 页面运行 **Build Windows desktop app**，完成后下载 `HTML-Mender-Windows` 构建产物。

## 数据与隐私

用户上传的课件、历史版本、导出文件和工作台数据不会提交到本仓库。桌面版默认将这些内容保存在当前用户桌面的 `HTML Mender 工作区` 中。

请勿直接分享个人工作区；给同事使用时，只分发安装版或免安装版程序。

## 更多说明

- [Windows 使用与构建说明](README_WINDOWS.md)
- [页面管理设计](docs/page-management-design.md)
- [教学交互能力设计](docs/html-teaching-interaction-capability-design.md)
- [统一任务工作台设计](docs/unified-task-workspace-design.md)
