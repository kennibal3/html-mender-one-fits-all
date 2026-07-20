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

function launchBrowser() {
  const configuredExecutable = process.env.PLAYWRIGHT_CHROME_EXECUTABLE || CHROME_EXECUTABLE;
  return chromium.launch({
    ...(existsSync(configuredExecutable) ? { executablePath: configuredExecutable } : {}),
    headless: true
  });
}

async function openA1Editor(page) {
  const directory = await mkdtemp(join(tmpdir(), "html-mender-a1-editor-"));
  const sourcePath = join(directory, "lesson.html");
  const editablePath = join(directory, "lesson.editable.html");
  await writeFile(sourcePath, `<!doctype html>
<html lang="zh-CN">
  <head><meta charset="utf-8"><title>A1 设置测试</title></head>
  <body>
    <button id="trigger" type="button">显示答案</button>
    <div id="target">答案内容</div>
  </body>
</html>`, "utf8");
  await makeEditableHtml({ inputPath: sourcePath, outputPath: editablePath, lang: "zh-CN" });
  await page.goto(pathToFileURL(editablePath).href);
  await page.waitForFunction(() => window.__htmlSlideMenderBootstrap?.editor?.active === true);
  return directory;
}

test("A1 ①设置：提供显示、隐藏、切换并拦截触发器与目标自指", async () => {
  const browser = await launchBrowser();
  const page = await browser.newPage();
  let directory = "";
  try {
    directory = await openA1Editor(page);
    const choices = await page.evaluate(() => {
      const editor = window.__htmlSlideMenderBootstrap.editor;
      editor.enterInteractionMode();
      editor.beginInteractionWizard("click");
      return Array.from(editor.shadow.querySelectorAll("[data-interaction-choice]"))
        .map((button) => button.getAttribute("data-interaction-choice"));
    });
    assert.deepEqual(
      choices.filter((choice) => ["showVisibility", "hideVisibility", "toggleVisibility"].includes(choice)),
      ["showVisibility", "hideVisibility", "toggleVisibility"]
    );

    const selfReference = await page.evaluate(() => {
      const editor = window.__htmlSlideMenderBootstrap.editor;
      const trigger = document.querySelector("#trigger");
      const triggerId = editor.ensureInteractionElementId(trigger);
      editor.interactionWizardKind = "click";
      editor.interactionWizardStep = 4;
      editor.interactionWizardAction = "showVisibility";
      editor.pendingInteractionTriggerNodeId = triggerId;
      editor.interactionWizardTargetNodeId = triggerId;
      editor.completeInteractionWizard();
      return {
        interactionCount: editor.interactions.length,
        toast: editor.toastEl?.textContent || ""
      };
    });
    assert.equal(selfReference.interactionCount, 0);
    assert.match(selfReference.toast, /不能|目标|同一/);
  } finally {
    await page.close();
    await browser.close();
    if (directory) {
      await rm(directory, { recursive: true, force: true });
    }
  }
});

test("A1 ②测试预览：三种显隐动作生效且返回编辑后恢复原状态", async () => {
  const browser = await launchBrowser();
  const page = await browser.newPage();
  let directory = "";
  try {
    directory = await openA1Editor(page);
    const result = await page.evaluate(() => {
      const editor = window.__htmlSlideMenderBootstrap.editor;
      const trigger = document.querySelector("#trigger");
      const target = document.querySelector("#target");
      const triggerId = editor.ensureInteractionElementId(trigger);
      const targetId = editor.ensureInteractionElementId(target);
      editor.enterInteractionMode();
      const interaction = (type, initialTarget) => ({
        id: `a1-${type}`,
        name: type,
        trigger: { event: "click", nodeId: triggerId },
        action: { type, targetId },
        initialState: { target: initialTarget },
        effect: { type: "none", duration: 400 },
        record: { type: "interaction.activated" }
      });
      const run = (type, initialTarget) => {
        editor.interactions = [interaction(type, initialTarget)];
        const beforeStyle = target.getAttribute("style");
        editor.startInteractionPreview();
        const initialDisplay = getComputedStyle(target).display;
        const shellInPreview = editor.shell.dataset.interactionPreview;
        const panelHidden = editor.interactionPanel.hidden;
        const boxesHidden = editor.showBoxes === false && editor.layer.innerHTML === "";
        editor.activateInteractionPreview(editor.interactions[0]);
        const afterDisplay = getComputedStyle(target).display;
        editor.stopInteractionPreview({ silent: true });
        return {
          initialDisplay,
          afterDisplay,
          shellInPreview,
          panelHidden,
          boxesHidden,
          restoredStyle: target.getAttribute("style"),
          beforeStyle,
          shellAfterReturn: editor.shell.dataset.interactionPreview,
          returnedToInteractionMode: editor.shell.dataset.interactionMode
        };
      };
      return {
        show: run("showVisibility", "hidden"),
        hide: run("hideVisibility", "visible"),
        toggle: run("toggleVisibility", "hidden")
      };
    });

    assert.equal(result.show.initialDisplay, "none");
    assert.notEqual(result.show.afterDisplay, "none");
    assert.notEqual(result.hide.initialDisplay, "none");
    assert.equal(result.hide.afterDisplay, "none");
    assert.equal(result.toggle.initialDisplay, "none");
    assert.notEqual(result.toggle.afterDisplay, "none");
    for (const actionResult of Object.values(result)) {
      assert.equal(actionResult.shellInPreview, "true");
      assert.equal(actionResult.panelHidden, true);
      assert.equal(actionResult.boxesHidden, true);
      assert.equal(actionResult.restoredStyle || "", actionResult.beforeStyle || "");
      assert.equal(actionResult.shellAfterReturn, "false");
      assert.equal(actionResult.returnedToInteractionMode, "true");
    }
  } finally {
    await page.close();
    await browser.close();
    if (directory) {
      await rm(directory, { recursive: true, force: true });
    }
  }
});

test("A1 ⑥导出后独立运行：file URL 下三种动作生效且控制台零报错", async () => {
  const browser = await launchBrowser();
  const page = await browser.newPage();
  page.setDefaultTimeout(3000);
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  const directory = await mkdtemp(join(tmpdir(), "html-mender-a1-export-"));
  try {
    const interactionRuntime = await readFile(
      new URL("../vendor/html-slide-mender/assets/html-slide-mender-interactions.js", import.meta.url),
      "utf8"
    );
    const exportPath = join(directory, "a1-export.html");
    const manifest = {
      schemaVersion: "1.3",
      interactions: [
        {
          id: "show",
          trigger: { event: "click", nodeId: "show-trigger" },
          action: { type: "showVisibility", targetId: "show-target" },
          initialState: { target: "hidden" }
        },
        {
          id: "hide",
          trigger: { event: "click", nodeId: "hide-trigger" },
          action: { type: "hideVisibility", targetId: "hide-target" },
          initialState: { target: "visible" }
        },
        {
          id: "toggle",
          trigger: { event: "click", nodeId: "toggle-trigger" },
          action: { type: "toggleVisibility", targetId: "toggle-target" },
          initialState: { target: "hidden" }
        }
      ],
      sequences: []
    };
    await writeFile(exportPath, `<!doctype html>
<html><head><meta charset="utf-8"><title>A1 独立导出</title></head><body>
  <button data-hsm-node-id="show-trigger">显示</button>
  <div data-hsm-node-id="show-target" data-hsm-interaction-initial="hidden" hidden>显示目标</div>
  <button data-hsm-node-id="hide-trigger">隐藏</button>
  <div data-hsm-node-id="hide-target">隐藏目标</div>
  <button data-hsm-node-id="toggle-trigger">切换</button>
  <div data-hsm-node-id="toggle-target" data-hsm-interaction-initial="hidden" hidden>切换目标</div>
  <script type="application/json" data-hsm-interaction-manifest="1">${JSON.stringify(manifest)}</script>
  <script>${interactionRuntime.replace(/<\/script/gi, "<\\/script")}</script>
</body></html>`, "utf8");

    await page.goto(pathToFileURL(exportPath).href);
    const target = (id) => page.locator(`[data-hsm-node-id="${id}"]`);
    await assert.rejects(target("show-target").waitFor({ state: "visible", timeout: 150 }), /Timeout/);
    await target("show-trigger").click();
    await target("show-target").waitFor({ state: "visible" });
    await target("hide-target").waitFor({ state: "visible" });
    await target("hide-trigger").click();
    await target("hide-target").waitFor({ state: "hidden" });
    await assert.rejects(target("toggle-target").waitFor({ state: "visible", timeout: 150 }), /Timeout/);
    await target("toggle-trigger").click();
    await target("toggle-target").waitFor({ state: "visible" });
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
    await browser.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("A1 真实闭环：③保存→④关闭重开→⑤版本恢复→⑥独立导出", async (t) => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "html-mender-a1-lifecycle-"));
  const previousDataDirectory = process.env.HTML_MENDER_DATA_DIR;
  process.env.HTML_MENDER_DATA_DIR = dataDirectory;
  const browser = await launchBrowser();
  const editorPage = await browser.newPage();
  editorPage.setDefaultTimeout(5000);
  let runtime = null;
  let created = null;
  let savedInteractiveHtml = "";
  let exportedHtml = "";
  try {
    const firstServerModule = await import(`../src/server.js?a1-save=${Date.now()}`);
    runtime = await firstServerModule.startServer({ host: "127.0.0.1", port: 0 });

    const sourceHtml = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>A1 生命周期</title></head><body>
  <button id="trigger" type="button">显示答案</button>
  <div id="target">正确答案</div>
</body></html>`;
    const form = new FormData();
    form.append("taskName", "A1 生命周期临时任务");
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
      editor.interactionWizardAction = "showVisibility";
      editor.pendingInteractionTriggerNodeId = editor.ensureInteractionElementId(trigger);
      editor.interactionWizardTargetNodeId = editor.ensureInteractionElementId(target);
      editor.completeInteractionWizard();
      editor.stopInteractionPreview({ silent: true });
      return editor.serializeCleanHtml("basic");
    });

    await t.test("A1 ③保存：互动清单与初始隐藏随页面版本持久化", async () => {
      const response = await fetch(`${runtime.url}/api/projects/${created.project.id}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          editRelativePath: pageRecord.editRelativePath,
          html: savedInteractiveHtml,
          note: "A1 显示互动"
        })
      });
      const saved = await response.json();
      assert.equal(response.status, 200);
      assert.equal(saved.version.id, "v002");
      const currentHtml = await fetch(`${runtime.url}${pageRecord.viewUrl}`).then((result) => result.text());
      assert.match(currentHtml, /"type":"showVisibility"/);
      assert.match(currentHtml, /data-hsm-interaction-initial="hidden"/);
      assert.match(currentHtml, /\shidden(?:\s|>)/);
    });

    await t.test("A1 ④重开：关闭服务后从同一工作区重开仍保留配置与行为", async () => {
      await runtime.close();
      runtime = null;
      const restartedServerModule = await import(`../src/server.js?a1-reopen=${Date.now()}`);
      runtime = await restartedServerModule.startServer({ host: "127.0.0.1", port: 0 });
      const projects = await fetch(`${runtime.url}/api/projects`).then((response) => response.json());
      const reopened = projects.projects.find((project) => project.id === created.project.id);
      assert.ok(reopened, "重开后应能找到 A1 临时任务");
      assert.equal(reopened.pages[0].latestVersionId, "v002");
      await editorPage.goto(`${runtime.url}${reopened.pages[0].editUrl}`);
      await editorPage.waitForFunction(() => window.__htmlSlideMenderBootstrap?.editor?.active === true);
      const reopenedActions = await editorPage.evaluate(() =>
        window.__htmlSlideMenderBootstrap.editor.interactions.map((interaction) => interaction.action.type)
      );
      assert.deepEqual(reopenedActions, ["showVisibility"]);
      await editorPage.goto(`${runtime.url}${reopened.pages[0].viewUrl}`);
      const target = editorPage.locator("#target");
      await target.waitFor({ state: "hidden" });
      await editorPage.locator("#trigger").click();
      await target.waitFor({ state: "visible" });
    });

    await t.test("A1 ⑤版本恢复：从无互动版本恢复 v002 时互动同步回滚", async () => {
      const pageRecord = created.project.pages[0];
      const saveWithoutInteraction = await fetch(`${runtime.url}/api/projects/${created.project.id}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          editRelativePath: pageRecord.editRelativePath,
          html: sourceHtml,
          note: "暂时移除互动"
        })
      });
      const v003 = await saveWithoutInteraction.json();
      assert.equal(saveWithoutInteraction.status, 200);
      assert.equal(v003.version.id, "v003");
      const withoutInteraction = await fetch(`${runtime.url}${pageRecord.viewUrl}`).then((result) => result.text());
      assert.doesNotMatch(withoutInteraction, /data-hsm-interaction-manifest/);

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
      const restoredHtml = await fetch(`${runtime.url}${pageRecord.viewUrl}`).then((result) => result.text());
      assert.match(restoredHtml, /"type":"showVisibility"/);
      await editorPage.goto(`${runtime.url}${pageRecord.viewUrl}`);
      const target = editorPage.locator("#target");
      await target.waitFor({ state: "hidden" });
      await editorPage.locator("#trigger").click();
      await target.waitFor({ state: "visible" });
    });

    await t.test("A1 ⑥独立导出：服务停止后 file URL 点击生效且 console 零报错", async () => {
      const exportResponse = await fetch(`${runtime.url}/api/projects/${created.project.id}/export`);
      assert.equal(exportResponse.status, 200);
      assert.match(exportResponse.headers.get("content-type") || "", /text\/html/);
      exportedHtml = await exportResponse.text();
      assert.match(exportedHtml, /"type":"showVisibility"/);
      assert.match(exportedHtml, /data-hsm-interaction-initial="hidden"/);
      assert.match(exportedHtml, /\shidden(?:\s|>)/);
      const exportPath = join(dataDirectory, "a1-restored-export.html");
      await writeFile(exportPath, exportedHtml, "utf8");

      const stoppedUrl = runtime.url;
      await runtime.close();
      runtime = null;
      await assert.rejects(fetch(`${stoppedUrl}/api/projects`));

      const independentPage = await browser.newPage();
      independentPage.setDefaultTimeout(5000);
      const errors = [];
      independentPage.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      independentPage.on("pageerror", (error) => errors.push(error.message));
      try {
        await independentPage.goto(pathToFileURL(exportPath).href);
        assert.match(independentPage.url(), /^file:/);
        const target = independentPage.locator("#target");
        await target.waitFor({ state: "hidden" });
        await independentPage.locator("#trigger").click();
        await target.waitFor({ state: "visible" });
        assert.deepEqual(errors, []);
      } finally {
        await independentPage.close();
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
