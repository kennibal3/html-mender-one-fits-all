# HTML课件互动编辑系统 macOS 使用与构建说明

## 适用设备

当前 macOS 封装面向 Apple 芯片 Mac，包括 M1、M2、M3、M4 及后续同架构机型。

## 使用已封装版本

### 使用 DMG 安装

1. 双击 `HTML课件互动编辑系统-版本号-macOS-arm64.dmg`。
2. 将 `HTML课件互动编辑系统` 拖入“应用程序”文件夹。
3. 从“应用程序”中打开 `HTML课件互动编辑系统`。

### 直接运行 APP

打开 `release/mac-arm64`，双击 `HTML课件互动编辑系统.app`。

应用启动后会在当前用户桌面使用 `HTML Mender 工作区`，课件、历史版本、导出文件和工作台数据都保存在这里。该目录名称为兼容早期版本而保留。

## 首次打开提示

当前版本未使用 Apple Developer 证书签名和公证。本机生成的应用通常可以直接打开；通过网络或聊天工具传到另一台 Mac 后，macOS 可能阻止首次启动。

遇到提示时，在 Finder 中右键点击 `HTML课件互动编辑系统`，选择“打开”，再在确认窗口中选择“打开”。此操作通常只需执行一次。

如需让分发给他人的版本保持标准双击打开体验，需要使用有效的 Apple Developer ID 对应用签名并提交 Apple 公证。

## 本机构建

需要 Node.js 22 LTS，并先安装项目依赖：

```bash
npm ci
npm run dist:mac
```

构建结果位于 `release` 目录：

- `mac-arm64/HTML课件互动编辑系统.app`
- `HTML课件互动编辑系统-版本号-macOS-arm64.dmg`

## 支持范围

- 支持导入和编辑 HTML、多个 HTML 及 ZIP 项目包。
- 支持导出 HTML 和 ZIP。
- 用户数据不会打进安装包，也不会提交到仓库。
- 当前构建不包含 Intel 版；Intel Mac 需要另行生成 x64 构建。
