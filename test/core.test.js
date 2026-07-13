import assert from "node:assert/strict";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Script } from "node:vm";
import unzipper from "unzipper";
import { ZipArchive } from "archiver";
import * as core from "../src/core.js";
import {
  commitProjectPageEdit,
  createEditableProject,
  createProjectVersion,
  discoverProjectPages,
  extractProjectZip,
  injectProjectPreviewToolbar,
  injectVersionSaveButton,
  isHtmlFile,
  isZipFile,
  makeEditableHtml,
  normalizeProjectRelativePath,
  sanitizeFileName,
  zipProjectDirectory,
  zipOutputs
} from "../src/core.js";

test("sanitizeFileName keeps safe names readable and removes path tricks", () => {
  assert.equal(sanitizeFileName("../../我的 演示<script>.html"), "wo-de-yan-shi-script.html");
  assert.equal(sanitizeFileName("deck final.HTML"), "deck-final.html");
  assert.equal(sanitizeFileName("..."), "deck.html");
});

test("isHtmlFile accepts only .html and .htm files", () => {
  assert.equal(isHtmlFile("lesson.html"), true);
  assert.equal(isHtmlFile("lesson.htm"), true);
  assert.equal(isHtmlFile("lesson.pdf"), false);
  assert.equal(isHtmlFile("lesson.html.png"), false);
});

test("isZipFile accepts only .zip files", () => {
  assert.equal(isZipFile("deck.zip"), true);
  assert.equal(isZipFile("deck.ZIP"), true);
  assert.equal(isZipFile("deck.zip.html"), false);
});

test("makeEditableHtml injects the editor runtime into an uploaded deck", async () => {
  const temp = await mkdtemp(join(tmpdir(), "html-mender-local-test-"));
  try {
    const input = join(temp, "deck.html");
    const output = join(temp, "deck.editable.html");
    await writeFile(input, "<!doctype html><html><body><h1>Hello</h1></body></html>", "utf8");

    await makeEditableHtml({ inputPath: input, outputPath: output, lang: "zh-CN" });

    const html = await readFile(output, "utf8");
    assert.match(html, /html-slide-mender-skill:start/);
    assert.match(html, /Hello/);
    assert.match(html, /const skillInteractionRuntime =/);
    assert.match(html, /HTML_MENDER_INTERACTIONS_RUNTIME/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("interaction runtime supports click and keyboard toggle events", async () => {
  const runtime = await readFile(
    new URL("../vendor/html-slide-mender/assets/html-slide-mender-interactions.js", import.meta.url),
    "utf8"
  );

  assert.match(runtime, /HTML_MENDER_INTERACTIONS_RUNTIME/);
  assert.match(runtime, /data-hsm-interaction-manifest/);
  assert.match(runtime, /data-hsm-node-id/);
  assert.match(runtime, /toggleVisibility/);
  assert.match(runtime, /addEventListener\("click"/);
  assert.match(runtime, /addEventListener\("keydown"/);
  assert.match(runtime, /prefers-reduced-motion/);
  assert.match(runtime, /hsm-interaction-event/);
});

test("createStaticThumbnailHtml removes scripts and preserves relative resources", () => {
  assert.equal(typeof core.createStaticThumbnailHtml, "function");
  const html = core.createStaticThumbnailHtml(
    '<!doctype html><html><head><script>window.run = true</script></head><body onload="start()"><h1 onclick="reveal()">第 1 页</h1><a href="javascript:next()">下一页</a><img src="assets/photo.png"><script data-hsm-project-toolbar>toolbar()</script></body></html>',
    "/projects/project-123/output/course/"
  );

  assert.doesNotMatch(html, /<script\b/i);
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i);
  assert.doesNotMatch(html, /javascript:/i);
  assert.match(html, /<base href="\/projects\/project-123\/output\/course\/">/);
  assert.match(html, /<h1>第 1 页<\/h1>/);
  assert.match(html, /src="assets\/photo\.png"/);
});

test("zipOutputs creates an archive containing every generated deck", async () => {
  const temp = await mkdtemp(join(tmpdir(), "html-mender-local-zip-test-"));
  try {
    const first = join(temp, "first.editable.html");
    const second = join(temp, "second.editable.html");
    const archive = join(temp, "decks.zip");
    await writeFile(first, "<html>first</html>", "utf8");
    await writeFile(second, "<html>second</html>", "utf8");

    await zipOutputs({
      archivePath: archive,
      files: [
        { path: first, name: "first.editable.html" },
        { path: second, name: "second.editable.html" }
      ]
    });

    const bytes = await readFile(archive);
    assert.equal(bytes.subarray(0, 2).toString("utf8"), "PK");
    assert.ok(bytes.length > 100);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("zipOutputs gives duplicate archive entries unique names", async () => {
  const temp = await mkdtemp(join(tmpdir(), "html-mender-local-zip-name-test-"));
  try {
    const first = join(temp, "first.editable.html");
    const second = join(temp, "second.editable.html");
    const archive = join(temp, "decks.zip");
    await writeFile(first, "<html>first</html>", "utf8");
    await writeFile(second, "<html>second</html>", "utf8");

    const result = await zipOutputs({
      archivePath: archive,
      files: [
        { path: first, name: "deck.editable.html" },
        { path: second, name: "deck.editable.html" }
      ]
    });

    assert.deepEqual(result.entries, ["deck-editable.html", "deck-editable-2.html"]);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("extractProjectZip expands a project and prefers index.html as the entry", async () => {
  const temp = await mkdtemp(join(tmpdir(), "html-mender-project-test-"));
  try {
    const archive = join(temp, "project.zip");
    const sourceDir = join(temp, "source");
    await createZip(archive, [
      { name: "slides/other.html", content: "<html>other</html>" },
      { name: "index.html", content: '<html><body><img src="assets/cover.png"></body></html>' },
      { name: "assets/cover.png", content: "fake image bytes" },
      { name: "media/demo.mp4", content: "fake video bytes" }
    ]);

    const result = await extractProjectZip({ zipPath: archive, targetDir: sourceDir });

    assert.equal(result.entryHtml, "index.html");
    assert.deepEqual(result.mediaCounts, { html: 2, image: 1, video: 1, other: 0 });
    assert.equal(await readFile(join(sourceDir, "assets/cover.png"), "utf8"), "fake image bytes");
    assert.equal(await readFile(join(sourceDir, "media/demo.mp4"), "utf8"), "fake video bytes");
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("normalizeProjectRelativePath rejects paths that escape the project directory", () => {
  assert.throws(() => normalizeProjectRelativePath("../evil.html"), /unsafe zip entry/i);
  assert.throws(() => normalizeProjectRelativePath("/evil.html"), /unsafe zip entry/i);
  assert.throws(() => normalizeProjectRelativePath("slides/../../evil.html"), /unsafe zip entry/i);
  assert.equal(normalizeProjectRelativePath("slides/index.html"), "slides/index.html");
});

test("discoverProjectPages expands iframe courseware pages in natural order", async () => {
  const temp = await mkdtemp(join(tmpdir(), "html-mender-pages-test-"));
  try {
    const sourceDir = join(temp, "source");
    await mkdir(join(sourceDir, "lesson"), { recursive: true });
    await writeFile(join(sourceDir, "lesson", "index.html"), '<html><body><iframe src="p1.html"></iframe></body></html>', "utf8");
    await writeFile(join(sourceDir, "lesson", "p10.html"), "<html>page 10</html>", "utf8");
    await writeFile(join(sourceDir, "lesson", "p2.html"), "<html>page 2</html>", "utf8");
    await writeFile(join(sourceDir, "lesson", "p1.html"), "<html>page 1</html>", "utf8");

    const pages = await discoverProjectPages({
      sourceDir,
      entryHtml: "lesson/index.html",
      files: ["lesson/index.html", "lesson/p10.html", "lesson/p2.html", "lesson/p1.html"]
    });

    assert.deepEqual(pages.map((page) => page.sourceRelativePath), [
      "lesson/p1.html",
      "lesson/p2.html",
      "lesson/p10.html"
    ]);
    assert.deepEqual(pages.map((page) => page.label), ["第 1 页", "第 2 页", "第 10 页"]);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("createEditableProject and zipProjectDirectory keep project resources together", async () => {
  const temp = await mkdtemp(join(tmpdir(), "html-mender-project-export-test-"));
  try {
    const sourceDir = join(temp, "source");
    const outputDir = join(temp, "output");
    const archive = join(temp, "export.zip");
    await mkdir(join(sourceDir, "assets"), { recursive: true });
    await writeFile(join(sourceDir, "index.html"), '<html><body><img src="assets/cover.png"></body></html>', "utf8");
    await writeFile(join(sourceDir, "assets/cover.png"), "fake image bytes", "utf8");

    const project = await createEditableProject({
      sourceDir,
      outputDir,
      entryHtml: "index.html"
    });

    assert.equal(project.editRelativePath, "index.editable.html");
    assert.equal(project.pages.length, 1);
    assert.equal(await readFile(join(outputDir, "assets/cover.png"), "utf8"), "fake image bytes");
    assert.match(await readFile(join(outputDir, "index.editable.html"), "utf8"), /html-slide-mender-skill:start/);

    const result = await zipProjectDirectory({ directoryPath: outputDir, archivePath: archive });
    assert.ok(result.entries.includes("assets/cover.png"));
    assert.ok(result.entries.includes("index.html"));
    assert.ok(result.entries.includes("index.editable.html"));

    const directory = await unzipper.Open.file(archive);
    assert.deepEqual(
      directory.files.map((file) => file.path).sort(),
      ["assets/cover.png", "index.html", "index.editable.html"].sort()
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("createEditableProject generates editable files for every courseware page", async () => {
  const temp = await mkdtemp(join(tmpdir(), "html-mender-project-pages-test-"));
  try {
    const sourceDir = join(temp, "source");
    const outputDir = join(temp, "output");
    await mkdir(join(sourceDir, "course", "assets"), { recursive: true });
    await writeFile(join(sourceDir, "course", "index.html"), '<html><body><iframe src="p1.html"></iframe></body></html>', "utf8");
    await writeFile(join(sourceDir, "course", "p1.html"), '<html><body><h1>第一页</h1><img src="assets/cover.png"></body></html>', "utf8");
    await writeFile(join(sourceDir, "course", "p2.html"), "<html><body><h1>第二页</h1></body></html>", "utf8");
    await writeFile(join(sourceDir, "course", "assets", "cover.png"), "fake image bytes", "utf8");

    const project = await createEditableProject({
      sourceDir,
      outputDir,
      entryHtml: "course/index.html",
      files: ["course/index.html", "course/p1.html", "course/p2.html", "course/assets/cover.png"]
    });

    assert.equal(project.editRelativePath, "course/p1.editable.html");
    assert.deepEqual(project.pages.map((page) => page.editRelativePath), [
      "course/p1.editable.html",
      "course/p2.editable.html"
    ]);
    assert.match(await readFile(join(outputDir, "course", "p1.editable.html"), "utf8"), /第一页/);
    assert.match(await readFile(join(outputDir, "course", "p2.editable.html"), "utf8"), /第二页/);
    assert.equal(await readFile(join(outputDir, "course", "assets", "cover.png"), "utf8"), "fake image bytes");
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("createEditableProject can include every uploaded HTML as a task page", async () => {
  const temp = await mkdtemp(join(tmpdir(), "html-mender-html-task-pages-"));
  try {
    const sourceDir = join(temp, "source");
    const outputDir = join(temp, "output");
    await mkdir(sourceDir, { recursive: true });
    await writeFile(join(sourceDir, "lesson-a.html"), "<!doctype html><html><body>A</body></html>", "utf8");
    await writeFile(join(sourceDir, "lesson-b.html"), "<!doctype html><html><body>B</body></html>", "utf8");

    const task = await createEditableProject({
      sourceDir,
      outputDir,
      entryHtml: "lesson-a.html",
      files: ["lesson-a.html", "lesson-b.html"],
      includeEntry: true
    });

    assert.deepEqual(task.pages.map((page) => page.sourceRelativePath), ["lesson-a.html", "lesson-b.html"]);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("createPageVersion stores one clean page without copying project resources", async () => {
  const { createPageVersion } = await import("../src/core.js");
  assert.equal(typeof createPageVersion, "function", "page version storage is not implemented");
  const temp = await mkdtemp(join(tmpdir(), "html-mender-page-version-"));
  try {
    const version = await createPageVersion({
      versionsDir: join(temp, "versions"),
      pageId: "p002",
      versionId: "v003",
      html: "<!doctype html><html><body>第三版</body></html>",
      note: "保存第 2 页"
    });

    assert.equal(version.id, "v003");
    assert.equal(version.key, "p002-v003");
    assert.equal(await readFile(version.htmlPath, "utf8"), "<!doctype html><html><body>第三版</body></html>");
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("createProjectVersion stores clean HTML with project resources", async () => {
  const temp = await mkdtemp(join(tmpdir(), "html-mender-version-test-"));
  try {
    const baseDir = join(temp, "output");
    const versionDir = join(temp, "versions", "v001");
    await mkdir(join(baseDir, "assets"), { recursive: true });
    await writeFile(join(baseDir, "index.editable.html"), "<html>editable shell</html>", "utf8");
    await writeFile(join(baseDir, "assets/cover.png"), "fake image bytes", "utf8");

    const version = await createProjectVersion({
      baseDir,
      versionDir,
      versionId: "v001",
      entryHtml: "index.html",
      html: "<!doctype html><html><body>clean v1</body></html>",
      excludeRelativePath: "index.editable.html",
      note: "初始版本"
    });

    assert.equal(version.id, "v001");
    assert.equal(version.note, "初始版本");
    assert.equal(await readFile(join(versionDir, "index.html"), "utf8"), "<!doctype html><html><body>clean v1</body></html>");
    assert.equal(await readFile(join(versionDir, "assets/cover.png"), "utf8"), "fake image bytes");

    const directory = await unzipper.Open.file(version.archivePath);
    assert.deepEqual(
      directory.files.map((file) => file.path).sort(),
      ["assets/cover.png", "index.html"].sort()
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("commitProjectPageEdit writes the saved page back and rebuilds its editable page", async () => {
  const temp = await mkdtemp(join(tmpdir(), "html-mender-commit-page-test-"));
  try {
    const sourceDir = join(temp, "source");
    const outputDir = join(temp, "output");
    await mkdir(join(sourceDir, "course"), { recursive: true });
    await writeFile(join(sourceDir, "course", "index.html"), '<html><body><iframe src="p1.html"></iframe></body></html>', "utf8");
    await writeFile(join(sourceDir, "course", "p1.html"), "<html><body><h1>旧内容</h1></body></html>", "utf8");

    const project = await createEditableProject({
      sourceDir,
      outputDir,
      entryHtml: "course/index.html",
      files: ["course/index.html", "course/p1.html"]
    });
    await injectVersionSaveButton({
      htmlPath: join(outputDir, "course", "p1.editable.html"),
      projectId: "project-123",
      editRelativePath: project.pages[0].editRelativePath
    });

    const result = await commitProjectPageEdit({
      sourceDir,
      outputDir,
      projectId: "project-123",
      sourceRelativePath: project.pages[0].sourceRelativePath,
      editRelativePath: project.pages[0].editRelativePath,
      html: "<!doctype html><html><body><h1>新内容</h1></body></html>"
    });

    assert.equal(result.sourceRelativePath, "course/p1.html");
    assert.match(await readFile(join(sourceDir, "course", "p1.html"), "utf8"), /新内容/);
    assert.match(await readFile(join(outputDir, "course", "p1.html"), "utf8"), /新内容/);
    const editableHtml = await readFile(join(outputDir, "course", "p1.editable.html"), "utf8");
    assert.match(editableHtml, /新内容/);
    assert.match(editableHtml, /data-hsm-version-save/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("injectVersionSaveButton adds local version save controls to editable HTML", async () => {
  const temp = await mkdtemp(join(tmpdir(), "html-mender-version-button-test-"));
  try {
    const htmlPath = join(temp, "index.editable.html");
    await writeFile(htmlPath, "<!doctype html><html><body><h1>Deck</h1></body></html>", "utf8");

    await injectVersionSaveButton({
      htmlPath,
      projectId: "project-123",
      editRelativePath: "index.editable.html"
    });

    const html = await readFile(htmlPath, "utf8");
    assert.match(html, /data-hsm-version-save/);
    assert.match(html, /project-123/);
    assert.match(html, /\/api\/projects\//);
    assert.match(html, /\/versions/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("injectVersionSaveButton inserts controls at the real document body end", async () => {
  const temp = await mkdtemp(join(tmpdir(), "html-mender-version-body-test-"));
  try {
    const htmlPath = join(temp, "index.editable.html");
    await writeFile(
      htmlPath,
      '<!doctype html><html><body><script>const original = "</body>";</script><h1>Deck</h1></body></html>',
      "utf8"
    );

    await injectVersionSaveButton({
      htmlPath,
      projectId: "project-123",
      editRelativePath: "index.editable.html"
    });

    const html = await readFile(htmlPath, "utf8");
    assert.match(html, /const original = "<\/body>";<\/script><h1>Deck<\/h1>/);
    assert.ok(
      html.indexOf("<!-- hsm-local-version-save:start -->") > html.indexOf("<h1>Deck</h1>"),
      "version controls should be inserted after real page content, not inside script text"
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("injectVersionSaveButton adds project navigation links when page navigation is provided", async () => {
  const temp = await mkdtemp(join(tmpdir(), "html-mender-version-nav-test-"));
  try {
    const htmlPath = join(temp, "p2.editable.html");
    await writeFile(htmlPath, "<!doctype html><html><body><h1>Page 2</h1></body></html>", "utf8");

    await injectVersionSaveButton({
      htmlPath,
      projectId: "project-123",
      editRelativePath: "course/p2.editable.html",
      pageNav: {
        projectUrl: "/?project=project-123",
        taskName: "语文课件",
        pageLabel: "第 2 页",
        previewUrl: "/projects/project-123/output/course/p2.html",
        previousUrl: "/projects/project-123/output/course/p1.editable.html",
        nextUrl: "/projects/project-123/output/course/p3.editable.html",
        pages: [
          {
            label: "第 1 页",
            title: "导入页",
            editUrl: "/projects/project-123/output/course/p1.editable.html",
            viewUrl: "/projects/project-123/output/course/p1.html"
          },
          {
            label: "第 2 页",
            title: "当前页",
            editUrl: "/projects/project-123/output/course/p2.editable.html",
            viewUrl: "/projects/project-123/output/course/p2.html",
            current: true
          },
          {
            label: "第 3 页",
            title: "练习页",
            editUrl: "/projects/project-123/output/course/p3.editable.html",
            viewUrl: "/projects/project-123/output/course/p3.html"
          }
        ]
      }
    });

    const html = await readFile(htmlPath, "utf8");
    assert.match(html, /返回列表/);
    assert.match(html, /退出编辑/);
    assert.match(html, /复制 HTML/);
    assert.match(html, /保存后离开/);
    assert.match(html, /已成功保存/);
    assert.match(html, /navigator\.clipboard/);
    assert.match(html, /data-hsm-editor/);
    assert.match(html, /data-action.*exit/);
    assert.match(html, /上一页/);
    assert.match(html, /下一页/);
    assert.match(html, /页面列表/);
    assert.match(html, /data-hsm-page-sidebar/);
    assert.match(html, /hsm-page-thumb/);
    assert.match(html, /data-hsm-page-preview/);
    assert.match(html, /data-preview-url/);
    assert.match(html, /sandbox="allow-same-origin"/);
    assert.match(html, /IntersectionObserver/);
    assert.match(html, /loading="lazy"/);
    assert.match(html, /aria-current/);
    assert.match(html, /第 3 页/);
    assert.match(html, /练习页/);
    assert.match(html, /project=project-123/);
    assert.match(html, /p3\.editable\.html/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("injectVersionSaveButton exposes page management controls in the editor sidebar", async () => {
  const temp = await mkdtemp(join(tmpdir(), "html-mender-page-sidebar-management-"));
  try {
    const htmlPath = join(temp, "page.editable.html");
    await writeFile(htmlPath, "<!doctype html><html><body>页面</body></html>", "utf8");
    await injectVersionSaveButton({
      htmlPath,
      projectId: "project-pages",
      editRelativePath: "page.editable.html",
      pageNav: {
        projectUrl: "/?project=project-pages",
        taskName: "页面管理",
        pageLabel: "第 1 页",
        currentVersionId: "v001",
        pages: [
          { id: "p001", label: "第 1 页", editUrl: "/p1.editable.html", viewUrl: "/p1.html", current: true },
          { id: "p002", label: "第 2 页", editUrl: "/p2.editable.html", viewUrl: "/p2.html", current: false }
        ]
      }
    });

    const html = await readFile(htmlPath, "utf8");
    assert.match(html, /data-hsm-create-page/);
    assert.match(html, /\.hsm-page-sidebar \{[\s\S]*?z-index: 2147483647;/);
    assert.match(html, /#html-slide-mender-root \{[\s\S]*?z-index: 2147483645 !important;/);
    assert.match(html, /data-hsm-page-drag-handle/);
    assert.match(html, /data-hsm-move-page/);
    assert.match(html, /data-hsm-duplicate-page/);
    assert.match(html, /data-hsm-delete-page/);
    assert.match(html, /\/api\/projects\/.*\/pages\/order/);
    assert.match(html, /pointerdown/);
    assert.match(html, /pointermove/);
    assert.match(html, /pointerup/);
    assert.match(html, /mousedown/);
    assert.match(html, /mousemove/);
    assert.match(html, /mouseup/);
    assert.match(html, /setPointerCapture/);
    assert.match(html, /if \(sidebarPointerDrag\)[\s\S]*?preventDefault/);
    assert.doesNotMatch(html, /<button[^>]*draggable="true"[^>]*data-hsm-page-drag-handle/);
    const injectedScript = html.match(/<script data-hsm-version-save>([\s\S]*?)<\/script>/)?.[1];
    assert.ok(injectedScript, "应生成版本保存与页面管理脚本");
    assert.doesNotThrow(() => new Script(injectedScript));
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("injectProjectPreviewToolbar adds edit and navigation controls to preview HTML", async () => {
  const temp = await mkdtemp(join(tmpdir(), "html-mender-preview-toolbar-test-"));
  try {
    const htmlPath = join(temp, "p2.html");
    await writeFile(htmlPath, "<!doctype html><html><body><h1>Preview Page 2</h1></body></html>", "utf8");

    await injectProjectPreviewToolbar({
      htmlPath,
      pageLabel: "第 2 页",
      toolbar: {
        projectUrl: "/?project=project-123",
        editUrl: "/projects/project-123/output/course/p2.editable.html",
        previousUrl: "/projects/project-123/output/course/p1.html",
        nextUrl: "/projects/project-123/output/course/p3.html",
        latestVersionId: "v004",
        lastSavedAt: "2026-06-26T08:00:00.000Z"
      }
    });

    const html = await readFile(htmlPath, "utf8");
    assert.match(html, /data-hsm-project-toolbar/);
    assert.match(html, /第 2 页/);
    assert.match(html, /编辑本页/);
    assert.match(html, /返回列表/);
    assert.match(html, /上一页/);
    assert.match(html, /下一页/);
    assert.match(html, /v004/);
    assert.match(html, /p2\.editable\.html/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

async function createZip(archivePath, entries) {
  await mkdir(join(archivePath, ".."), { recursive: true });
  return new Promise((resolvePromise, reject) => {
    const output = createWriteStream(archivePath);
    const archive = new ZipArchive({ zlib: { level: 9 } });

    output.on("close", resolvePromise);
    output.on("error", reject);
    archive.on("error", reject);
    archive.pipe(output);

    for (const entry of entries) {
      archive.append(entry.content, { name: entry.name });
    }

    archive.finalize();
  });
}
