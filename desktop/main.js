import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from "electron";
import { mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DESKTOP_APP_NAME, resolveDesktopWorkspace } from "../src/desktop-config.js";

let mainWindow = null;
let serverRuntime = null;
let shuttingDown = false;

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(startDesktopApp).catch((error) => {
    console.error("HTML Mender failed to start:", error);
    app.quit();
  });
}

async function startDesktopApp() {
  const workspaceDir = resolveDesktopWorkspace({
    desktopPath: app.getPath("desktop"),
    env: process.env
  });
  const exportDir = join(workspaceDir, "导出文件");
  mkdirSync(exportDir, { recursive: true });

  process.env.HTML_MENDER_DATA_DIR = workspaceDir;
  const { startServer } = await import("../src/server.js");
  serverRuntime = await startServer({ host: "127.0.0.1", port: 0 });
  registerExportHandler();

  Menu.setApplicationMenu(null);
  mainWindow = new BrowserWindow({
    title: DESKTOP_APP_NAME,
    width: 1480,
    height: 960,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: "#f5efe2",
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: fileURLToPath(new URL("./preload.cjs", import.meta.url))
    }
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  mainWindow.webContents.on("will-navigate", (event, targetUrl) => {
    if (!isLocalUrl(targetUrl)) {
      event.preventDefault();
      openExternalUrl(targetUrl);
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isLocalUrl(url)) {
      mainWindow?.loadURL(url);
    } else {
      openExternalUrl(url);
    }
    return { action: "deny" };
  });
  mainWindow.webContents.session.on("will-download", (_event, item) => {
    item.setSavePath(join(exportDir, basename(item.getFilename())));
  });

  await mainWindow.loadURL(serverRuntime.url);
}

function registerExportHandler() {
  ipcMain.removeHandler("save-task-export");
  ipcMain.handle("save-task-export", async (_event, payload = {}) => {
    const targetUrl = new URL(String(payload.url || ""), serverRuntime.url);
    if (targetUrl.origin !== serverRuntime.url || !/^\/api\/projects\/[^/]+\/export$/.test(targetUrl.pathname)) {
      throw new Error("无效的任务导出地址。");
    }
    const suggestedName = basename(String(payload.suggestedName || "html-mender-task.zip"));
    const extension = suggestedName.toLowerCase().endsWith(".html") ? "html" : "zip";
    const selection = await dialog.showSaveDialog(mainWindow, {
      title: "选择任务导出位置",
      defaultPath: join(app.getPath("documents"), suggestedName),
      buttonLabel: "保存",
      filters: [{ name: extension === "html" ? "HTML 文件" : "ZIP 项目包", extensions: [extension] }]
    });
    if (selection.canceled || !selection.filePath) return { canceled: true };

    const response = await fetch(targetUrl);
    if (!response.ok) {
      const message = await response.text();
      throw new Error(message || "任务导出失败。");
    }
    await writeFile(selection.filePath, Buffer.from(await response.arrayBuffer()));
    return { canceled: false, filePath: selection.filePath };
  });
}

function isLocalUrl(targetUrl) {
  try {
    return new URL(targetUrl).origin === serverRuntime?.url;
  } catch {
    return false;
  }
}

function openExternalUrl(targetUrl) {
  if (/^https?:\/\//i.test(targetUrl)) {
    shell.openExternal(targetUrl);
  }
}

app.on("window-all-closed", () => app.quit());
app.on("before-quit", (event) => {
  if (!serverRuntime || shuttingDown) return;

  event.preventDefault();
  shuttingDown = true;
  serverRuntime.close()
    .catch((error) => console.error("HTML Mender server shutdown failed:", error))
    .finally(() => {
      serverRuntime = null;
      app.quit();
    });
});
