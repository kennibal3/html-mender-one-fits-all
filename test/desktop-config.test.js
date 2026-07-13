import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";

async function loadDesktopConfig() {
  return import("../src/desktop-config.js").catch(() => ({}));
}

test("desktop workspace defaults to a dedicated folder on the desktop", async () => {
  const { resolveDesktopWorkspace } = await loadDesktopConfig();

  assert.equal(typeof resolveDesktopWorkspace, "function", "desktop workspace resolver is not implemented");
  assert.equal(
    resolveDesktopWorkspace({ desktopPath: "C:\\Users\\Teacher\\Desktop", env: {} }),
    join("C:\\Users\\Teacher\\Desktop", "HTML Mender 工作区")
  );
});

test("desktop workspace accepts an explicit data directory", async () => {
  const { resolveDesktopWorkspace } = await loadDesktopConfig();

  assert.equal(typeof resolveDesktopWorkspace, "function", "desktop workspace resolver is not implemented");
  assert.equal(
    resolveDesktopWorkspace({
      desktopPath: "C:\\Users\\Teacher\\Desktop",
      env: { HTML_MENDER_DATA_DIR: "D:\\HTML-Mender-Data" }
    }),
    "D:\\HTML-Mender-Data"
  );
});

test("desktop window title is stable for Windows shortcuts", async () => {
  const { DESKTOP_APP_NAME } = await loadDesktopConfig();

  assert.equal(DESKTOP_APP_NAME, "HTML Mender");
});
