# HTML Mender Windows 桌面版

## 给同事使用

每次发布会提供两个文件：

- `HTML-Mender-Setup-版本号.exe`：安装版，适合长期使用。
- `HTML-Mender-Portable-版本号.exe`：免安装版，双击即可运行。

两个版本都会在当前用户桌面创建 `HTML Mender 工作区`。上传项目、历史版本和应用内部文件保存在该目录中；通过页面下载的 ZIP 或 HTML 保存在其中的 `导出文件`。

## 任务工作台

- 单个 HTML、多个 HTML 和 ZIP 都需要先填写任务名称。
- 最近保存的任务会在应用中长期保留，关闭应用后可以继续打开。
- 每个页面拥有独立版本，可以预览、下载或恢复历史版本。
- 编辑页支持保存版本、复制完整 HTML、返回任务以及切换上一页和下一页。
- 完整导出时会弹出系统“另存为”窗口，由用户选择保存目录和文件名。

不要把整个工作区发给其他人，除非确实需要分享其中的项目资料。只分发 EXE 不会包含个人项目。

## 在 GitHub 生成 EXE

1. 将本项目上传到 GitHub 仓库。
2. 打开仓库的 `Actions` 页面。
3. 选择 `Build Windows desktop app`，点击 `Run workflow`。
4. 构建完成后，在该次运行底部下载 `HTML-Mender-Windows`。
5. 解压后即可获得安装版和免安装版 EXE。

发布 `v0.1.0` 这类版本标签时也会自动构建。

## 在 Windows 开发电脑本地构建

从 [Node.js 官方网站](https://nodejs.org/) 安装 Node.js 22 LTS，然后在项目目录执行：

```powershell
node --version
npm --version
npm ci
npm test
npm run dist:win
```

生成文件位于 `release` 文件夹。

## 日常开发

网页开发模式仍可使用：

```powershell
npm start
```

桌面开发模式：

```powershell
npm run desktop
```
