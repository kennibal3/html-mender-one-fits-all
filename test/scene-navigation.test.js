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
    return Boolean(editor?.shadow?.querySelector?.(`[data-item-id='${CSS.escape(id)}']`));
  }, itemId);
  const center = await page.evaluate((id) => {
    const editor = window.__htmlSlideMenderBootstrap.editor;
    const box = editor.shadow.querySelector(`[data-item-id='${CSS.escape(id)}']`);
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
