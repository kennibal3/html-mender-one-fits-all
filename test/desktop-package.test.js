import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("package config builds both Windows installer and portable executables", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const targets = packageJson.build?.win?.target || [];
  const targetNames = targets.map((target) => typeof target === "string" ? target : target.target);

  assert.equal(packageJson.main, "desktop/main.js");
  assert.equal(packageJson.version, "1.0.0");
  assert.equal(packageJson.build?.productName, "HTML课件互动编辑系统");
  assert.match(packageJson.scripts?.desktop || "", /electron/);
  assert.match(packageJson.scripts?.["dist:win"] || "", /electron-builder/);
  assert.ok(packageJson.build?.files?.includes("vendor/**/*"), "bundled editor runtime is missing from build files");
  assert.ok(packageJson.build?.asarUnpack?.includes("vendor/**/*"), "editor runtime must be unpacked for child processes");
  assert.ok(targetNames.includes("nsis"), "Windows installer target is missing");
  assert.ok(targetNames.includes("portable"), "Windows portable target is missing");
  assert.equal(packageJson.build?.mac?.icon, "build/icon.icns");
  assert.equal(packageJson.build?.win?.icon, "build/icon.ico");
  assert.equal(packageJson.build?.nsis?.shortcutName, "HTML课件互动编辑系统");
  assert.match(packageJson.build?.dmg?.artifactName || "", /HTML课件互动编辑系统/);
  assert.match(packageJson.build?.nsis?.artifactName || "", /HTML课件互动编辑系统/);
  assert.match(packageJson.build?.portable?.artifactName || "", /HTML课件互动编辑系统/);
  assert.match(packageJson.build?.nsis?.artifactName || "", /Setup/);
  assert.match(packageJson.build?.portable?.artifactName || "", /Portable/);
});

test("desktop entry point and Windows build workflow exist", async () => {
  await access(new URL("../desktop/main.js", import.meta.url));
  const main = await readFile(new URL("../desktop/main.js", import.meta.url), "utf8");
  const preload = await readFile(new URL("../desktop/preload.cjs", import.meta.url), "utf8");
  const workflow = await readFile(new URL("../.github/workflows/build-windows.yml", import.meta.url), "utf8");
  assert.match(main, /ipcMain\.handle\("save-task-export"/);
  assert.match(main, /showSaveDialog/);
  assert.match(main, /preload\.cjs/);
  assert.match(preload, /contextBridge\.exposeInMainWorld\("htmlMenderDesktop"/);
  assert.match(workflow, /HTML课件互动编辑系统-Windows/);
  await access(new URL("../build/icon.svg", import.meta.url));
  await access(new URL("../build/icon.png", import.meta.url));
  await access(new URL("../build/icon.icns", import.meta.url));
  await access(new URL("../build/icon.ico", import.meta.url));
  await access(new URL("../vendor/html-slide-mender/scripts/inject-html-editor.mjs", import.meta.url));
  await access(new URL("../vendor/html-slide-mender/assets/html-slide-mender-runtime.js", import.meta.url));
  await access(new URL("../.github/workflows/build-windows.yml", import.meta.url));
});
