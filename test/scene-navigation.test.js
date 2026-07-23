import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { chromium } from "playwright";
import { injectVersionSaveButton, makeEditableHtml } from "../src/core.js";

const CHROME_EXECUTABLE = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

function launchBrowser() {
  const configuredExecutable = process.env.PLAYWRIGHT_CHROME_EXECUTABLE || CHROME_EXECUTABLE;
  return chromium.launch({
    ...(existsSync(configuredExecutable) ? { executablePath: configuredExecutable } : {}),
    headless: true
  });
}

async function clickBreadcrumb(page, label) {
  const center = await page.evaluate((text) => {
    const button = Array.from(document.querySelectorAll("[data-hsm-scene-breadcrumb] button"))
      .find((candidate) => candidate.textContent?.includes(text));
    if (!button) throw new Error(`找不到面包屑按钮：${text}`);
    const rect = button.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }, label);
  await page.mouse.click(center.x, center.y);
}

async function clickSceneTreeNode(page, sceneId) {
  const center = await page.evaluate((id) => {
    const button = Array.from(document.querySelectorAll("[data-hsm-open-scene]"))
      .find((candidate) => candidate.getAttribute("data-hsm-open-scene") === id);
    if (!button) throw new Error(`找不到场景树节点：${id}`);
    const rect = button.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }, sceneId);
  await page.mouse.click(center.x, center.y);
}

async function clickEditorItem(page, itemId) {
  await page.waitForFunction((id) => {
    const editor = window.__htmlSlideMenderBootstrap?.editor;
    return Boolean(editor?.shadow?.querySelector?.(`.box[data-item-id='${CSS.escape(id)}']`));
  }, itemId);
  const center = await page.evaluate((id) => {
    const editor = window.__htmlSlideMenderBootstrap.editor;
    const box = editor.shadow.querySelector(`.box[data-item-id='${CSS.escape(id)}']`);
    if (!box) throw new Error(`找不到编辑框：${id}`);
    const rect = box.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }, itemId);
  await page.mouse.click(center.x, center.y);
}

async function openNestedSceneEditor(page, { includeImage = false } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "html-mender-scene-navigation-"));
  const sourcePath = join(directory, "index.html");
  const editablePath = join(directory, "index.editable.html");
  const fixture = await readFile(
    new URL("./fixtures/deep-content-v1/g8-23-nested-modal/index.html", import.meta.url),
    "utf8"
  );
  const source = fixture
    .replace('<section id="intro"', '<section id="intro" data-hsm-node-id="course-modal"')
    .replace(
      '<h2 id="intro-title">课程介绍</h2>',
      '<h2 id="intro-title">课程介绍</h2>'
        + (includeImage
          ? '<img id="intro-image" alt="课程示意图" width="120" height="80" style="display:block;width:120px;height:80px" src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22120%22 height=%2280%22%3E%3Crect width=%22120%22 height=%2280%22 fill=%22%231d4ed8%22/%3E%3C/svg%3E">'
          : '')
        + '<label>教师记录<input id="teacher-note" value="初始内容"></label>'
    );
  await writeFile(sourcePath, source, "utf8");
  await makeEditableHtml({ inputPath: sourcePath, outputPath: editablePath, lang: "zh-CN" });
  await injectVersionSaveButton({
    htmlPath: editablePath,
    projectId: "scene-project",
    editRelativePath: "index.editable.html",
    pageNav: {
      taskName: "嵌套弹窗样本",
      pageLabel: "第 1 页",
      pageTitle: "首页",
      pages: [{
        id: "p001",
        label: "第 1 页",
        title: "",
        sourceRelativePath: "technical-file-name.html",
        editUrl: pathToFileURL(editablePath).href,
        current: true
      }],
      scenes: [
        {
          id: "scene:modal:p001:outer",
          type: "modal",
          pageId: "p001",
          parentSceneId: "scene:page:p001",
          title: "课程介绍",
          entry: { type: "interaction", targetNodeId: "course-modal" }
        },
        {
          id: "scene:modal:p001:inner",
          type: "modal",
          pageId: "p001",
          parentSceneId: "scene:modal:p001:outer",
          title: "任务详情",
          entry: { type: "static", targetSelector: "#detail" }
        }
      ]
    }
  });
  await page.goto(pathToFileURL(editablePath).href);
  await page.waitForFunction(() => window.__htmlSlideMenderBootstrap?.editor?.active === true);
  await page.waitForSelector("[data-hsm-scene-tree]");
  return directory;
}

async function openRealClickSceneEditor(page) {
  const directory = await mkdtemp(join(tmpdir(), "html-mender-real-click-scene-"));
  const sourcePath = join(directory, "index.html");
  const editablePath = join(directory, "index.editable.html");
  const fixture = await readFile(
    new URL("./fixtures/deep-content-v1/g8-23-nested-modal/index.html", import.meta.url),
    "utf8"
  );
  const manifest = {
    schemaVersion: "1.3",
    interactions: [
      {
        id: "open-course",
        name: "课程介绍",
        trigger: { event: "click", nodeId: "open-course-trigger" },
        action: {
          type: "openModal",
          targetId: "course-modal",
          close: { button: true, backdrop: true, escape: true }
        },
        initialState: { target: "hidden" },
        effect: { type: "none", duration: 400 }
      },
      {
        id: "open-detail",
        name: "任务详情",
        trigger: { event: "click", nodeId: "open-detail-trigger" },
        action: {
          type: "openModal",
          targetId: "detail-modal",
          close: { button: true, backdrop: true, escape: true }
        },
        initialState: { target: "hidden" },
        effect: { type: "none", duration: 400 }
      }
    ],
    sequences: []
  };
  const source = fixture
    .replace('<button id="open-intro"', '<button id="open-intro" data-hsm-node-id="open-course-trigger"')
    .replace('<section id="intro"', '<section id="intro" data-hsm-node-id="course-modal"')
    .replace(
      '<h2 id="intro-title">课程介绍</h2>',
      '<h2 id="intro-title">课程介绍</h2><label>教师记录<input id="teacher-note" value="初始内容"></label>'
    )
    .replace('<button id="open-detail"', '<button id="open-detail" data-hsm-node-id="open-detail-trigger"')
    .replace('<section id="detail"', '<section id="detail" data-hsm-node-id="detail-modal"')
    .replace(
      "</body>",
      `<script type="application/json" data-hsm-interaction-manifest="1">${JSON.stringify(manifest)}</script></body>`
    );
  await writeFile(sourcePath, source, "utf8");
  await makeEditableHtml({ inputPath: sourcePath, outputPath: editablePath, lang: "zh-CN" });
  await injectVersionSaveButton({
    htmlPath: editablePath,
    projectId: "real-click-scene-project",
    editRelativePath: "index.editable.html",
    pageNav: {
      taskName: "真实点击样本",
      pageLabel: "第 1 页",
      pageTitle: "首页",
      pages: [{
        id: "p001",
        label: "第 1 页",
        title: "",
        sourceRelativePath: "technical-file-name.html",
        editUrl: pathToFileURL(editablePath).href,
        current: true
      }],
      scenes: [
        {
          id: "scene:modal:p001:open-course",
          type: "modal",
          pageId: "p001",
          parentSceneId: "scene:page:p001",
          title: "课程介绍",
          entry: {
            type: "interaction",
            interactionId: "open-course",
            triggerNodeId: "open-course-trigger",
            targetNodeId: "course-modal"
          }
        },
        {
          id: "scene:modal:p001:open-detail",
          type: "modal",
          pageId: "p001",
          parentSceneId: "scene:modal:p001:open-course",
          title: "任务详情",
          entry: {
            type: "interaction",
            interactionId: "open-detail",
            triggerNodeId: "open-detail-trigger",
            targetNodeId: "detail-modal"
          }
        }
      ]
    }
  });
  await page.goto(pathToFileURL(editablePath).href);
  await page.waitForFunction(() => window.__htmlSlideMenderBootstrap?.editor?.active === true);
  await page.waitForSelector("[data-hsm-scene-tree]");
  return directory;
}

test("场景树可进入嵌套真实节点、逐层返回并安全保存", async () => {
  const browser = await launchBrowser();
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  let directory = "";
  try {
    directory = await openNestedSceneEditor(page);
    const teacherView = await page.locator("[data-hsm-page-sidebar]").innerText();
    assert.match(teacherView, /课件画面/);
    assert.match(teacherView, /课程介绍/);
    assert.match(teacherView, /任务详情/);
    assert.doesNotMatch(teacherView, /technical-file-name|scene:|targetSelector/);

    await page.evaluate(() => {
      window.__sceneIntroReference = document.querySelector("#intro");
      document.querySelector("#teacher-note").value = "教师已输入";
    });
    await clickSceneTreeNode(page, "scene:modal:p001:outer");
    await page.waitForFunction(() => window.__htmlSlideMenderBootstrap.editor.sceneNavigationStack?.length === 1
      && Boolean(document.querySelector("[data-hsm-scene-content] #toggle-tip")));
    const outer = await page.evaluate(() => {
      const editor = window.__htmlSlideMenderBootstrap.editor;
      const content = document.querySelector("[data-hsm-scene-content]");
      content.querySelector("#toggle-tip").click();
      return {
        usesLiveTarget: content.querySelector("#intro") === window.__sceneIntroReference,
        originalEventWorked: !content.querySelector("#learning-tip").hidden,
        inputValue: content.querySelector("#teacher-note").value,
        path: editor.sceneNavigationStack.map((state) => state.scene.title)
      };
    });
    assert.deepEqual(outer, {
      usesLiveTarget: true,
      originalEventWorked: true,
      inputValue: "教师已输入",
      path: ["课程介绍"]
    });

    await clickSceneTreeNode(page, "scene:modal:p001:inner");
    await page.waitForFunction(() => window.__htmlSlideMenderBootstrap.editor.sceneNavigationStack?.length === 2
      && Boolean(document.querySelector("[data-hsm-scene-content] #confirm-detail")));
    const inner = await page.evaluate(() => {
      const content = document.querySelector("[data-hsm-scene-content]");
      content.querySelector("#confirm-detail").click();
      return {
        detailVisible: Boolean(content.querySelector("#detail")),
        originalEventWorked: content.querySelector("#detail-state").textContent,
        breadcrumb: document.querySelector("[data-hsm-scene-breadcrumb]").textContent
      };
    });
    assert.equal(inner.detailVisible, true);
    assert.equal(inner.originalEventWorked, "已确认");
    assert.match(inner.breadcrumb, /首页.*课程介绍.*任务详情/);

    await clickBreadcrumb(page, "课程介绍");
    await page.waitForFunction(() => window.__htmlSlideMenderBootstrap.editor.sceneNavigationStack?.length === 1);
    assert.equal(await page.locator("[data-hsm-scene-content] #teacher-note").inputValue(), "教师已输入");
    await clickBreadcrumb(page, "首页");
    await page.waitForFunction(() => window.__htmlSlideMenderBootstrap.editor.sceneNavigationStack?.length === 0);
    const restored = await page.evaluate(() => ({
      introIsOriginal: document.querySelector("#intro") === window.__sceneIntroReference,
      introHidden: document.querySelector("#intro").hidden,
      detailHidden: document.querySelector("#detail").hidden,
      inputValue: document.querySelector("#teacher-note").value
    }));
    assert.deepEqual(restored, {
      introIsOriginal: true,
      introHidden: true,
      detailHidden: true,
      inputValue: "教师已输入"
    });

    await clickSceneTreeNode(page, "scene:modal:p001:outer");
    await page.waitForFunction(() => window.__htmlSlideMenderBootstrap.editor.sceneNavigationStack?.length === 1);
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => window.__htmlSlideMenderBootstrap.editor.sceneNavigationStack?.length === 0);

    await clickSceneTreeNode(page, "scene:modal:p001:inner");
    await page.waitForFunction(() => window.__htmlSlideMenderBootstrap.editor.sceneNavigationStack?.length === 2);
    const serialized = await page.evaluate(async () => {
      const editor = window.__htmlSlideMenderBootstrap.editor;
      const html = await editor.serializeCleanHtml("basic");
      return { html, depth: editor.sceneNavigationStack.length };
    });
    assert.equal(serialized.depth, 0);
    assert.equal((serialized.html.match(/id="intro"/g) || []).length, 1);
    assert.equal((serialized.html.match(/id="detail"/g) || []).length, 1);
    assert.doesNotMatch(serialized.html, /data-hsm-scene-modal|data-hsm-scene-content|课件画面/);
    assert.deepEqual(consoleErrors, []);
  } finally {
    await page.close();
    await browser.close();
    if (directory) await rm(directory, { recursive: true, force: true });
  }
});

test("场景树进入弹窗后可编辑真实文字，返回并重新进入时提交编辑状态", async () => {
  const browser = await launchBrowser();
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  let directory = "";
  try {
    directory = await openNestedSceneEditor(page);
    await page.evaluate(() => {
      window.__editableIntroReference = document.querySelector("#intro");
      document.querySelector("#teacher-note").value = "教师已输入";
      document.querySelector("#toggle-tip").addEventListener("click", (event) => {
        event.currentTarget.dataset.runCount = String(Number(event.currentTarget.dataset.runCount || 0) + 1);
        event.stopImmediatePropagation();
      }, { capture: true });
    });

    await clickSceneTreeNode(page, "scene:modal:p001:outer");
    await page.waitForFunction(() => {
      const editor = window.__htmlSlideMenderBootstrap.editor;
      return editor.sceneNavigationStack?.length === 1
        && Array.from(editor.items.values()).some((item) => item.element?.id === "intro-title");
    });
    const titleItemId = await page.evaluate(() => Array.from(window.__htmlSlideMenderBootstrap.editor.items.values())
      .find((item) => item.element?.id === "intro-title")?.id || "");
    assert.notEqual(titleItemId, "");

    await clickEditorItem(page, titleItemId);
    await page.waitForFunction((id) => window.__htmlSlideMenderBootstrap.editor.editingTextId === id, titleItemId);
    assert.equal(
      await page.evaluate(() => window.__htmlSlideMenderBootstrap.editor.editingTextId),
      titleItemId
    );
    await page.locator("#intro-title").fill("课程须知");
    await page.evaluate(() => document.querySelector("#toggle-tip").click());

    await clickBreadcrumb(page, "首页");
    await page.waitForFunction(() => window.__htmlSlideMenderBootstrap.editor.sceneNavigationStack?.length === 0);
    const returnedHome = await page.evaluate(() => {
      const editor = window.__htmlSlideMenderBootstrap.editor;
      const title = document.querySelector("#intro-title");
      return {
        title: title?.textContent,
        editingTextId: editor.editingTextId,
        contenteditable: title?.getAttribute("contenteditable"),
        spellcheck: title?.getAttribute("spellcheck"),
        undoLabel: editor.undoStack.at(-1)?.label,
        introIsOriginal: document.querySelector("#intro") === window.__editableIntroReference,
        introHidden: document.querySelector("#intro")?.hidden,
        inputValue: document.querySelector("#teacher-note")?.value,
        originalEventRunCount: document.querySelector("#toggle-tip")?.dataset.runCount
      };
    });

    await clickSceneTreeNode(page, "scene:modal:p001:outer");
    await page.waitForFunction(() => window.__htmlSlideMenderBootstrap.editor.sceneNavigationStack?.length === 1);
    const reentered = await page.evaluate(() => ({
      title: document.querySelector("[data-hsm-scene-content] #intro-title")?.textContent,
      editingTextId: window.__htmlSlideMenderBootstrap.editor.editingTextId,
      inputValue: document.querySelector("[data-hsm-scene-content] #teacher-note")?.value,
      originalEventRunCount: document.querySelector("[data-hsm-scene-content] #toggle-tip")?.dataset.runCount
    }));

    assert.deepEqual(returnedHome, {
      title: "课程须知",
      editingTextId: null,
      contenteditable: null,
      spellcheck: null,
      undoLabel: "Edit text",
      introIsOriginal: true,
      introHidden: true,
      inputValue: "教师已输入",
      originalEventRunCount: "1"
    });
    assert.deepEqual(reentered, {
      title: "课程须知",
      editingTextId: null,
      inputValue: "教师已输入",
      originalEventRunCount: "1"
    });
    assert.deepEqual(consoleErrors, []);
  } finally {
    await page.close();
    await browser.close();
    if (directory) await rm(directory, { recursive: true, force: true });
  }
});

test("场景树进入弹窗后可替换真实普通图片，返回并重新进入时保留修改", async () => {
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  let directory = "";
  try {
    directory = await openNestedSceneEditor(page, { includeImage: true });
    await page.evaluate(() => {
      window.__editableIntroImageReference = document.querySelector("#intro-image");
      window.__editableIntroImageParent = document.querySelector("#intro-image").parentNode;
      document.querySelector("#teacher-note").value = "教师已输入";
      document.querySelector("#toggle-tip").addEventListener("click", (event) => {
        event.currentTarget.dataset.runCount = String(Number(event.currentTarget.dataset.runCount || 0) + 1);
        event.stopImmediatePropagation();
      }, { capture: true });
    });

    await clickSceneTreeNode(page, "scene:modal:p001:outer");
    const imageItemHandle = await page.waitForFunction(() => {
      const editor = window.__htmlSlideMenderBootstrap.editor;
      if (editor.sceneNavigationStack?.length !== 1) return "";
      const item = Array.from(editor.items.values())
        .find((candidate) => candidate.type === "image" && candidate.element?.id === "intro-image");
      const rect = item?.element?.getBoundingClientRect?.();
      return item?.id && rect?.width > 0 && rect?.height > 0 ? item.id : "";
    });
    const imageItemId = await imageItemHandle.jsonValue();
    assert.notEqual(imageItemId, "");
    const originalSource = await page.locator("#intro-image").getAttribute("src");
    const originalGeometry = await page.evaluate(() => {
      const imageRect = document.querySelector("#intro-image").getBoundingClientRect();
      const modalRect = document.querySelector("#intro").getBoundingClientRect();
      return {
        imageWidth: Math.round(imageRect.width),
        imageHeight: Math.round(imageRect.height),
        modalWidth: Math.round(modalRect.width),
        modalHeight: Math.round(modalRect.height)
      };
    });

    await page.locator("#intro-image").click();
    assert.equal(
      await page.evaluate(() => window.__htmlSlideMenderBootstrap.editor.selectedId),
      imageItemId
    );
    await page.locator('[data-role="edit-popover"][data-selection="image"] [data-action="image-replace"]').waitFor();
    const replaceButtonHitTest = await page.evaluate(() => {
      const editor = window.__htmlSlideMenderBootstrap.editor;
      const button = editor.shadow.querySelector('[data-action="image-replace"]');
      const rect = button.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return {
        targetInEditor: editor.host === hit || hit?.getRootNode?.() === editor.shadow,
        hitTag: hit?.tagName || "",
        hitRole: hit?.getAttribute?.("data-hsm-editor") || "",
        editorZIndex: editor.host.style.zIndex,
        sceneZIndex: editor.sceneNavigationHost ? getComputedStyle(editor.sceneNavigationHost).zIndex : "",
        hostPointerEvents: getComputedStyle(editor.host).pointerEvents,
        buttonPointerEvents: getComputedStyle(button).pointerEvents
      };
    });
    assert.equal(replaceButtonHitTest.targetInEditor, true, JSON.stringify(replaceButtonHitTest));

    await page.evaluate(() => window.__htmlSlideMenderBootstrap.editor.shadow
      .querySelector('[data-action="image-replace"]')
      .click());
    await page.locator('[data-role="file-input"]').setInputFiles({
      name: "replacement.png",
      mimeType: "image/png",
      buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mNkYPj/n4GBgYGJAQoAHgQCAf2f6S8AAAAASUVORK5CYII=", "base64")
    });
    await page.waitForFunction(() => document.querySelector("#intro-image")?.getAttribute("src")?.startsWith("data:image/png;base64,"));
    const replacementSource = await page.locator("#intro-image").getAttribute("src");
    const replacementGeometry = await page.evaluate(() => {
      const imageRect = document.querySelector("#intro-image").getBoundingClientRect();
      const modalRect = document.querySelector("#intro").getBoundingClientRect();
      return {
        imageWidth: Math.round(imageRect.width),
        imageHeight: Math.round(imageRect.height),
        modalWidth: Math.round(modalRect.width),
        modalHeight: Math.round(modalRect.height)
      };
    });
    assert.notEqual(replacementSource, originalSource);
    assert.deepEqual(replacementGeometry, originalGeometry, "替换不同比例图片后应保持原图片框和弹窗尺寸");
    assert.equal(
      await page.evaluate(() => window.__htmlSlideMenderBootstrap.editor.undoStack.at(-1)?.label),
      "Replace image"
    );

    await page.evaluate(() => window.__htmlSlideMenderBootstrap.editor.undo());
    await page.waitForFunction((source) => document.querySelector("#intro-image")?.getAttribute("src") === source, originalSource);
    await page.evaluate(() => window.__htmlSlideMenderBootstrap.editor.redo());
    await page.waitForFunction((source) => document.querySelector("#intro-image")?.getAttribute("src") === source, replacementSource);
    await page.evaluate(() => document.querySelector("#toggle-tip").click());

    await page.locator('[data-hsm-scene-breadcrumb] button', { hasText: "首页" }).click();
    await page.waitForFunction(() => window.__htmlSlideMenderBootstrap.editor.sceneNavigationStack?.length === 0);
    const returnedHome = await page.evaluate(() => ({
      imageIsOriginal: document.querySelector("#intro-image") === window.__editableIntroImageReference,
      parentIsOriginal: document.querySelector("#intro-image")?.parentNode === window.__editableIntroImageParent,
      source: document.querySelector("#intro-image")?.getAttribute("src"),
      introHidden: document.querySelector("#intro")?.hidden,
      inputValue: document.querySelector("#teacher-note")?.value,
      originalEventRunCount: document.querySelector("#toggle-tip")?.dataset.runCount
    }));

    await clickSceneTreeNode(page, "scene:modal:p001:outer");
    await page.waitForFunction(() => window.__htmlSlideMenderBootstrap.editor.sceneNavigationStack?.length === 1);
    const reentered = await page.evaluate(() => ({
      source: document.querySelector("[data-hsm-scene-content] #intro-image")?.getAttribute("src"),
      inputValue: document.querySelector("[data-hsm-scene-content] #teacher-note")?.value,
      originalEventRunCount: document.querySelector("[data-hsm-scene-content] #toggle-tip")?.dataset.runCount,
      imageWidth: Math.round(document.querySelector("[data-hsm-scene-content] #intro-image")?.getBoundingClientRect().width || 0),
      imageHeight: Math.round(document.querySelector("[data-hsm-scene-content] #intro-image")?.getBoundingClientRect().height || 0)
    }));
    const serialized = await page.evaluate(async () => {
      const editor = window.__htmlSlideMenderBootstrap.editor;
      const html = await editor.serializeCleanHtml("basic");
      const parsed = new DOMParser().parseFromString(html, "text/html");
      return {
        source: parsed.querySelector("#intro-image")?.getAttribute("src"),
        hasEditor: Boolean(parsed.querySelector("#html-slide-mender-root, [data-hsm-editor]")),
        depth: editor.sceneNavigationStack.length
      };
    });

    assert.deepEqual(returnedHome, {
      imageIsOriginal: true,
      parentIsOriginal: true,
      source: replacementSource,
      introHidden: true,
      inputValue: "教师已输入",
      originalEventRunCount: "1"
    });
    assert.deepEqual(reentered, {
      source: replacementSource,
      inputValue: "教师已输入",
      originalEventRunCount: "1",
      imageWidth: originalGeometry.imageWidth,
      imageHeight: originalGeometry.imageHeight
    });
    assert.deepEqual(serialized, {
      source: replacementSource,
      hasEditor: false,
      depth: 0
    });
    assert.deepEqual(consoleErrors, []);
  } finally {
    await page.close();
    await browser.close();
    if (directory) await rm(directory, { recursive: true, force: true });
  }
});

test("弹窗内可用真实界面配置 A1 切换显示并预览，返回重进仍保留", async () => {
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  let directory = "";
  try {
    directory = await openNestedSceneEditor(page);
    await page.evaluate(() => {
      window.__a1TriggerReference = document.querySelector("#toggle-tip");
      window.__a1TargetReference = document.querySelector("#intro-title");
      window.__a1TargetParent = document.querySelector("#intro-title").parentNode;
    });
    await clickSceneTreeNode(page, "scene:modal:p001:outer");
    await page.evaluate(() => window.__htmlSlideMenderBootstrap.editor.shadow
      .querySelector('[data-action="toggle-interactions"]')
      .click());
    await page.evaluate(() => window.__htmlSlideMenderBootstrap.editor.shadow
      .querySelector('[data-action="begin-click-interaction"]')
      .click());
    await page.evaluate(() => window.__htmlSlideMenderBootstrap.editor.shadow
      .querySelector('[data-interaction-choice="toggleVisibility"]')
      .click());

    const triggerGuidance = await page.evaluate(() => {
      const editor = window.__htmlSlideMenderBootstrap.editor;
      const guidance = editor.shadow.querySelector('[data-role="interaction-guidance"]');
      const boxes = Array.from(editor.shadow.querySelectorAll(".box"));
      return {
        visible: Boolean(guidance && !guidance.hidden),
        text: guidance?.textContent || "",
        selectionStep: editor.shell.dataset.interactionSelectionStep || "",
        boxCount: boxes.length,
        controlCandidateCount: boxes.filter((box) => box.classList.contains("is-interaction-control")).length,
        incorrectlySelectedCount: boxes.filter((box) => box.classList.contains("is-interaction-trigger")).length
      };
    });
    assert.equal(triggerGuidance.visible, true);
    assert.match(triggerGuidance.text, /现在.*点击.*触发按钮/);
    assert.equal(triggerGuidance.selectionStep, "2");
    assert.ok(triggerGuidance.controlCandidateCount > 0);
    assert.ok(triggerGuidance.controlCandidateCount < triggerGuidance.boxCount);
    assert.equal(triggerGuidance.incorrectlySelectedCount, 0);

    const triggerItemId = await page.evaluate(() => Array.from(
      window.__htmlSlideMenderBootstrap.editor.items.values()
    ).find((item) => item.element?.id === "toggle-tip")?.id || "");
    assert.notEqual(triggerItemId, "");
    await clickEditorItem(page, triggerItemId);
    const triggerSelection = await page.evaluate(() => {
      const editor = window.__htmlSlideMenderBootstrap.editor;
      return {
        step: editor.interactionWizardStep,
        triggerId: editor.pendingInteractionTriggerNodeId,
        originalTipHidden: document.querySelector("#learning-tip").hidden
      };
    });
    assert.equal(triggerSelection.step, 3);
    assert.notEqual(triggerSelection.triggerId, "");
    assert.equal(triggerSelection.originalTipHidden, true, "配置时不应误触发课件原按钮");
    const targetGuidance = await page.evaluate(() => {
      const editor = window.__htmlSlideMenderBootstrap.editor;
      const guidance = editor.shadow.querySelector('[data-role="interaction-guidance"]');
      const boxes = Array.from(editor.shadow.querySelectorAll(".box"));
      return {
        visible: Boolean(guidance && !guidance.hidden),
        text: guidance?.textContent || "",
        selectionStep: editor.shell.dataset.interactionSelectionStep || "",
        boxCount: boxes.length,
        primaryTargetCount: boxes.filter((box) => box.classList.contains("is-interaction-primary-target")).length,
        incorrectlySelectedCount: boxes.filter((box) => box.classList.contains("is-interaction-target")).length
      };
    });
    assert.equal(targetGuidance.visible, true);
    assert.match(targetGuidance.text, /已选中.*现在.*点击.*内容/);
    assert.equal(targetGuidance.selectionStep, "3");
    assert.ok(targetGuidance.primaryTargetCount < targetGuidance.boxCount);
    assert.equal(targetGuidance.incorrectlySelectedCount, 0);

    const targetItemId = await page.evaluate(() => Array.from(
      window.__htmlSlideMenderBootstrap.editor.items.values()
    ).find((item) => item.element?.id === "intro-title")?.id || "");
    assert.notEqual(targetItemId, "");
    await clickEditorItem(page, targetItemId);
    const targetSelection = await page.evaluate(() => {
      const editor = window.__htmlSlideMenderBootstrap.editor;
      return {
        step: editor.interactionWizardStep,
        targetId: editor.interactionWizardTargetNodeId,
        triggerId: editor.pendingInteractionTriggerNodeId
      };
    });
    assert.equal(targetSelection.step, 4);
    assert.notEqual(targetSelection.targetId, "");
    assert.notEqual(targetSelection.targetId, targetSelection.triggerId);
    const completedSelectionGuidance = await page.evaluate(() => {
      const editor = window.__htmlSlideMenderBootstrap.editor;
      const guidance = editor.shadow.querySelector('[data-role="interaction-guidance"]');
      return {
        hidden: guidance?.hidden,
        toast: editor.toastEl?.textContent || "",
        selectionStep: editor.shell.dataset.interactionSelectionStep || ""
      };
    });
    assert.equal(completedSelectionGuidance.hidden, true);
    assert.match(completedSelectionGuidance.toast, /触发按钮和目标内容已选好/);
    assert.equal(completedSelectionGuidance.selectionStep, "0");

    await page.evaluate(() => window.__htmlSlideMenderBootstrap.editor.shadow
      .querySelector('[data-action="interaction-wizard-complete"]')
      .click());
    await page.waitForFunction(() => window.__htmlSlideMenderBootstrap.editor.interactionPreviewActive === true);
    assert.equal(await page.locator("#intro-title").isHidden(), true);
    await page.locator("#toggle-tip").click();
    assert.equal(await page.locator("#intro-title").isVisible(), true);
    assert.equal(await page.locator("#learning-tip").getAttribute("hidden"), "");

    await page.evaluate(() => window.__htmlSlideMenderBootstrap.editor.shadow
      .querySelector('[data-action="stop-interaction-preview"]')
      .click());
    await page.waitForFunction(() => window.__htmlSlideMenderBootstrap.editor.interactionPreviewActive === false);
    assert.equal(await page.locator("#intro-title").isVisible(), true);

    await clickBreadcrumb(page, "首页");
    await page.waitForFunction(() => window.__htmlSlideMenderBootstrap.editor.sceneNavigationStack?.length === 0);
    const returnedHome = await page.evaluate(() => ({
      triggerIsOriginal: document.querySelector("#toggle-tip") === window.__a1TriggerReference,
      targetIsOriginal: document.querySelector("#intro-title") === window.__a1TargetReference,
      targetParentIsOriginal: document.querySelector("#intro-title")?.parentNode === window.__a1TargetParent,
      introHidden: document.querySelector("#intro")?.hidden,
      interactionCount: window.__htmlSlideMenderBootstrap.editor.interactions.length
    }));

    await clickSceneTreeNode(page, "scene:modal:p001:outer");
    await page.waitForFunction(() => window.__htmlSlideMenderBootstrap.editor.sceneNavigationStack?.length === 1);
    const reentered = await page.evaluate(async () => {
      const editor = window.__htmlSlideMenderBootstrap.editor;
      const html = await editor.serializeCleanHtml("basic");
      const parsed = new DOMParser().parseFromString(html, "text/html");
      const manifest = JSON.parse(parsed.querySelector("script[data-hsm-interaction-manifest]")?.textContent || "{}");
      return {
        interactionCount: editor.interactions.length,
        triggerIsOriginal: document.querySelector("#toggle-tip") === window.__a1TriggerReference,
        targetIsOriginal: document.querySelector("#intro-title") === window.__a1TargetReference,
        actionType: manifest.interactions?.[0]?.action?.type,
        targetId: manifest.interactions?.[0]?.action?.targetId || "",
        hasSceneShell: Boolean(parsed.querySelector("[data-hsm-scene-modal], [data-hsm-scene-content]")),
        depth: editor.sceneNavigationStack.length
      };
    });

    assert.deepEqual(returnedHome, {
      triggerIsOriginal: true,
      targetIsOriginal: true,
      targetParentIsOriginal: true,
      introHidden: true,
      interactionCount: 1
    });
    assert.deepEqual(reentered, {
      interactionCount: 1,
      triggerIsOriginal: true,
      targetIsOriginal: true,
      actionType: "toggleVisibility",
      targetId: targetSelection.targetId,
      hasSceneShell: false,
      depth: 0
    });
    assert.deepEqual(consoleErrors, []);
  } finally {
    await page.close();
    await browser.close();
    if (directory) await rm(directory, { recursive: true, force: true });
  }
});

test("弹窗内 A1 显示、隐藏、切换三种预览均生效且退出后恢复", async () => {
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  let directory = "";
  try {
    directory = await openNestedSceneEditor(page);
    await clickSceneTreeNode(page, "scene:modal:p001:outer");
    const result = await page.evaluate(() => {
      const editor = window.__htmlSlideMenderBootstrap.editor;
      const triggerId = editor.ensureInteractionElementId(document.querySelector("#toggle-tip"));
      const cases = [
        { key: "show", type: "showVisibility", target: document.querySelector("#learning-tip"), initial: "hidden" },
        { key: "hide", type: "hideVisibility", target: document.querySelector("#intro-title"), initial: "visible" },
        { key: "toggle", type: "toggleVisibility", target: document.querySelector("#teacher-note"), initial: "hidden" }
      ];
      const output = {};
      editor.enterInteractionMode();
      for (const current of cases) {
        const beforeHidden = current.target.hidden;
        const beforeStyle = current.target.getAttribute("style");
        editor.interactions = [{
          id: `deep-a1-${current.key}`,
          name: current.key,
          trigger: { event: "click", nodeId: triggerId },
          action: { type: current.type, targetId: editor.ensureInteractionElementId(current.target) },
          initialState: { target: current.initial },
          effect: { type: "none", duration: 400 },
          record: { type: "interaction.activated" }
        }];
        editor.startInteractionPreview();
        const initialDisplay = getComputedStyle(current.target).display;
        editor.activateInteractionPreview(editor.interactions[0]);
        const afterDisplay = getComputedStyle(current.target).display;
        editor.stopInteractionPreview({ silent: true });
        output[current.key] = {
          initialDisplay,
          afterDisplay,
          restoredHidden: current.target.hidden,
          restoredStyle: current.target.getAttribute("style"),
          beforeHidden,
          beforeStyle,
          sceneDepth: editor.sceneNavigationStack.length
        };
      }
      return output;
    });

    assert.equal(result.show.initialDisplay, "none");
    assert.notEqual(result.show.afterDisplay, "none");
    assert.notEqual(result.hide.initialDisplay, "none");
    assert.equal(result.hide.afterDisplay, "none");
    assert.equal(result.toggle.initialDisplay, "none");
    assert.notEqual(result.toggle.afterDisplay, "none");
    for (const actionResult of Object.values(result)) {
      assert.equal(actionResult.restoredHidden, actionResult.beforeHidden);
      assert.equal(actionResult.restoredStyle || "", actionResult.beforeStyle || "");
      assert.equal(actionResult.sceneDepth, 1);
    }
  } finally {
    await page.close();
    await browser.close();
    if (directory) await rm(directory, { recursive: true, force: true });
  }
});

test("弹窗内单个真实元素可移动缩放微调，撤销重做后返回重进仍保留", async () => {
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  let directory = "";
  try {
    directory = await openNestedSceneEditor(page);
    await page.evaluate(() => {
      window.__layoutTitleReference = document.querySelector("#intro-title");
      window.__layoutTitleParent = document.querySelector("#intro-title").parentNode;
    });
    await clickSceneTreeNode(page, "scene:modal:p001:outer");
    await page.evaluate(() => window.__htmlSlideMenderBootstrap.editor.shadow
      .querySelector('[data-action="layout-mode"]')
      .click());

    const titleItemHandle = await page.waitForFunction(() => {
      const editor = window.__htmlSlideMenderBootstrap?.editor;
      if (editor?.editMode !== "layout" || editor.sceneNavigationStack?.length !== 1) return "";
      const item = Array.from(editor.items.values())
        .find((candidate) => candidate.element?.id === "intro-title");
      return item?.id || "";
    });
    const titleItemId = await titleItemHandle.jsonValue();
    assert.notEqual(titleItemId, "");
    await clickEditorItem(page, titleItemId);
    const selectedLayoutState = await page.evaluate(() => {
      const editor = window.__htmlSlideMenderBootstrap.editor;
      return {
        editMode: editor.editMode,
        selectedId: editor.selectedId,
        selectedIds: Array.from(editor.selectedIds || []),
        activeTag: document.activeElement?.tagName || "",
        shadowActiveAction: editor.shadow?.activeElement?.getAttribute?.("data-action") || ""
      };
    });
    assert.equal(selectedLayoutState.editMode, "layout");
    assert.equal(selectedLayoutState.selectedId, titleItemId);
    assert.deepEqual(selectedLayoutState.selectedIds, [titleItemId]);
    assert.equal(selectedLayoutState.shadowActiveAction, "");

    const original = await page.evaluate(() => {
      const title = document.querySelector("#intro-title");
      const rect = title.getBoundingClientRect();
      return {
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        transform: title.style.transform
      };
    });

    const dragStart = await page.evaluate((itemId) => {
      const editor = window.__htmlSlideMenderBootstrap.editor;
      const box = editor.shadow.querySelector(`.box[data-item-id='${CSS.escape(itemId)}']`);
      if (!box) throw new Error("找不到布局编辑框");
      const rect = box.getBoundingClientRect();
      const candidates = [
        [rect.left + rect.width / 2, rect.top + 3],
        [rect.left + 3, rect.top + rect.height / 2],
        [rect.right - 3, rect.top + rect.height / 2],
        [rect.left + rect.width / 2, rect.bottom - 3],
        [rect.left + rect.width / 2, rect.top + rect.height / 2]
      ];
      const point = candidates.find(([candidateX, candidateY]) => {
        const candidate = editor.shadow.elementFromPoint(candidateX, candidateY);
        return candidate?.closest?.(".box") === box && !candidate.closest?.("[data-layout-scale-handle]");
      }) || candidates.at(-1);
      const [x, y] = point;
      const hit = editor.shadow.elementFromPoint(x, y);
      return {
        x,
        y,
        hitItemId: hit?.closest?.("[data-item-id]")?.getAttribute("data-item-id") || "",
        hitClass: hit?.className || ""
      };
    }, titleItemId);
    assert.equal(dragStart.hitItemId, titleItemId, JSON.stringify(dragStart));
    await page.mouse.move(dragStart.x, dragStart.y);
    await page.mouse.down();
    assert.equal(
      await page.evaluate(() => Boolean(window.__htmlSlideMenderBootstrap.editor.layoutDrag)),
      true,
      JSON.stringify(dragStart)
    );
    await page.mouse.move(dragStart.x + 20, dragStart.y + 12, { steps: 4 });
    await page.mouse.up();
    const dragged = await page.evaluate(() => {
      const editor = window.__htmlSlideMenderBootstrap.editor;
      const rect = document.querySelector("#intro-title").getBoundingClientRect();
      return {
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        undoLabel: editor.undoStack.at(-1)?.label
      };
    });
    assert.deepEqual(dragged, {
      left: original.left + 20,
      top: original.top + 12,
      undoLabel: "Move element"
    });

    await page.keyboard.press("Shift+ArrowRight");
    await page.keyboard.press("ArrowDown");
    const moved = await page.evaluate(() => {
      const editor = window.__htmlSlideMenderBootstrap.editor;
      const title = document.querySelector("#intro-title");
      const rect = title.getBoundingClientRect();
      return {
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        transform: title.style.transform,
        undoLabel: editor.undoStack.at(-1)?.label
      };
    });
    assert.equal(moved.left, dragged.left + 10);
    assert.equal(moved.top, dragged.top + 1);
    assert.notEqual(moved.transform, original.transform);
    assert.equal(moved.undoLabel, "Move element");

    await page.evaluate(() => window.__htmlSlideMenderBootstrap.editor.shadow
      .querySelector('[data-action="undo"]')
      .click());
    const afterUndo = await page.evaluate(() => {
      const rect = document.querySelector("#intro-title").getBoundingClientRect();
      return { left: Math.round(rect.left), top: Math.round(rect.top) };
    });
    assert.equal(afterUndo.left, dragged.left + 10);
    assert.equal(afterUndo.top, dragged.top);

    await page.evaluate(() => window.__htmlSlideMenderBootstrap.editor.shadow
      .querySelector('[data-action="redo"]')
      .click());
    const afterRedo = await page.evaluate(() => {
      const rect = document.querySelector("#intro-title").getBoundingClientRect();
      return { left: Math.round(rect.left), top: Math.round(rect.top) };
    });
    assert.deepEqual(afterRedo, { left: moved.left, top: moved.top });

    const scaleHandle = await page.evaluate((itemId) => {
      const editor = window.__htmlSlideMenderBootstrap.editor;
      const handle = editor.shadow.querySelector(
        `[data-item-id='${CSS.escape(itemId)}'] [data-layout-scale-handle='se']`
      );
      if (!handle) throw new Error("找不到缩放手柄");
      const rect = handle.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }, titleItemId);
    await page.mouse.move(scaleHandle.x, scaleHandle.y);
    await page.mouse.down();
    await page.mouse.move(scaleHandle.x + 24, scaleHandle.y + 18, { steps: 4 });
    await page.mouse.up();

    const scaled = await page.evaluate(() => {
      const editor = window.__htmlSlideMenderBootstrap.editor;
      const title = document.querySelector("#intro-title");
      const rect = title.getBoundingClientRect();
      return {
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        transform: title.style.transform,
        undoLabel: editor.undoStack.at(-1)?.label
      };
    });
    assert.ok(scaled.width > original.width || scaled.height > original.height);
    assert.equal(scaled.undoLabel, "Scale element");

    await clickBreadcrumb(page, "首页");
    await page.waitForFunction(() => window.__htmlSlideMenderBootstrap.editor.sceneNavigationStack?.length === 0);
    const returnedHome = await page.evaluate(() => ({
      isOriginal: document.querySelector("#intro-title") === window.__layoutTitleReference,
      parentIsOriginal: document.querySelector("#intro-title")?.parentNode === window.__layoutTitleParent,
      transform: document.querySelector("#intro-title")?.style.transform,
      introHidden: document.querySelector("#intro")?.hidden
    }));

    await clickSceneTreeNode(page, "scene:modal:p001:outer");
    await page.waitForFunction(() => window.__htmlSlideMenderBootstrap.editor.sceneNavigationStack?.length === 1);
    const reentered = await page.evaluate(() => {
      const title = document.querySelector("[data-hsm-scene-content] #intro-title");
      const rect = title.getBoundingClientRect();
      return {
        transform: title.style.transform,
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      };
    });
    const serialized = await page.evaluate(async () => {
      const editor = window.__htmlSlideMenderBootstrap.editor;
      const html = await editor.serializeCleanHtml("basic");
      const parsed = new DOMParser().parseFromString(html, "text/html");
      return {
        transform: parsed.querySelector("#intro-title")?.style.transform,
        hasEditor: Boolean(parsed.querySelector("#html-slide-mender-root, [data-hsm-editor], [data-hsm-scene-modal]")),
        depth: editor.sceneNavigationStack.length
      };
    });

    assert.deepEqual(returnedHome, {
      isOriginal: true,
      parentIsOriginal: true,
      transform: scaled.transform,
      introHidden: true
    });
    assert.deepEqual(reentered, {
      transform: scaled.transform,
      width: scaled.width,
      height: scaled.height
    });
    assert.deepEqual(serialized, {
      transform: scaled.transform,
      hasEditor: false,
      depth: 0
    });
    assert.deepEqual(consoleErrors, []);
  } finally {
    await page.close();
    await browser.close();
    if (directory) await rm(directory, { recursive: true, force: true });
  }
});

test("直接点击课件按钮展开内容后替换图片不会放大图片框或内容区", async () => {
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  let directory = "";
  try {
    directory = await openNestedSceneEditor(page, { includeImage: true });
    await page.locator("[data-hsm-page-sidebar] .hsm-page-sidebar-close").click();
    await page.locator("#open-intro").click();
    await page.waitForFunction(() => {
      const image = document.querySelector("#intro-image");
      const item = Array.from(window.__htmlSlideMenderBootstrap.editor.items.values())
        .find((candidate) => candidate.type === "image" && candidate.element === image);
      const rect = image?.getBoundingClientRect?.();
      return item?.id && rect?.width > 0 && rect?.height > 0;
    });

    const before = await page.evaluate(() => {
      const editor = window.__htmlSlideMenderBootstrap.editor;
      const image = document.querySelector("#intro-image");
      const content = document.querySelector("#intro");
      const item = Array.from(editor.items.values()).find((candidate) => candidate.element === image);
      const imageRect = image.getBoundingClientRect();
      const contentRect = content.getBoundingClientRect();
      return {
        source: image.getAttribute("src"),
        imageWidth: Math.round(imageRect.width),
        imageHeight: Math.round(imageRect.height),
        contentWidth: Math.round(contentRect.width),
        contentHeight: Math.round(contentRect.height),
        frameIsContent: item?.frameElement === content
      };
    });

    await page.evaluate(() => {
      const editor = window.__htmlSlideMenderBootstrap.editor;
      const image = document.querySelector("#intro-image");
      const item = Array.from(editor.items.values()).find((candidate) => candidate.element === image);
      editor.selectItem(item.id);
    });
    await page.evaluate(() => window.__htmlSlideMenderBootstrap.editor.shadow
      .querySelector('[data-action="image-replace"]')
      .click());
    await page.locator('[data-role="file-input"]').setInputFiles({
      name: "portrait-replacement.png",
      mimeType: "image/png",
      buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mNkYPj/n4GBgYGJAQoAHgQCAf2f6S8AAAAASUVORK5CYII=", "base64")
    });
    await page.waitForFunction(() => document.querySelector("#intro-image")?.getAttribute("src")?.startsWith("data:image/png;base64,"));

    const after = await page.evaluate(() => {
      const image = document.querySelector("#intro-image");
      const content = document.querySelector("#intro");
      const imageRect = image.getBoundingClientRect();
      const contentRect = content.getBoundingClientRect();
      return {
        source: image.getAttribute("src"),
        imageWidth: Math.round(imageRect.width),
        imageHeight: Math.round(imageRect.height),
        contentWidth: Math.round(contentRect.width),
        contentHeight: Math.round(contentRect.height)
      };
    });

    assert.equal(before.frameIsContent, false, "包含标题和按钮的内容区不能被当成图片框");
    assert.notEqual(after.source, before.source);
    assert.deepEqual({
      imageWidth: after.imageWidth,
      imageHeight: after.imageHeight,
      contentWidth: after.contentWidth,
      contentHeight: after.contentHeight
    }, {
      imageWidth: before.imageWidth,
      imageHeight: before.imageHeight,
      contentWidth: before.contentWidth,
      contentHeight: before.contentHeight
    });
    assert.deepEqual(consoleErrors, []);
  } finally {
    await page.close();
    await browser.close();
    if (directory) await rm(directory, { recursive: true, force: true });
  }
});

test("编辑器顶部工具栏为课件保留空间且干净序列化不含临时留白", async () => {
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  let directory = "";
  try {
    directory = await openNestedSceneEditor(page);
    const layout = await page.evaluate(() => {
      const editor = window.__htmlSlideMenderBootstrap.editor;
      const toolbarRect = editor.toolbar.getBoundingClientRect();
      const headingRect = document.querySelector("h1").getBoundingClientRect();
      return {
        toolbarBottom: Math.round(toolbarRect.bottom),
        headingTop: Math.round(headingRect.top),
        hasSafeArea: Boolean(document.querySelector('[data-hsm-editor="top-safe-area"]'))
      };
    });
    assert.equal(layout.hasSafeArea, true);
    assert.ok(layout.headingTop >= layout.toolbarBottom + 8, JSON.stringify(layout));

    const serialized = await page.evaluate(async () => {
      const html = await window.__htmlSlideMenderBootstrap.editor.serializeCleanHtml("basic");
      const parsed = new DOMParser().parseFromString(html, "text/html");
      return {
        hasSafeArea: Boolean(parsed.querySelector('[data-hsm-editor="top-safe-area"]')),
        hasSafeAreaText: html.includes("--hsm-editor-top-safe-area")
      };
    });
    assert.deepEqual(serialized, { hasSafeArea: false, hasSafeAreaText: false });
  } finally {
    await page.close();
    await browser.close();
    if (directory) await rm(directory, { recursive: true, force: true });
  }
});

test("真实点击弹窗后场景树与可见标题位置同步，逐层返回保留活动节点状态", async () => {
  const browser = await launchBrowser();
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  let directory = "";
  try {
    directory = await openRealClickSceneEditor(page);
    await page.evaluate(() => {
      const editor = window.__htmlSlideMenderBootstrap.editor;
      window.__realClickIntroReference = document.querySelector("#intro");
      window.__realClickDetailReference = document.querySelector("#detail");
      document.querySelector("#toggle-tip").addEventListener("click", (event) => {
        event.currentTarget.dataset.runCount = String(Number(event.currentTarget.dataset.runCount || 0) + 1);
        event.stopImmediatePropagation();
      }, { capture: true });
      editor.enterInteractionMode();
      editor.startInteractionPreview();
    });

    await page.locator("[data-hsm-page-sidebar] .hsm-page-sidebar-close").click();
    await page.locator("#open-intro").click();
    await page.waitForFunction(() => window.__htmlSlideMenderBootstrap.editor.interactionPreviewModalStack?.length === 1);
    const outerLocation = await page.evaluate(() => ({
      breadcrumb: document.querySelector("[data-hsm-scene-breadcrumb]").textContent,
      outerCurrent: document.querySelector('[data-hsm-open-scene="scene:modal:p001:open-course"]')?.getAttribute("aria-current"),
      innerCurrent: document.querySelector('[data-hsm-open-scene="scene:modal:p001:open-detail"]')?.getAttribute("aria-current")
    }));
    assert.match(outerLocation.breadcrumb, /首页.*课程介绍/);
    assert.equal(outerLocation.outerCurrent, "true");
    assert.notEqual(outerLocation.innerCurrent, "true");
    assert.doesNotMatch(outerLocation.breadcrumb, /technical-file-name|scene:|open-course/);

    await page.locator("#teacher-note").fill("教师已输入");
    await page.locator("#toggle-tip").click();
    await page.locator("#open-detail").click();
    await page.waitForFunction(() => window.__htmlSlideMenderBootstrap.editor.interactionPreviewModalStack?.length === 2);
    const innerLocation = await page.evaluate(() => ({
      breadcrumb: document.querySelector("[data-hsm-scene-breadcrumb]").textContent,
      outerCurrent: document.querySelector('[data-hsm-open-scene="scene:modal:p001:open-course"]')?.getAttribute("aria-current"),
      innerCurrent: document.querySelector('[data-hsm-open-scene="scene:modal:p001:open-detail"]')?.getAttribute("aria-current")
    }));
    assert.match(innerLocation.breadcrumb, /首页.*课程介绍.*任务详情/);
    assert.equal(innerLocation.outerCurrent, "true");
    assert.equal(innerLocation.innerCurrent, "true");

    await page.locator('[data-action="close-interaction-preview-modal"]').click();
    await page.waitForFunction(() => window.__htmlSlideMenderBootstrap.editor.interactionPreviewModalStack?.length === 1);
    const returnedToParent = await page.evaluate(() => {
      const content = window.__htmlSlideMenderBootstrap.editor.shadow
        .querySelector('[data-role="interaction-preview-dialog-content"]');
      return {
        breadcrumb: document.querySelector("[data-hsm-scene-breadcrumb]").textContent,
        outerCurrent: document.querySelector('[data-hsm-open-scene="scene:modal:p001:open-course"]')?.getAttribute("aria-current"),
        innerCurrent: document.querySelector('[data-hsm-open-scene="scene:modal:p001:open-detail"]')?.getAttribute("aria-current"),
        inputValue: content.querySelector("#teacher-note")?.value,
        originalEventRunCount: content.querySelector("#toggle-tip")?.dataset.runCount
      };
    });
    assert.match(returnedToParent.breadcrumb, /首页.*课程介绍/);
    assert.doesNotMatch(returnedToParent.breadcrumb, /任务详情/);
    assert.equal(returnedToParent.outerCurrent, "true");
    assert.notEqual(returnedToParent.innerCurrent, "true");
    assert.equal(returnedToParent.inputValue, "教师已输入");
    assert.equal(returnedToParent.originalEventRunCount, "1");

    await page.locator('[data-action="close-interaction-preview-modal"]').click();
    await page.waitForFunction(() => window.__htmlSlideMenderBootstrap.editor.interactionPreviewModalStack?.length === 0);
    const returnedHome = await page.evaluate(() => ({
      breadcrumb: document.querySelector("[data-hsm-scene-breadcrumb]").textContent,
      outerCurrent: document.querySelector('[data-hsm-open-scene="scene:modal:p001:open-course"]')?.getAttribute("aria-current"),
      innerCurrent: document.querySelector('[data-hsm-open-scene="scene:modal:p001:open-detail"]')?.getAttribute("aria-current"),
      introIsOriginal: document.querySelector("#intro") === window.__realClickIntroReference,
      detailIsOriginal: document.querySelector("#detail") === window.__realClickDetailReference,
      introHidden: document.querySelector("#intro")?.hidden,
      detailHidden: document.querySelector("#detail")?.hidden,
      inputValue: document.querySelector("#teacher-note")?.value,
      focusedId: document.activeElement?.id
    }));
    assert.deepEqual(returnedHome, {
      breadcrumb: "首页",
      outerCurrent: "false",
      innerCurrent: "false",
      introIsOriginal: true,
      detailIsOriginal: true,
      introHidden: true,
      detailHidden: true,
      inputValue: "教师已输入",
      focusedId: "open-intro"
    });
    assert.deepEqual(consoleErrors, []);
  } finally {
    await page.close();
    await browser.close();
    if (directory) await rm(directory, { recursive: true, force: true });
  }
});

test("场景目标缺失时保持当前页面并给出人话提示", async () => {
  const browser = await launchBrowser();
  const page = await browser.newPage();
  let directory = "";
  try {
    directory = await openNestedSceneEditor(page);
    await page.evaluate(() => document.querySelector("#detail").remove());
    await clickSceneTreeNode(page, "scene:modal:p001:inner");
    await page.waitForFunction(() => document.querySelector("[data-hsm-scene-message]")?.textContent.length > 0);
    assert.equal(
      await page.locator("[data-hsm-scene-message]").textContent(),
      "这个画面暂时无法打开，可以从课件中的原按钮进入"
    );
    assert.equal(await page.evaluate(() => window.__htmlSlideMenderBootstrap.editor.sceneNavigationStack?.length || 0), 0);
    assert.equal(await page.locator("h1").textContent(), "首页");
  } finally {
    await page.close();
    await browser.close();
    if (directory) await rm(directory, { recursive: true, force: true });
  }
});

test("场景目标重复时不猜测目标也不改变当前画面", async () => {
  const browser = await launchBrowser();
  const page = await browser.newPage();
  let directory = "";
  try {
    directory = await openNestedSceneEditor(page);
    await page.evaluate(() => {
      const duplicate = document.querySelector("#detail").cloneNode(true);
      document.body.append(duplicate);
    });
    await clickSceneTreeNode(page, "scene:modal:p001:inner");
    await page.waitForFunction(() => document.querySelector("[data-hsm-scene-message]")?.textContent.length > 0);
    assert.equal(
      await page.locator("[data-hsm-scene-message]").textContent(),
      "这个画面暂时无法打开，可以从课件中的原按钮进入"
    );
    assert.equal(await page.evaluate(() => window.__htmlSlideMenderBootstrap.editor.sceneNavigationStack?.length || 0), 0);
    assert.equal(await page.locator("#intro").getAttribute("hidden"), "");
  } finally {
    await page.close();
    await browser.close();
    if (directory) await rm(directory, { recursive: true, force: true });
  }
});
