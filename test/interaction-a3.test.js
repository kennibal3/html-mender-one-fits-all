import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { chromium } from "playwright";
import unzipper from "unzipper";

const CHROME_EXECUTABLE = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

function launchBrowser() {
  const configuredExecutable = process.env.PLAYWRIGHT_CHROME_EXECUTABLE || CHROME_EXECUTABLE;
  return chromium.launch({
    ...(existsSync(configuredExecutable) ? { executablePath: configuredExecutable } : {}),
    headless: true
  });
}

async function extractZip(bytes, directory) {
  const archive = await unzipper.Open.buffer(Buffer.from(bytes));
  for (const entry of archive.files) {
    const destination = join(directory, entry.path);
    if (entry.type === "Directory") {
      await mkdir(destination, { recursive: true });
      continue;
    }
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, await entry.buffer());
  }
}

async function exportProject(runtime, projectId, directory, singlePageRelativePath = "") {
  const response = await fetch(`${runtime.url}/api/projects/${projectId}/export`);
  assert.equal(response.status, 200);
  const contentType = response.headers.get("content-type") || "";
  if (/application\/zip/.test(contentType)) {
    await extractZip(await response.arrayBuffer(), directory);
    return;
  }
  assert.match(contentType, /text\/html/);
  assert.ok(singlePageRelativePath, "单页 HTML 导出必须提供写入路径");
  const destination = join(directory, singlePageRelativePath);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, Buffer.from(await response.arrayBuffer()));
}

test("A3 页面跳转完整生命周期与目标页删除降级", async (t) => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "html-mender-a3-lifecycle-"));
  const previousDataDirectory = process.env.HTML_MENDER_DATA_DIR;
  process.env.HTML_MENDER_DATA_DIR = dataDirectory;
  const browser = await launchBrowser();
  const editorPage = await browser.newPage();
  editorPage.setDefaultTimeout(5000);
  let runtime = null;
  let created = null;
  let savedInteractiveHtml = "";

  try {
    const firstServerModule = await import(`../src/server.js?a3-save=${Date.now()}`);
    runtime = await firstServerModule.startServer({ host: "127.0.0.1", port: 0 });

    const firstSource = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>A3 第一页</title></head><body>
      <button id="trigger" type="button">进入实验页</button>
      <p>尚未保存的第一页内容</p>
    </body></html>`;
    const secondSource = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>A3 第二页</title></head><body>
      <h1 id="destination">创新实验页</h1>
    </body></html>`;
    const form = new FormData();
    form.append("taskName", "A3 生命周期临时任务");
    form.append("files", new Blob([firstSource], { type: "text/html" }), "lesson-1.html");
    form.append("files", new Blob([secondSource], { type: "text/html" }), "lesson-2.html");
    created = await fetch(`${runtime.url}/api/upload`, { method: "POST", body: form })
      .then((response) => response.json());
    const [firstPage, secondPage] = created.project.pages;

    await t.test("A3 ①设置：仅可选择其他有效页面，失效目标被明确拦截", async () => {
      await editorPage.goto(`${runtime.url}${firstPage.editUrl}`);
      await editorPage.waitForFunction(() => window.__htmlSlideMenderBootstrap?.editor?.active === true);
      const result = await editorPage.evaluate(({ targetPageId }) => {
        const editor = window.__htmlSlideMenderBootstrap.editor;
        const trigger = document.querySelector("#trigger");
        editor.enterInteractionMode();
        editor.interactionWizardKind = "click";
        editor.interactionWizardStep = 3;
        editor.interactionWizardAction = "goToPage";
        editor.pendingInteractionTriggerNodeId = editor.ensureInteractionElementId(trigger);
        editor.interactionWizardPageId = "missing-page";
        editor.advanceInteractionWizard();
        const invalid = {
          step: editor.interactionWizardStep,
          toast: editor.toastEl?.textContent || ""
        };

        const selectablePages = editor.interactionPages()
          .filter((page) => !page.current)
          .map((page) => page.id);
        editor.interactionWizardPageId = targetPageId;
        editor.advanceInteractionWizard();
        editor.completeInteractionWizard();
        const interaction = editor.interactions[0];
        return {
          invalid,
          selectablePages,
          interaction,
          previewActive: editor.shell.dataset.interactionPreview
        };
      }, { targetPageId: secondPage.id });

      assert.equal(result.invalid.step, 3);
      assert.match(result.invalid.toast, /页面|选择|可跳转/);
      assert.deepEqual(result.selectablePages, [secondPage.id]);
      assert.equal(result.interaction.action.type, "goToPage");
      assert.equal(result.interaction.action.pageId, secondPage.id);
      assert.equal(result.interaction.action.pageLabel, "第 2 页");
      assert.equal(result.interaction.action.href, secondPage.sourceRelativePath);
      assert.equal(result.previewActive, "true");
    });

    await t.test("A3 ②测试预览：只提示目标页、不离开未保存页面，返回后恢复编辑态", async () => {
      const beforeUrl = editorPage.url();
      const result = await editorPage.evaluate(() => {
        const editor = window.__htmlSlideMenderBootstrap.editor;
        document.querySelector("#trigger").click();
        const during = {
          href: location.href,
          toast: editor.toastEl?.textContent || "",
          previewActive: editor.shell.dataset.interactionPreview,
          panelHidden: editor.interactionPanel.hidden,
          boxesHidden: editor.showBoxes === false && editor.layer.innerHTML === "",
          toolbarVisible: !editor.shadow.querySelector('[data-role="interaction-preview-toolbar"]').hidden
        };
        editor.stopInteractionPreview({ silent: true });
        const after = {
          previewActive: editor.shell.dataset.interactionPreview,
          interactionMode: editor.shell.dataset.interactionMode
        };
        return { during, after };
      });

      assert.equal(result.during.href, beforeUrl);
      assert.match(result.during.toast, /第 2 页/);
      assert.equal(result.during.previewActive, "true");
      assert.equal(result.during.panelHidden, true);
      assert.equal(result.during.boxesHidden, true);
      assert.equal(result.during.toolbarVisible, true);
      assert.deepEqual(result.after, { previewActive: "false", interactionMode: "true" });
      savedInteractiveHtml = await editorPage.evaluate(() =>
        window.__htmlSlideMenderBootstrap.editor.serializeCleanHtml("basic")
      );
    });

    await t.test("A3 ③保存：目标页 ID、标签和相对路径随页面版本持久化", async () => {
      const response = await fetch(`${runtime.url}/api/projects/${created.project.id}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          editRelativePath: firstPage.editRelativePath,
          html: savedInteractiveHtml,
          note: "A3 页面跳转互动"
        })
      });
      const saved = await response.json();
      assert.equal(response.status, 200);
      assert.equal(saved.version.id, "v002");
      const currentHtml = await fetch(`${runtime.url}${firstPage.viewUrl}`).then((result) => result.text());
      assert.match(currentHtml, /"type":"goToPage"/);
      assert.match(currentHtml, new RegExp(`"pageId":"${secondPage.id}"`));
      assert.match(currentHtml, /"pageLabel":"第 2 页"/);
    });

    await t.test("A3 ④重开：关闭服务后从同一工作区重开仍保留跳页配置", async () => {
      await runtime.close();
      runtime = null;
      const reopenedServerModule = await import(`../src/server.js?a3-reopen=${Date.now()}`);
      runtime = await reopenedServerModule.startServer({ host: "127.0.0.1", port: 0 });
      const projects = await fetch(`${runtime.url}/api/projects`).then((response) => response.json());
      const reopened = projects.projects.find((project) => project.id === created.project.id);
      assert.ok(reopened, "重开后应能找到 A3 临时任务");
      await editorPage.goto(`${runtime.url}${reopened.pages[0].editUrl}`);
      await editorPage.waitForFunction(() => window.__htmlSlideMenderBootstrap?.editor?.active === true);
      const action = await editorPage.evaluate(() =>
        window.__htmlSlideMenderBootstrap.editor.interactions[0]?.action
      );
      assert.equal(action.type, "goToPage");
      assert.equal(action.pageId, secondPage.id);
      assert.equal(action.href, secondPage.sourceRelativePath);
    });

    await t.test("A3 ⑤版本恢复：恢复旧版本时跳页配置一并回滚", async () => {
      const saveWithoutInteraction = await fetch(`${runtime.url}/api/projects/${created.project.id}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          editRelativePath: firstPage.editRelativePath,
          html: firstSource,
          note: "暂时移除页面跳转"
        })
      }).then((response) => response.json());
      assert.equal(saveWithoutInteraction.version.id, "v003");

      const restoreResponse = await fetch(
        `${runtime.url}/api/projects/${created.project.id}/pages/${firstPage.id}/restore`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ versionKey: `${firstPage.id}-v002` })
        }
      );
      const restored = await restoreResponse.json();
      assert.equal(restoreResponse.status, 200);
      assert.equal(restored.version.id, "v004");
      await editorPage.goto(`${runtime.url}${firstPage.editUrl}`);
      await editorPage.waitForFunction(() => window.__htmlSlideMenderBootstrap?.editor?.active === true);
      assert.equal(await editorPage.evaluate(() =>
        window.__htmlSlideMenderBootstrap.editor.interactions[0]?.action?.type
      ), "goToPage");
    });

    await t.test("A3 ⑥独立导出：停止本地服务后从 file URL 跳到正确页面且 console 零报错", async () => {
      const exportDirectory = join(dataDirectory, "a3-valid-export");
      await mkdir(exportDirectory, { recursive: true });
      await exportProject(runtime, created.project.id, exportDirectory);
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
      try {
        const firstPath = join(exportDirectory, firstPage.sourceRelativePath);
        const secondPath = join(exportDirectory, secondPage.sourceRelativePath);
        await independentPage.goto(pathToFileURL(firstPath).href);
        assert.match(independentPage.url(), /^file:/);
        await independentPage.locator("#trigger").click();
        await independentPage.waitForURL(pathToFileURL(secondPath).href);
        assert.equal(await independentPage.locator("#destination").textContent(), "创新实验页");
        assert.deepEqual(errors, []);
      } finally {
        await independentPage.close();
      }
    });

    await t.test("A3 删除降级：普通删除受保护，强制删除自动停用引用且可由历史恢复", async () => {
      const deleteServerModule = await import(`../src/server.js?a3-delete=${Date.now()}`);
      runtime = await deleteServerModule.startServer({ host: "127.0.0.1", port: 0 });

      const protectedResponse = await fetch(
        `${runtime.url}/api/projects/${created.project.id}/pages/${secondPage.id}`,
        { method: "DELETE" }
      );
      const protectedDelete = await protectedResponse.json();
      assert.equal(protectedResponse.status, 409);
      assert.match(protectedDelete.error, /引用|跳转/);
      assert.match(protectedDelete.error, /停用/);
      assert.equal(protectedDelete.references.some((reference) => reference.pageId === firstPage.id), true);

      const forcedResponse = await fetch(
        `${runtime.url}/api/projects/${created.project.id}/pages/${secondPage.id}?force=true`,
        { method: "DELETE" }
      );
      const forced = await forcedResponse.json();
      assert.equal(forcedResponse.status, 200);
      assert.equal(forced.disabledPageJumps.length, 1);
      assert.equal(forced.disabledPageJumps[0].pageId, firstPage.id);
      assert.equal(forced.project.pages[0].latestVersionId, "v005");
      const disabledHtml = await fetch(`${runtime.url}${firstPage.viewUrl}`).then((response) => response.text());
      assert.doesNotMatch(disabledHtml, /"type":"goToPage"/);

      await editorPage.goto(`${runtime.url}${firstPage.editUrl}`);
      await editorPage.waitForFunction(() => window.__htmlSlideMenderBootstrap?.editor?.active === true);
      assert.deepEqual(await editorPage.evaluate(() =>
        window.__htmlSlideMenderBootstrap.editor.interactions
      ), []);

      const degradedExportDirectory = join(dataDirectory, "a3-degraded-export");
      await mkdir(degradedExportDirectory, { recursive: true });
      await exportProject(runtime, created.project.id, degradedExportDirectory, firstPage.sourceRelativePath);
      const stoppedUrl = runtime.url;
      await runtime.close();
      runtime = null;
      await assert.rejects(fetch(`${stoppedUrl}/api/projects`));

      const degradedPage = await browser.newPage();
      const errors = [];
      degradedPage.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      degradedPage.on("pageerror", (error) => errors.push(error.message));
      try {
        const firstPath = join(degradedExportDirectory, firstPage.sourceRelativePath);
        await degradedPage.goto(pathToFileURL(firstPath).href);
        const beforeClick = degradedPage.url();
        await degradedPage.locator("#trigger").click();
        await degradedPage.waitForTimeout(100);
        assert.equal(degradedPage.url(), beforeClick);
        assert.deepEqual(errors, []);
      } finally {
        await degradedPage.close();
      }

      const restoreServerModule = await import(`../src/server.js?a3-restore-deleted=${Date.now()}`);
      runtime = await restoreServerModule.startServer({ host: "127.0.0.1", port: 0 });
      const restorePageResponse = await fetch(
        `${runtime.url}/api/projects/${created.project.id}/deleted-pages/${secondPage.id}/restore`,
        { method: "POST" }
      );
      assert.equal(restorePageResponse.status, 200);
      await editorPage.goto(`${runtime.url}${firstPage.editUrl}`);
      await editorPage.waitForFunction(() => window.__htmlSlideMenderBootstrap?.editor?.active === true);
      assert.deepEqual(await editorPage.evaluate(() =>
        window.__htmlSlideMenderBootstrap.editor.interactions
      ), [], "恢复目标页后不应自动恢复已停用互动");

      const restoreInteractionResponse = await fetch(
        `${runtime.url}/api/projects/${created.project.id}/pages/${firstPage.id}/restore`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ versionKey: `${firstPage.id}-v002` })
        }
      );
      assert.equal(restoreInteractionResponse.status, 200);
      await editorPage.goto(`${runtime.url}${firstPage.editUrl}`);
      await editorPage.waitForFunction(() => window.__htmlSlideMenderBootstrap?.editor?.active === true);
      assert.equal(await editorPage.evaluate(() =>
        window.__htmlSlideMenderBootstrap.editor.interactions[0]?.action?.type
      ), "goToPage");
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
