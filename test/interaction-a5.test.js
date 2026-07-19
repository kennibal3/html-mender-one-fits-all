import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { chromium } from "playwright";

const CHROME_EXECUTABLE = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

function launchBrowser() {
  const configuredExecutable = process.env.PLAYWRIGHT_CHROME_EXECUTABLE || CHROME_EXECUTABLE;
  return chromium.launch({
    ...(existsSync(configuredExecutable) ? { executablePath: configuredExecutable } : {}),
    headless: true
  });
}

test("A5 ⑥导出冲突防御：点击触发器不被逐步隐藏", async () => {
  const browser = await launchBrowser();
  const page = await browser.newPage();
  const directory = await mkdtemp(join(tmpdir(), "html-mender-a5-conflict-export-"));
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  try {
    const interactionRuntime = await readFile(
      new URL("../vendor/html-slide-mender/assets/html-slide-mender-interactions.js", import.meta.url),
      "utf8"
    );
    const exportPath = join(directory, "a5-conflict.html");
    const manifest = {
      schemaVersion: "1.3",
      interactions: [{
        id: "show-answer",
        trigger: { event: "click", nodeId: "conflict-trigger" },
        action: { type: "showVisibility", targetId: "answer" },
        initialState: { target: "hidden" },
        effect: { type: "none", duration: 400 }
      }],
      sequences: [{
        id: "conflicting-sequence",
        name: "冲突逐步讲解",
        trigger: { type: "pageAdvance", events: ["click", "Space", "ArrowRight"] },
        steps: [
          { id: "conflict-step", nodeId: "conflict-trigger", effect: { type: "none", duration: 400 } },
          { id: "safe-step", nodeId: "safe-step", effect: { type: "none", duration: 400 } }
        ]
      }]
    };
    await writeFile(exportPath, `<!doctype html><html><head><meta charset="utf-8"><title>A5 冲突防御</title></head><body>
      <button data-hsm-node-id="conflict-trigger" id="conflict-trigger">显示答案</button>
      <p data-hsm-node-id="answer" id="answer">答案内容</p>
      <p data-hsm-node-id="safe-step" id="safe-step">安全步骤</p>
      <div id="advance-area">继续讲解</div>
      <script type="application/json" data-hsm-interaction-manifest="1">${JSON.stringify(manifest)}</script>
      <script>${interactionRuntime.replace(/<\/script/gi, "<\\/script")}</script>
    </body></html>`, "utf8");

    await page.goto(pathToFileURL(exportPath).href);
    await page.locator("#conflict-trigger").waitFor({ state: "visible" });
    await page.locator("#safe-step").waitFor({ state: "hidden" });
    await page.locator("#answer").waitFor({ state: "hidden" });
    await page.locator("#conflict-trigger").click();
    await page.locator("#answer").waitFor({ state: "visible" });
    await page.locator("#safe-step").waitFor({ state: "hidden" });
    await page.locator("#advance-area").click();
    await page.locator("#safe-step").waitFor({ state: "visible" });
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
    await browser.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("A5 逐步讲解完整生命周期", async (t) => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "html-mender-a5-lifecycle-"));
  const previousDataDirectory = process.env.HTML_MENDER_DATA_DIR;
  process.env.HTML_MENDER_DATA_DIR = dataDirectory;
  const browser = await launchBrowser();
  const editorPage = await browser.newPage();
  editorPage.setDefaultTimeout(5000);
  let runtime = null;
  let created = null;
  let savedInteractiveHtml = "";

  const sourceHtml = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>A5 生命周期</title></head><body>
    <button id="native-control" type="button">普通按钮</button>
    <div id="conflict-target">按钮目标</div>
    <p id="step-1">第一步：观察现象</p>
    <p id="step-2">第二步：提出假设</p>
    <p id="step-3">第三步：验证结论</p>
    <div id="advance-area">点击空白处继续</div>
  </body></html>`;

  try {
    const firstServerModule = await import(`../src/server.js?a5-save=${Date.now()}`);
    runtime = await firstServerModule.startServer({ host: "127.0.0.1", port: 0 });
    const form = new FormData();
    form.append("taskName", "A5 生命周期临时任务");
    form.append("files", new Blob([sourceHtml], { type: "text/html" }), "lesson.html");
    created = await fetch(`${runtime.url}/api/upload`, { method: "POST", body: form })
      .then((response) => response.json());
    const pageRecord = created.project.pages[0];

    await t.test("A5 ①设置：冲突不留空配置，并支持添加、排序、删除和效果调整", async () => {
      await editorPage.goto(`${runtime.url}${pageRecord.editUrl}`);
      await editorPage.waitForFunction(() => window.__htmlSlideMenderBootstrap?.editor?.active === true);
      const result = await editorPage.evaluate(() => {
        const editor = window.__htmlSlideMenderBootstrap.editor;
        const itemFor = (element) => Array.from(editor.items.values()).find((item) => item.element === element);
        const selectOnly = (element) => {
          const item = itemFor(element);
          editor.selectedId = item.id;
          editor.selectedIds = new Set([item.id]);
        };
        const nativeControl = document.querySelector("#native-control");
        const conflictTarget = document.querySelector("#conflict-target");
        const nativeControlId = editor.ensureInteractionElementId(nativeControl);

        editor.enterInteractionMode();
        editor.interactionWizardKind = "click";
        editor.interactionWizardStep = 4;
        editor.interactionWizardAction = "showVisibility";
        editor.pendingInteractionTriggerNodeId = nativeControlId;
        editor.interactionWizardTargetNodeId = editor.ensureInteractionElementId(conflictTarget);
        editor.completeInteractionWizard();
        editor.stopInteractionPreview({ silent: true });

        editor.interactionWizardKind = "sequence";
        selectOnly(nativeControl);
        editor.addSelectedItemsToSequence();
        const blockedConflict = {
          sequenceCount: editor.sequences.length,
          toast: editor.toastEl?.textContent || ""
        };
        editor.interactions = [];
        conflictTarget.removeAttribute("data-hsm-interaction-initial");

        const addStep = (selector) => {
          selectOnly(document.querySelector(selector));
          editor.addSelectedItemsToSequence();
        };
        addStep("#step-1");
        addStep("#step-2");
        addStep("#step-3");
        addStep("#step-1");
        const duplicateCount = editor.pageSequence().steps.length;

        const sequence = editor.pageSequence();
        const step1 = sequence.steps.find((step) => editor.interactionElement(step.nodeId)?.id === "step-1");
        const step2 = sequence.steps.find((step) => editor.interactionElement(step.nodeId)?.id === "step-2");
        const step3 = sequence.steps.find((step) => editor.interactionElement(step.nodeId)?.id === "step-3");
        editor.moveSequenceStep(step3.id, -1);
        const afterMove = sequence.steps.map((step) => editor.interactionElement(step.nodeId).id);
        editor.moveSequenceStep(step3.id, 1);
        editor.deleteSequenceStep(step2.id);
        const afterDelete = sequence.steps.map((step) => editor.interactionElement(step.nodeId).id);
        addStep("#step-2");
        const readdedStep2 = sequence.steps.find((step) => editor.interactionElement(step.nodeId)?.id === "step-2");
        editor.moveSequenceStep(readdedStep2.id, -1);
        editor.updateSequenceStep(step1.id, "effect", "fadeIn");
        editor.updateSequenceStep(step1.id, "duration", 250);
        editor.updateSequenceStep(readdedStep2.id, "effect", "flyIn");
        editor.updateSequenceStep(readdedStep2.id, "duration", 350);
        editor.updateSequenceStep(step3.id, "effect", "zoomIn");
        editor.updateSequenceStep(step3.id, "duration", 450);
        editor.interactionWizardKind = "sequence";
        editor.completeInteractionWizard();

        return {
          blockedConflict,
          duplicateCount,
          afterMove,
          afterDelete,
          finalOrder: editor.pageSequence().steps.map((step) => editor.interactionElement(step.nodeId).id),
          effects: editor.pageSequence().steps.map((step) => step.effect),
          previewActive: editor.shell.dataset.interactionPreview
        };
      });

      assert.equal(result.blockedConflict.sequenceCount, 0);
      assert.match(result.blockedConflict.toast, /点击按钮|逐步|不能/);
      assert.equal(result.duplicateCount, 3);
      assert.deepEqual(result.afterMove, ["step-1", "step-3", "step-2"]);
      assert.deepEqual(result.afterDelete, ["step-1", "step-3"]);
      assert.deepEqual(result.finalOrder, ["step-1", "step-2", "step-3"]);
      assert.deepEqual(result.effects, [
        { type: "fadeIn", duration: 250 },
        { type: "flyIn", duration: 350 },
        { type: "zoomIn", duration: 450 }
      ]);
      assert.equal(result.previewActive, "true");
    });

    await t.test("A5 ②测试预览：点击、空格和右方向键依次显示，普通控件不误推进", async () => {
      const step = (id) => editorPage.locator(id);
      await step("#step-1").waitFor({ state: "hidden" });
      await step("#step-2").waitFor({ state: "hidden" });
      await step("#step-3").waitFor({ state: "hidden" });
      await editorPage.locator("#native-control").click();
      await step("#step-1").waitFor({ state: "hidden" });
      await editorPage.locator("#advance-area").click();
      await step("#step-1").waitFor({ state: "visible" });
      await step("#step-2").waitFor({ state: "hidden" });
      await editorPage.locator("body").press("Space");
      await step("#step-2").waitFor({ state: "visible" });
      await step("#step-3").waitFor({ state: "hidden" });
      await editorPage.locator("body").press("ArrowRight");
      await step("#step-3").waitFor({ state: "visible" });

      const returned = await editorPage.evaluate(() => {
        const editor = window.__htmlSlideMenderBootstrap.editor;
        const progress = editor.toastEl?.textContent || "";
        editor.stopInteractionPreview({ silent: true });
        return {
          progress,
          previewActive: editor.shell.dataset.interactionPreview,
          interactionMode: editor.shell.dataset.interactionMode,
          displays: ["#step-1", "#step-2", "#step-3"].map((selector) =>
            getComputedStyle(document.querySelector(selector)).display
          )
        };
      });
      assert.match(returned.progress, /第 3 项|3.*3/);
      assert.equal(returned.previewActive, "false");
      assert.equal(returned.interactionMode, "true");
      assert.equal(returned.displays.every((display) => display !== "none"), true);
      savedInteractiveHtml = await editorPage.evaluate(() =>
        window.__htmlSlideMenderBootstrap.editor.serializeCleanHtml("basic")
      );
    });

    await t.test("A5 ③保存：步骤顺序与效果随页面版本持久化", async () => {
      const response = await fetch(`${runtime.url}/api/projects/${created.project.id}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          editRelativePath: pageRecord.editRelativePath,
          html: savedInteractiveHtml,
          note: "A5 逐步讲解互动"
        })
      });
      const saved = await response.json();
      assert.equal(response.status, 200);
      assert.equal(saved.version.id, "v002");
      const currentHtml = await fetch(`${runtime.url}${pageRecord.viewUrl}`).then((result) => result.text());
      assert.match(currentHtml, /"sequences":\[\{/);
      assert.match(currentHtml, /"events":\["click","Space","ArrowRight"\]/);
      assert.match(currentHtml, /"type":"fadeIn","duration":250/);
      assert.match(currentHtml, /"type":"flyIn","duration":350/);
      assert.match(currentHtml, /"type":"zoomIn","duration":450/);
    });

    await t.test("A5 ④重开：关闭服务后步骤顺序、效果和预览行为均保留", async () => {
      await runtime.close();
      runtime = null;
      const reopenedServerModule = await import(`../src/server.js?a5-reopen=${Date.now()}`);
      runtime = await reopenedServerModule.startServer({ host: "127.0.0.1", port: 0 });
      const projects = await fetch(`${runtime.url}/api/projects`).then((response) => response.json());
      const reopened = projects.projects.find((project) => project.id === created.project.id);
      assert.ok(reopened, "重开后应能找到 A5 临时任务");
      await editorPage.goto(`${runtime.url}${reopened.pages[0].editUrl}`);
      await editorPage.waitForFunction(() => window.__htmlSlideMenderBootstrap?.editor?.active === true);
      const reopenedSequence = await editorPage.evaluate(() => {
        const editor = window.__htmlSlideMenderBootstrap.editor;
        const sequence = editor.pageSequence();
        editor.enterInteractionMode();
        editor.startInteractionPreview();
        const initiallyHidden = sequence.steps.map((step) =>
          getComputedStyle(editor.interactionElement(step.nodeId)).display === "none"
        );
        editor.advanceInteractionPreviewSequence();
        const firstVisible = getComputedStyle(editor.interactionElement(sequence.steps[0].nodeId)).display !== "none";
        editor.stopInteractionPreview({ silent: true });
        return {
          order: sequence.steps.map((step) => editor.interactionElement(step.nodeId).id),
          effects: sequence.steps.map((step) => step.effect),
          initiallyHidden,
          firstVisible
        };
      });
      assert.deepEqual(reopenedSequence.order, ["step-1", "step-2", "step-3"]);
      assert.deepEqual(reopenedSequence.effects, [
        { type: "fadeIn", duration: 250 },
        { type: "flyIn", duration: 350 },
        { type: "zoomIn", duration: 450 }
      ]);
      assert.deepEqual(reopenedSequence.initiallyHidden, [true, true, true]);
      assert.equal(reopenedSequence.firstVisible, true);
    });

    await t.test("A5 ⑤版本恢复：恢复旧版本时逐步讲解配置一并回滚", async () => {
      const saveWithoutInteraction = await fetch(`${runtime.url}/api/projects/${created.project.id}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          editRelativePath: pageRecord.editRelativePath,
          html: sourceHtml,
          note: "暂时移除逐步讲解"
        })
      }).then((response) => response.json());
      assert.equal(saveWithoutInteraction.version.id, "v003");

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
      assert.deepEqual(await editorPage.evaluate(() => {
        const editor = window.__htmlSlideMenderBootstrap.editor;
        return editor.pageSequence().steps.map((step) => editor.interactionElement(step.nodeId).id);
      }), ["step-1", "step-2", "step-3"]);
    });

    await t.test("A5 ⑥独立导出：停止服务后可从第一步走到最后一步且 console 零报错", async () => {
      const response = await fetch(`${runtime.url}/api/projects/${created.project.id}/export`);
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type") || "", /text\/html/);
      const exportPath = join(dataDirectory, "a5-restored-export.html");
      await writeFile(exportPath, Buffer.from(await response.arrayBuffer()));
      const stoppedUrl = runtime.url;
      await runtime.close();
      runtime = null;
      await assert.rejects(fetch(`${stoppedUrl}/api/projects`));

      const independentPage = await browser.newPage();
      const errors = [];
      independentPage.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      independentPage.on("pageerror", (error) => errors.push(error.message));
      await independentPage.addInitScript(() => {
        window.__a5Events = [];
        window.addEventListener("hsm-interaction-event", (event) => window.__a5Events.push(event.detail));
      });
      try {
        await independentPage.goto(pathToFileURL(exportPath).href);
        const step = (id) => independentPage.locator(id);
        await step("#step-1").waitFor({ state: "hidden" });
        await step("#step-2").waitFor({ state: "hidden" });
        await step("#step-3").waitFor({ state: "hidden" });
        await independentPage.locator("#native-control").click();
        await step("#step-1").waitFor({ state: "hidden" });
        await independentPage.locator("#advance-area").click();
        await step("#step-1").waitFor({ state: "visible" });
        await step("#step-2").waitFor({ state: "hidden" });
        await independentPage.locator("body").press("Space");
        await step("#step-2").waitFor({ state: "visible" });
        await step("#step-3").waitFor({ state: "hidden" });
        await independentPage.locator("body").press("ArrowRight");
        await step("#step-3").waitFor({ state: "visible" });
        const events = await independentPage.evaluate(() => window.__a5Events);
        assert.equal(events.filter((event) => event.type === "sequence.started").length, 1);
        assert.equal(events.filter((event) => event.type === "sequence.step").length, 3);
        assert.equal(events.filter((event) => event.type === "sequence.completed").length, 1);
        assert.deepEqual(events.filter((event) => event.type === "sequence.step").map((event) => event.payload.stepIndex), [1, 2, 3]);
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
