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

async function openNestedSceneEditor(page) {
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
      '<h2 id="intro-title">课程介绍</h2><label>教师记录<input id="teacher-note" value="初始内容"></label>'
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
    await page.locator('[data-hsm-open-scene="scene:modal:p001:outer"]').click();
    await page.waitForFunction(() => window.__htmlSlideMenderBootstrap.editor.sceneNavigationStack?.length === 1);
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

    await page.locator('[data-hsm-open-scene="scene:modal:p001:inner"]').click();
    await page.waitForFunction(() => window.__htmlSlideMenderBootstrap.editor.sceneNavigationStack?.length === 2);
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

    await page.locator('[data-hsm-scene-breadcrumb] button', { hasText: "课程介绍" }).click();
    await page.waitForFunction(() => window.__htmlSlideMenderBootstrap.editor.sceneNavigationStack?.length === 1);
    assert.equal(await page.locator("[data-hsm-scene-content] #teacher-note").inputValue(), "教师已输入");
    await page.locator('[data-hsm-scene-breadcrumb] button', { hasText: "首页" }).click();
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

    await page.locator('[data-hsm-open-scene="scene:modal:p001:outer"]').click();
    await page.waitForFunction(() => window.__htmlSlideMenderBootstrap.editor.sceneNavigationStack?.length === 1);
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => window.__htmlSlideMenderBootstrap.editor.sceneNavigationStack?.length === 0);

    await page.locator('[data-hsm-open-scene="scene:modal:p001:inner"]').click();
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

test("场景目标缺失时保持当前页面并给出人话提示", async () => {
  const browser = await launchBrowser();
  const page = await browser.newPage();
  let directory = "";
  try {
    directory = await openNestedSceneEditor(page);
    await page.evaluate(() => document.querySelector("#detail").remove());
    await page.locator('[data-hsm-open-scene="scene:modal:p001:inner"]').click();
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
    await page.locator('[data-hsm-open-scene="scene:modal:p001:inner"]').click();
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
