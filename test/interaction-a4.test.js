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

test("A4 ⑥非法导出配置：危险协议不执行且不伪装成可点击链接", async () => {
  const browser = await launchBrowser();
  const page = await browser.newPage();
  const directory = await mkdtemp(join(tmpdir(), "html-mender-a4-invalid-export-"));
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
    const exportPath = join(directory, "a4-invalid.html");
    const unsafeUrls = ["", "javascript:alert(1)", "data:text/html,unsafe", "file:///tmp/unsafe.html"];
    const manifest = {
      schemaVersion: "1.3",
      interactions: unsafeUrls.map((href, index) => ({
        id: `invalid-${index}`,
        trigger: { event: "click", nodeId: `trigger-${index}` },
        action: { type: "openUrl", href, newWindow: true },
        initialState: { target: "visible" }
      })),
      sequences: []
    };
    await writeFile(exportPath, `<!doctype html><html><head><meta charset="utf-8"><title>A4 非法网址</title></head><body>
      ${unsafeUrls.map((_href, index) => `<div data-hsm-node-id="trigger-${index}">非法链接 ${index + 1}</div>`).join("\n")}
      <script type="application/json" data-hsm-interaction-manifest="1">${JSON.stringify(manifest)}</script>
      <script>${interactionRuntime.replace(/<\/script/gi, "<\\/script")}</script>
    </body></html>`, "utf8");

    await page.goto(pathToFileURL(exportPath).href);
    const beforeUrl = page.url();
    const triggerStates = await page.locator('[data-hsm-node-id^="trigger-"]').evaluateAll((nodes) =>
      nodes.map((node) => ({ role: node.getAttribute("role"), tabindex: node.getAttribute("tabindex") }))
    );
    assert.deepEqual(triggerStates, unsafeUrls.map(() => ({ role: null, tabindex: null })));
    for (let index = 0; index < unsafeUrls.length; index += 1) {
      await page.locator(`[data-hsm-node-id="trigger-${index}"]`).click();
      assert.equal(page.url(), beforeUrl);
    }
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
    await browser.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("A4 网址跳转完整生命周期", async (t) => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "html-mender-a4-lifecycle-"));
  const previousDataDirectory = process.env.HTML_MENDER_DATA_DIR;
  process.env.HTML_MENDER_DATA_DIR = dataDirectory;
  const browser = await launchBrowser();
  const editorPage = await browser.newPage();
  editorPage.setDefaultTimeout(5000);
  let runtime = null;
  let created = null;
  let savedInteractiveHtml = "";

  const sourceHtml = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>A4 生命周期</title></head><body>
    <button id="new-window-trigger" type="button">新窗口打开资源</button>
    <button id="same-window-trigger" type="button">当前窗口打开资源</button>
    <p>尚未保存的网址跳转课件</p>
  </body></html>`;

  try {
    const firstServerModule = await import(`../src/server.js?a4-save=${Date.now()}`);
    runtime = await firstServerModule.startServer({ host: "127.0.0.1", port: 0 });
    const form = new FormData();
    form.append("taskName", "A4 生命周期临时任务");
    form.append("files", new Blob([sourceHtml], { type: "text/html" }), "lesson.html");
    created = await fetch(`${runtime.url}/api/upload`, { method: "POST", body: form })
      .then((response) => response.json());
    const pageRecord = created.project.pages[0];

    await t.test("A4 ①设置：允许安全协议与窗口方式，明确拦截空值和危险协议", async () => {
      await editorPage.goto(`${runtime.url}${pageRecord.editUrl}`);
      await editorPage.waitForFunction(() => window.__htmlSlideMenderBootstrap?.editor?.active === true);
      const result = await editorPage.evaluate(() => {
        const editor = window.__htmlSlideMenderBootstrap.editor;
        const firstTrigger = document.querySelector("#new-window-trigger");
        const secondTrigger = document.querySelector("#same-window-trigger");
        editor.enterInteractionMode();
        editor.beginInteractionWizard("click");
        const choices = Array.from(editor.shadow.querySelectorAll("[data-interaction-choice]"))
          .map((button) => button.getAttribute("data-interaction-choice"));
        editor.interactionWizardKind = "click";
        editor.interactionWizardStep = 4;
        editor.interactionWizardAction = "openUrl";
        editor.interactionAdvancedOpen = true;
        editor.refreshInteractionPanel();
        const controls = Array.from(editor.shadow.querySelectorAll("[data-wizard-control]"))
          .map((control) => control.getAttribute("data-wizard-control"));

        const tryInvalid = (value) => {
          editor.interactionWizardKind = "click";
          editor.interactionWizardStep = 3;
          editor.interactionWizardAction = "openUrl";
          editor.pendingInteractionTriggerNodeId = editor.ensureInteractionElementId(firstTrigger);
          editor.interactionWizardUrl = value;
          editor.advanceInteractionWizard();
          return { step: editor.interactionWizardStep, toast: editor.toastEl?.textContent || "" };
        };
        const invalid = [tryInvalid(""), tryInvalid("javascript:alert(1)"), tryInvalid("file:///tmp/unsafe.html")];
        const normalized = {
          www: editor.normalizeExternalInteractionUrl("www.teacher.example.test/resource"),
          https: editor.normalizeExternalInteractionUrl("https://teacher.example.test/resource"),
          mailto: editor.normalizeExternalInteractionUrl("mailto:teacher@example.test"),
          tel: editor.normalizeExternalInteractionUrl("tel:12345678"),
          data: editor.normalizeExternalInteractionUrl("data:text/html,unsafe")
        };
        const staleUnsafeInteraction = editor.normalizeInteraction({
          id: "stale-unsafe",
          trigger: { event: "click", nodeId: editor.ensureInteractionElementId(firstTrigger) },
          action: { type: "openUrl", href: "javascript:alert(1)", newWindow: true }
        });

        const createUrl = (trigger, href, newWindow) => {
          editor.enterInteractionMode();
          editor.interactionWizardKind = "click";
          editor.interactionWizardStep = 4;
          editor.interactionWizardAction = "openUrl";
          editor.pendingInteractionTriggerNodeId = editor.ensureInteractionElementId(trigger);
          editor.interactionWizardUrl = href;
          editor.interactionWizardNewWindow = newWindow;
          editor.completeInteractionWizard();
          const interaction = editor.interactions.at(-1);
          if (newWindow) editor.stopInteractionPreview({ silent: true });
          return interaction.action;
        };
        const actions = [
          createUrl(firstTrigger, "https://teacher.example.test/new-window", true),
          createUrl(secondTrigger, "https://teacher.example.test/same-window", false)
        ];
        return {
          choices,
          invalid,
          normalized,
          staleUnsafeInteraction,
          actions,
          controls,
          previewActive: editor.shell.dataset.interactionPreview
        };
      });

      assert.equal(result.choices.includes("openUrl"), true);
      for (const invalid of result.invalid) {
        assert.equal(invalid.step, 3);
        assert.match(invalid.toast, /有效|网址|http/);
      }
      assert.deepEqual(result.normalized, {
        www: "https://www.teacher.example.test/resource",
        https: "https://teacher.example.test/resource",
        mailto: "mailto:teacher@example.test",
        tel: "tel:12345678",
        data: ""
      });
      assert.equal(result.staleUnsafeInteraction, null);
      assert.deepEqual(result.actions, [
        { type: "openUrl", href: "https://teacher.example.test/new-window", newWindow: true },
        { type: "openUrl", href: "https://teacher.example.test/same-window", newWindow: false }
      ]);
      assert.equal(result.controls.includes("newWindow"), true);
      assert.equal(result.previewActive, "true");
    });

    await t.test("A4 ②测试预览：只显示目标 URL，不打开窗口或离开未保存页面", async () => {
      const beforeUrl = editorPage.url();
      const beforePageCount = editorPage.context().pages().length;
      const result = await editorPage.evaluate(() => {
        const editor = window.__htmlSlideMenderBootstrap.editor;
        document.querySelector("#new-window-trigger").click();
        const firstToast = editor.toastEl?.textContent || "";
        document.querySelector("#same-window-trigger").click();
        const secondToast = editor.toastEl?.textContent || "";
        const during = {
          href: location.href,
          firstToast,
          secondToast,
          previewActive: editor.shell.dataset.interactionPreview,
          panelHidden: editor.interactionPanel.hidden,
          boxesHidden: editor.showBoxes === false && editor.layer.innerHTML === "",
          toolbarVisible: !editor.shadow.querySelector('[data-role="interaction-preview-toolbar"]').hidden
        };
        editor.stopInteractionPreview({ silent: true });
        return {
          during,
          after: {
            previewActive: editor.shell.dataset.interactionPreview,
            interactionMode: editor.shell.dataset.interactionMode
          }
        };
      });

      assert.equal(result.during.href, beforeUrl);
      assert.match(result.during.firstToast, /https:\/\/teacher\.example\.test\/new-window/);
      assert.match(result.during.secondToast, /https:\/\/teacher\.example\.test\/same-window/);
      assert.equal(editorPage.context().pages().length, beforePageCount);
      assert.equal(result.during.previewActive, "true");
      assert.equal(result.during.panelHidden, true);
      assert.equal(result.during.boxesHidden, true);
      assert.equal(result.during.toolbarVisible, true);
      assert.deepEqual(result.after, { previewActive: "false", interactionMode: "true" });
      savedInteractiveHtml = await editorPage.evaluate(() =>
        window.__htmlSlideMenderBootstrap.editor.serializeCleanHtml("basic")
      );
    });

    await t.test("A4 ③保存：安全 URL 与窗口方式随页面版本持久化", async () => {
      const response = await fetch(`${runtime.url}/api/projects/${created.project.id}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          editRelativePath: pageRecord.editRelativePath,
          html: savedInteractiveHtml,
          note: "A4 网址跳转互动"
        })
      });
      const saved = await response.json();
      assert.equal(response.status, 200);
      assert.equal(saved.version.id, "v002");
      const currentHtml = await fetch(`${runtime.url}${pageRecord.viewUrl}`).then((result) => result.text());
      assert.match(currentHtml, /"type":"openUrl"/);
      assert.match(currentHtml, /"newWindow":true/);
      assert.match(currentHtml, /"newWindow":false/);
    });

    await t.test("A4 ④重开：关闭服务后 URL 与窗口方式均保留", async () => {
      await runtime.close();
      runtime = null;
      const reopenedServerModule = await import(`../src/server.js?a4-reopen=${Date.now()}`);
      runtime = await reopenedServerModule.startServer({ host: "127.0.0.1", port: 0 });
      const projects = await fetch(`${runtime.url}/api/projects`).then((response) => response.json());
      const reopened = projects.projects.find((project) => project.id === created.project.id);
      assert.ok(reopened, "重开后应能找到 A4 临时任务");
      await editorPage.goto(`${runtime.url}${reopened.pages[0].editUrl}`);
      await editorPage.waitForFunction(() => window.__htmlSlideMenderBootstrap?.editor?.active === true);
      const actions = await editorPage.evaluate(() =>
        window.__htmlSlideMenderBootstrap.editor.interactions.map((interaction) => interaction.action)
      );
      assert.deepEqual(actions, [
        { type: "openUrl", href: "https://teacher.example.test/new-window", newWindow: true },
        { type: "openUrl", href: "https://teacher.example.test/same-window", newWindow: false }
      ]);
    });

    await t.test("A4 ⑤版本恢复：恢复旧版本时网址互动一并回滚", async () => {
      const saveWithoutInteraction = await fetch(`${runtime.url}/api/projects/${created.project.id}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          editRelativePath: pageRecord.editRelativePath,
          html: sourceHtml,
          note: "暂时移除网址互动"
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
      assert.deepEqual(await editorPage.evaluate(() =>
        window.__htmlSlideMenderBootstrap.editor.interactions.map((interaction) => interaction.action.newWindow)
      ), [true, false]);
    });

    await t.test("A4 ⑥独立导出：停止本地服务后，新窗口和当前窗口均能打开安全网址", async () => {
      const response = await fetch(`${runtime.url}/api/projects/${created.project.id}/export`);
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type") || "", /text\/html/);
      const exportPath = join(dataDirectory, "a4-restored-export.html");
      await writeFile(exportPath, Buffer.from(await response.arrayBuffer()));
      const stoppedUrl = runtime.url;
      await runtime.close();
      runtime = null;
      await assert.rejects(fetch(`${stoppedUrl}/api/projects`));

      const context = await browser.newContext();
      await context.route("https://teacher.example.test/**", async (route) => {
        const path = new URL(route.request().url()).pathname;
        await route.fulfill({
          status: 200,
          contentType: "text/html; charset=utf-8",
          body: `<!doctype html><html><body><h1 id="opened-target">${path}</h1></body></html>`
        });
      });
      const independentPage = await context.newPage();
      const errors = [];
      const collectErrors = (targetPage) => {
        targetPage.on("console", (message) => {
          if (message.type() === "error") errors.push(message.text());
        });
        targetPage.on("pageerror", (error) => errors.push(error.message));
      };
      collectErrors(independentPage);
      try {
        await independentPage.goto(pathToFileURL(exportPath).href);
        assert.match(independentPage.url(), /^file:/);
        const popupPromise = context.waitForEvent("page", (page) => page !== independentPage);
        await independentPage.locator("#new-window-trigger").click();
        const popup = await popupPromise;
        collectErrors(popup);
        await popup.waitForLoadState("domcontentloaded");
        assert.equal(popup.url(), "https://teacher.example.test/new-window");
        assert.equal(await popup.locator("#opened-target").textContent(), "/new-window");
        assert.equal(await popup.evaluate(() => window.opener === null), true);
        await popup.close();

        await independentPage.locator("#same-window-trigger").click();
        await independentPage.waitForURL("https://teacher.example.test/same-window");
        assert.equal(await independentPage.locator("#opened-target").textContent(), "/same-window");
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
