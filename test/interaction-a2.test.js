import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { chromium } from "playwright";
import { makeEditableHtml } from "../src/core.js";

const CHROME_EXECUTABLE = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const TEST_IMAGE = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

function launchBrowser() {
  const configuredExecutable = process.env.PLAYWRIGHT_CHROME_EXECUTABLE || CHROME_EXECUTABLE;
  return chromium.launch({
    ...(existsSync(configuredExecutable) ? { executablePath: configuredExecutable } : {}),
    headless: true
  });
}

async function openA2Editor(page) {
  const directory = await mkdtemp(join(tmpdir(), "html-mender-a2-editor-"));
  const sourcePath = join(directory, "lesson.html");
  const editablePath = join(directory, "lesson.editable.html");
  await writeFile(sourcePath, `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>A2 弹窗测试</title></head><body>
  <div id="page-overlay" style="position:fixed;inset:0;z-index:999999">页面高层元素</div>
  <button id="trigger" type="button">打开说明</button>
  <section id="target"><h2>实验说明</h2><p>先观察，再记录。</p><img src="${TEST_IMAGE}" alt="实验图"></section>
</body></html>`, "utf8");
  await makeEditableHtml({ inputPath: sourcePath, outputPath: editablePath, lang: "zh-CN" });
  await page.goto(pathToFileURL(editablePath).href);
  await page.waitForFunction(() => window.__htmlSlideMenderBootstrap?.editor?.active === true);
  return directory;
}

test("A2 ①设置：弹窗内容可含文字图片且可配置遮罩与 Esc 关闭", async () => {
  const browser = await launchBrowser();
  const page = await browser.newPage();
  let directory = "";
  try {
    directory = await openA2Editor(page);
    const result = await page.evaluate(() => {
      const editor = window.__htmlSlideMenderBootstrap.editor;
      const trigger = document.querySelector("#trigger");
      const target = document.querySelector("#target");
      editor.enterInteractionMode();
      editor.interactionWizardKind = "click";
      editor.interactionWizardStep = 4;
      editor.interactionWizardAction = "openModal";
      editor.pendingInteractionTriggerNodeId = editor.ensureInteractionElementId(trigger);
      editor.interactionWizardTargetNodeId = editor.ensureInteractionElementId(target);
      editor.interactionAdvancedOpen = true;
      editor.refreshInteractionPanel();
      const controls = Array.from(editor.shadow.querySelectorAll("[data-wizard-control]"))
        .map((control) => control.getAttribute("data-wizard-control"));
      editor.updateInteractionWizardControl("modalBackdrop", false, { refresh: false });
      editor.updateInteractionWizardControl("modalEscape", true, { refresh: false });
      editor.completeInteractionWizard();
      const interaction = editor.interactions[0];
      return {
        controls,
        action: interaction?.action,
        initialTarget: interaction?.initialState?.target,
        targetHasText: target.textContent.includes("先观察，再记录。"),
        targetHasImage: Boolean(target.querySelector("img"))
      };
    });

    assert.equal(result.controls.includes("modalBackdrop"), true);
    assert.equal(result.controls.includes("modalEscape"), true);
    assert.deepEqual(result.action.close, { button: true, backdrop: false, escape: true });
    assert.equal(result.initialTarget, "hidden");
    assert.equal(result.targetHasText, true);
    assert.equal(result.targetHasImage, true);
  } finally {
    await page.close();
    await browser.close();
    if (directory) await rm(directory, { recursive: true, force: true });
  }
});

test("A2 ②测试预览：弹窗置顶并按配置关闭且返回后恢复编辑态", async () => {
  const browser = await launchBrowser();
  const page = await browser.newPage();
  let directory = "";
  try {
    directory = await openA2Editor(page);
    const result = await page.evaluate(() => {
      const editor = window.__htmlSlideMenderBootstrap.editor;
      const trigger = document.querySelector("#trigger");
      const target = document.querySelector("#target");
      const interaction = {
        id: "a2-preview",
        name: "实验说明弹窗",
        trigger: { event: "click", nodeId: editor.ensureInteractionElementId(trigger) },
        action: {
          type: "openModal",
          targetId: editor.ensureInteractionElementId(target),
          close: { button: true, backdrop: true, escape: false }
        },
        initialState: { target: "hidden" },
        effect: { type: "none", duration: 400 },
        record: { type: "interaction.activated" }
      };
      editor.enterInteractionMode();
      editor.interactions = [interaction];
      editor.startInteractionPreview();
      editor.activateInteractionPreview(interaction);
      const root = editor.shadow.querySelector('[data-role="interaction-preview-modal"]');
      const content = editor.shadow.querySelector('[data-role="interaction-preview-dialog-content"]');
      const closeButton = editor.shadow.querySelector('[data-action="close-interaction-preview-modal"]');
      const opened = !root.hidden;
      const contentIsComplete = content.textContent.includes("先观察，再记录。") && Boolean(content.querySelector("img"));
      const modalAbovePage = Number(getComputedStyle(editor.host).zIndex) > Number(getComputedStyle(document.querySelector("#page-overlay")).zIndex);

      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      const remainsAfterDisabledEscape = !root.hidden;
      root.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
      const closedByBackdrop = root.hidden;

      editor.activateInteractionPreview(interaction);
      closeButton.click();
      const closedByButton = root.hidden;
      editor.stopInteractionPreview({ silent: true });
      return {
        opened,
        contentIsComplete,
        modalAbovePage,
        remainsAfterDisabledEscape,
        closedByBackdrop,
        closedByButton,
        previewStopped: editor.shell.dataset.interactionPreview === "false",
        returnedToInteractionMode: editor.shell.dataset.interactionMode === "true"
      };
    });

    assert.deepEqual(result, {
      opened: true,
      contentIsComplete: true,
      modalAbovePage: true,
      remainsAfterDisabledEscape: true,
      closedByBackdrop: true,
      closedByButton: true,
      previewStopped: true,
      returnedToInteractionMode: true
    });
  } finally {
    await page.close();
    await browser.close();
    if (directory) await rm(directory, { recursive: true, force: true });
  }
});

test("A2 ⑥导出后独立运行：触摸可关闭、层级正确且 console 零报错", async () => {
  const browser = await launchBrowser();
  const context = await browser.newContext({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 }
  });
  const page = await context.newPage();
  page.setDefaultTimeout(4000);
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  const directory = await mkdtemp(join(tmpdir(), "html-mender-a2-export-"));
  try {
    const interactionRuntime = await readFile(
      new URL("../vendor/html-slide-mender/assets/html-slide-mender-interactions.js", import.meta.url),
      "utf8"
    );
    const exportPath = join(directory, "a2-export.html");
    const manifest = {
      schemaVersion: "1.3",
      interactions: [{
        id: "a2-modal",
        name: "实验说明弹窗",
        trigger: { event: "click", nodeId: "modal-trigger" },
        action: {
          type: "openModal",
          targetId: "modal-target",
          close: { button: true, backdrop: true, escape: false }
        },
        initialState: { target: "hidden" },
        effect: { type: "none", duration: 400 }
      }],
      sequences: []
    };
    await writeFile(exportPath, `<!doctype html><html><head><meta charset="utf-8"><title>A2 独立导出</title></head><body>
      <div id="page-overlay" style="position:fixed;inset:0;z-index:2147482000;pointer-events:none">页面高层元素</div>
      <button data-hsm-node-id="modal-trigger">打开说明</button>
      <section data-hsm-node-id="modal-target" hidden><h2>实验说明</h2><p>先观察，再记录。</p><img src="${TEST_IMAGE}" alt="实验图"></section>
      <script type="application/json" data-hsm-interaction-manifest="1">${JSON.stringify(manifest)}</script>
      <script>${interactionRuntime.replace(/<\/script/gi, "<\\/script")}</script>
    </body></html>`, "utf8");

    await page.goto(pathToFileURL(exportPath).href);
    const trigger = page.locator('[data-hsm-node-id="modal-trigger"]');
    await trigger.tap();
    const modal = page.locator('[data-hsm-interaction-modal="a2-modal"]');
    await modal.waitFor({ state: "visible" });
    assert.equal(await modal.getByText("先观察，再记录。").isVisible(), true);
    assert.equal(await modal.locator("img").isVisible(), true);
    assert.ok(Number(await modal.evaluate((node) => getComputedStyle(node).zIndex)) > 2147482000);

    await page.keyboard.press("Escape");
    assert.equal(await modal.isVisible(), true);
    await page.touchscreen.tap(8, 8);
    await modal.waitFor({ state: "detached" });

    await trigger.tap();
    await modal.waitFor({ state: "visible" });
    await modal.getByRole("button", { name: "关闭弹窗" }).tap();
    await modal.waitFor({ state: "detached" });
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
    await context.close();
    await browser.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("A2 真实闭环：③保存→④关闭重开→⑤版本恢复→⑥独立导出", async (t) => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "html-mender-a2-lifecycle-"));
  const previousDataDirectory = process.env.HTML_MENDER_DATA_DIR;
  process.env.HTML_MENDER_DATA_DIR = dataDirectory;
  const browser = await launchBrowser();
  const editorPage = await browser.newPage();
  editorPage.setDefaultTimeout(5000);
  let runtime = null;
  let created = null;
  let savedInteractiveHtml = "";
  try {
    const firstServerModule = await import(`../src/server.js?a2-save=${Date.now()}`);
    runtime = await firstServerModule.startServer({ host: "127.0.0.1", port: 0 });

    const sourceHtml = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>A2 生命周期</title></head><body>
      <div id="page-overlay" style="position:fixed;inset:0;z-index:2147482000;pointer-events:none">页面高层元素</div>
      <button id="trigger" type="button">打开说明</button>
      <section id="target"><h2>实验说明</h2><p>先观察，再记录。</p><img src="${TEST_IMAGE}" alt="实验图"></section>
    </body></html>`;
    const form = new FormData();
    form.append("taskName", "A2 生命周期临时任务");
    form.append("files", new Blob([sourceHtml], { type: "text/html" }), "lesson.html");
    created = await fetch(`${runtime.url}/api/upload`, { method: "POST", body: form })
      .then((response) => response.json());
    const pageRecord = created.project.pages[0];

    await editorPage.goto(`${runtime.url}${pageRecord.editUrl}`);
    await editorPage.waitForFunction(() => window.__htmlSlideMenderBootstrap?.editor?.active === true);
    savedInteractiveHtml = await editorPage.evaluate(async () => {
      const editor = window.__htmlSlideMenderBootstrap.editor;
      const trigger = document.querySelector("#trigger");
      const target = document.querySelector("#target");
      editor.enterInteractionMode();
      editor.interactionWizardKind = "click";
      editor.interactionWizardStep = 4;
      editor.interactionWizardAction = "openModal";
      editor.interactionWizardModalBackdrop = true;
      editor.interactionWizardModalEscape = false;
      editor.pendingInteractionTriggerNodeId = editor.ensureInteractionElementId(trigger);
      editor.interactionWizardTargetNodeId = editor.ensureInteractionElementId(target);
      editor.completeInteractionWizard();
      editor.stopInteractionPreview({ silent: true });
      return editor.serializeCleanHtml("basic");
    });

    await t.test("A2 ③保存：弹窗内容与关闭策略随页面版本持久化", async () => {
      const response = await fetch(`${runtime.url}/api/projects/${created.project.id}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          editRelativePath: pageRecord.editRelativePath,
          html: savedInteractiveHtml,
          note: "A2 弹窗互动"
        })
      });
      const saved = await response.json();
      assert.equal(response.status, 200);
      assert.equal(saved.version.id, "v002");
      const currentHtml = await fetch(`${runtime.url}${pageRecord.viewUrl}`).then((result) => result.text());
      assert.match(currentHtml, /"type":"openModal"/);
      assert.match(currentHtml, /"close":\{"button":true,"backdrop":true,"escape":false\}/);
      assert.match(currentHtml, /data-hsm-interaction-initial="hidden"/);
    });

    await t.test("A2 ④重开：关闭服务后编辑配置与弹窗行为均保留", async () => {
      await runtime.close();
      runtime = null;
      const restartedServerModule = await import(`../src/server.js?a2-reopen=${Date.now()}`);
      runtime = await restartedServerModule.startServer({ host: "127.0.0.1", port: 0 });
      const projects = await fetch(`${runtime.url}/api/projects`).then((response) => response.json());
      const reopened = projects.projects.find((project) => project.id === created.project.id);
      assert.ok(reopened, "重开后应能找到 A2 临时任务");
      await editorPage.goto(`${runtime.url}${reopened.pages[0].editUrl}`);
      await editorPage.waitForFunction(() => window.__htmlSlideMenderBootstrap?.editor?.active === true);
      const reopenedInteraction = await editorPage.evaluate(() => {
        const interaction = window.__htmlSlideMenderBootstrap.editor.interactions[0];
        return { type: interaction?.action?.type, close: interaction?.action?.close };
      });
      assert.deepEqual(reopenedInteraction, {
        type: "openModal",
        close: { button: true, backdrop: true, escape: false }
      });

      await editorPage.goto(`${runtime.url}${reopened.pages[0].viewUrl}`);
      await editorPage.locator("#trigger").click();
      const modal = editorPage.locator('[data-hsm-interaction-modal]');
      await modal.waitFor({ state: "visible" });
      assert.equal(await modal.getByText("先观察，再记录。").isVisible(), true);
      await modal.getByRole("button", { name: "关闭弹窗" }).click();
      await modal.waitFor({ state: "detached" });
    });

    await t.test("A2 ⑤版本恢复：从无互动版本恢复 v002 时弹窗配置同步回滚", async () => {
      const pageRecord = created.project.pages[0];
      const saveWithoutInteraction = await fetch(`${runtime.url}/api/projects/${created.project.id}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          editRelativePath: pageRecord.editRelativePath,
          html: sourceHtml,
          note: "暂时移除弹窗"
        })
      });
      const v003 = await saveWithoutInteraction.json();
      assert.equal(v003.version.id, "v003");

      const restoreResponse = await fetch(
        `${runtime.url}/api/projects/${created.project.id}/pages/${pageRecord.id}/restore`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ versionKey: `${pageRecord.id}-v002` })
        }
      );
      const restored = await restoreResponse.json();
      assert.equal(restoreResponse.status, 200);
      assert.equal(restored.version.id, "v004");
      await editorPage.goto(`${runtime.url}${pageRecord.editUrl}`);
      await editorPage.waitForFunction(() => window.__htmlSlideMenderBootstrap?.editor?.active === true);
      const restoredClose = await editorPage.evaluate(() =>
        window.__htmlSlideMenderBootstrap.editor.interactions[0]?.action?.close
      );
      assert.deepEqual(restoredClose, { button: true, backdrop: true, escape: false });
    });

    await t.test("A2 ⑥独立导出：服务停止后触摸关闭有效且 console 零报错", async () => {
      const exportResponse = await fetch(`${runtime.url}/api/projects/${created.project.id}/export`);
      assert.equal(exportResponse.status, 200);
      const exportedHtml = await exportResponse.text();
      assert.match(exportedHtml, /"type":"openModal"/);
      assert.match(exportedHtml, /"close":\{"button":true,"backdrop":true,"escape":false\}/);
      const exportPath = join(dataDirectory, "a2-restored-export.html");
      await writeFile(exportPath, exportedHtml, "utf8");

      const stoppedUrl = runtime.url;
      await runtime.close();
      runtime = null;
      await assert.rejects(fetch(`${stoppedUrl}/api/projects`));

      const context = await browser.newContext({
        hasTouch: true,
        isMobile: true,
        viewport: { width: 390, height: 844 }
      });
      const independentPage = await context.newPage();
      independentPage.setDefaultTimeout(5000);
      const errors = [];
      independentPage.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      independentPage.on("pageerror", (error) => errors.push(error.message));
      try {
        await independentPage.goto(pathToFileURL(exportPath).href);
        assert.match(independentPage.url(), /^file:/);
        await independentPage.locator("#trigger").tap();
        const modal = independentPage.locator('[data-hsm-interaction-modal]');
        await modal.waitFor({ state: "visible" });
        assert.ok(Number(await modal.evaluate((node) => getComputedStyle(node).zIndex)) > 2147482000);
        await independentPage.keyboard.press("Escape");
        assert.equal(await modal.isVisible(), true);
        await independentPage.touchscreen.tap(8, 8);
        await modal.waitFor({ state: "detached" });
        assert.deepEqual(errors, []);
      } finally {
        await independentPage.close();
        await context.close();
      }
    });
  } finally {
    if (runtime) await runtime.close();
    await editorPage.close();
    await browser.close();
    await rm(dataDirectory, { recursive: true, force: true });
    if (previousDataDirectory === undefined) {
      delete process.env.HTML_MENDER_DATA_DIR;
    } else {
      process.env.HTML_MENDER_DATA_DIR = previousDataDirectory;
    }
  }
});
