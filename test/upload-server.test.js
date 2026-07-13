import assert from "node:assert/strict";
import { createWriteStream } from "node:fs";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ZipArchive } from "archiver";
import unzipper from "unzipper";

test("multiple HTML uploads create one named task that survives restart", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "html-mender-upload-server-"));
  process.env.HTML_MENDER_DATA_DIR = dataDir;
  const { startServer } = await import(`../src/server.js?upload-test=${Date.now()}`);
  const runtime = await startServer({ host: "127.0.0.1", port: 0 });
  let projectId = "";

  try {
    const form = new FormData();
    form.append("taskName", "七年级语文任务");
    form.append("files", new Blob([
      "<!doctype html><html><body><h1>可编辑课件</h1></body></html>"
    ], { type: "text/plain" }), "lesson.txt");
    form.append("files", new Blob([
      "<!doctype html><html><body><h1>第二页</h1></body></html>"
    ], { type: "text/html" }), "second.html");

    const response = await fetch(`${runtime.url}/api/upload`, { method: "POST", body: form });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.project.status, "ready");
    assert.equal(payload.project.name, "七年级语文任务");
    assert.equal(payload.project.pageCount, 2);
    assert.equal(payload.project.pages[0].latestVersionId, "v001");
    assert.equal(payload.project.editorRuntimeVersion, 20);
    projectId = payload.project.id;

    const editable = await fetch(`${runtime.url}${payload.project.pages[0].editUrl}`).then((result) => result.text());
    assert.match(editable, /html-slide-mender-skill:start/);
    assert.match(editable, /可编辑课件/);
    assert.match(editable, /页面列表/);
    assert.match(editable, /data-hsm-page-sidebar/);
    const thumbnail = await fetch(
      `${runtime.url}/api/projects/${payload.project.id}/pages/${payload.project.pages[0].id}/thumbnail`
    ).then((result) => result.text());
    assert.match(thumbnail, /<base href=/);
    assert.match(thumbnail, /可编辑课件/);
    assert.doesNotMatch(thumbnail, /<script\b/i);
    assert.match(editable, /第 2 页/);
    assert.match(editable, /second\.html/);
    assert.match(editable, /second\.editable\.html/);
  } finally {
    await runtime.close();
  }

  const metaPath = join(dataDir, "projects", projectId, "meta.json");
  const legacyMeta = JSON.parse(await readFile(metaPath, "utf8"));
  legacyMeta.editorRuntimeVersion = 19;
  await writeFile(metaPath, JSON.stringify(legacyMeta, null, 2), "utf8");

  const restartedModule = await import(`../src/server.js?restart-test=${Date.now()}`);
  const restarted = await restartedModule.startServer({ host: "127.0.0.1", port: 0 });
  try {
    const payload = await fetch(`${restarted.url}/api/projects`).then((result) => result.json());
    assert.equal(payload.projects.length, 1);
    assert.equal(payload.projects[0].name, "七年级语文任务");
    assert.equal(payload.projects[0].pageCount, 2);
    assert.equal(payload.projects[0].editorRuntimeVersion, 20);
    const upgradedEditable = await fetch(`${restarted.url}${payload.projects[0].pages[0].editUrl}`).then((result) => result.text());
    assert.match(upgradedEditable, /sidebarMouseDrag/);
    assert.match(upgradedEditable, /#html-slide-mender-root \{[\s\S]*?z-index: 2147483645 !important;/);
    assert.match(upgradedEditable, /data-action="add-text"/);
    assert.match(upgradedEditable, /data-action="group-elements"/);
    assert.match(upgradedEditable, /data-action="layout-distribute-horizontal"/);
  } finally {
    await restarted.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("each task page has independent versions and restoration creates a new version", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "html-mender-page-version-server-"));
  process.env.HTML_MENDER_DATA_DIR = dataDir;
  const { startServer } = await import(`../src/server.js?page-version-test=${Date.now()}`);
  const runtime = await startServer({ host: "127.0.0.1", port: 0 });

  try {
    const form = new FormData();
    form.append("taskName", "独立版本任务");
    form.append("files", new Blob(["<!doctype html><html><body>第一页初始</body></html>"], { type: "text/html" }), "p1.html");
    form.append("files", new Blob(["<!doctype html><html><body>第二页初始</body></html>"], { type: "text/html" }), "p2.html");
    const created = await fetch(`${runtime.url}/api/upload`, { method: "POST", body: form }).then((result) => result.json());
    const [firstPage, secondPage] = created.project.pages;

    const save = (page, text) => fetch(`${runtime.url}/api/projects/${created.project.id}/versions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        editRelativePath: page.editRelativePath,
        html: `<!doctype html><html><body>${text}</body></html>`
      })
    }).then((result) => result.json());

    assert.equal((await save(firstPage, "第一页修改")).version.id, "v002");
    assert.equal((await save(secondPage, "第二页修改")).version.id, "v002");
    assert.equal((await save(firstPage, "第一页再次修改")).version.id, "v003");

    const project = await fetch(`${runtime.url}/api/projects`).then((result) => result.json()).then((payload) => payload.projects[0]);
    assert.deepEqual(project.pages[0].versions.map((version) => version.id), ["v001", "v002", "v003"]);
    assert.deepEqual(project.pages[1].versions.map((version) => version.id), ["v001", "v002"]);

    const restoredResponse = await fetch(`${runtime.url}/api/projects/${project.id}/pages/${firstPage.id}/restore`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ versionKey: `${firstPage.id}-v001` })
    });
    const restored = await restoredResponse.json();
    assert.equal(restoredResponse.status, 200);
    assert.equal(restored.version.id, "v004");
    const currentHtml = await fetch(`${runtime.url}${firstPage.viewUrl}`).then((result) => result.text());
    assert.match(currentHtml, /第一页初始/);
  } finally {
    await runtime.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("ZIP upload creates the same named task model with page versions", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "html-mender-zip-task-server-"));
  process.env.HTML_MENDER_DATA_DIR = dataDir;
  const zipPath = join(dataDir, "course.zip");
  await createZip(zipPath, [
    { name: "course/index.html", content: '<!doctype html><html><body><iframe src="p1.html"></iframe></body></html>' },
    { name: "course/p1.html", content: "<!doctype html><html><body>ZIP 第一页</body></html>" },
    { name: "course/p2.html", content: "<!doctype html><html><body>ZIP 第二页</body></html>" }
  ]);
  const { startServer } = await import(`../src/server.js?zip-task-test=${Date.now()}`);
  const runtime = await startServer({ host: "127.0.0.1", port: 0 });

  try {
    const form = new FormData();
    form.append("taskName", "ZIP 课程任务");
    form.append("project", new Blob([await readFile(zipPath)], { type: "application/zip" }), "course.zip");
    const response = await fetch(`${runtime.url}/api/projects/upload`, { method: "POST", body: form });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.project.name, "ZIP 课程任务");
    assert.equal(payload.project.kind, "zip");
    assert.equal(payload.project.pageCount, 2);
    assert.deepEqual(payload.project.pages.map((page) => page.latestVersionId), ["v001", "v001"]);
  } finally {
    await runtime.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("task export returns HTML for one page and ZIP for multiple pages", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "html-mender-export-server-"));
  process.env.HTML_MENDER_DATA_DIR = dataDir;
  const { startServer } = await import(`../src/server.js?export-test=${Date.now()}`);
  const runtime = await startServer({ host: "127.0.0.1", port: 0 });

  try {
    const createTask = async (name, files) => {
      const form = new FormData();
      form.append("taskName", name);
      files.forEach((content, index) => form.append(
        "files",
        new Blob([`<!doctype html><html><body>${content}</body></html>`], { type: "text/html" }),
        `page-${index + 1}.html`
      ));
      return fetch(`${runtime.url}/api/upload`, { method: "POST", body: form }).then((result) => result.json());
    };

    const single = await createTask("单页导出", ["单页内容"]);
    const singleExport = await fetch(`${runtime.url}/api/projects/${single.project.id}/export`);
    assert.match(singleExport.headers.get("content-type"), /text\/html/);
    assert.match(await singleExport.text(), /单页内容/);

    const multiple = await createTask("多页导出", ["第一页", "第二页"]);
    const multipleExport = await fetch(`${runtime.url}/api/projects/${multiple.project.id}/export`);
    assert.match(multipleExport.headers.get("content-type"), /application\/zip/);
    const bytes = new Uint8Array(await multipleExport.arrayBuffer());
    assert.equal(new TextDecoder().decode(bytes.slice(0, 2)), "PK");
  } finally {
    await runtime.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("page management creates, duplicates, reorders, soft deletes and restores pages", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "html-mender-page-management-"));
  process.env.HTML_MENDER_DATA_DIR = dataDir;
  const { startServer } = await import(`../src/server.js?page-management-test=${Date.now()}`);
  const runtime = await startServer({ host: "127.0.0.1", port: 0 });

  try {
    const form = new FormData();
    form.append("taskName", "页面管理任务");
    form.append("files", new Blob(['<!doctype html><html><body>原始第一页<script type="application/json" data-hsm-interaction-manifest="1">{"schemaVersion":"1.2","interactions":[{"id":"jump-p2","trigger":{"event":"click","nodeId":"trigger"},"action":{"type":"goToPage","pageId":"p002","href":"p2.html","pageLabel":"第 2 页"}}]}</script></body></html>'], { type: "text/html" }), "p1.html");
    form.append("files", new Blob(["<!doctype html><html><body>原始第二页</body></html>"], { type: "text/html" }), "p2.html");
    const created = await fetch(`${runtime.url}/api/upload`, { method: "POST", body: form }).then((result) => result.json());
    const [firstPage, secondPage] = created.project.pages;

    const blankResponse = await fetch(`${runtime.url}/api/projects/${created.project.id}/pages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ afterPageId: firstPage.id })
    });
    const blank = await blankResponse.json();
    assert.equal(blankResponse.status, 200);
    assert.equal(blank.project.pageCount, 3);
    assert.equal(blank.project.pages[1].id, blank.page.id);
    assert.equal(blank.page.latestVersionId, "v001");
    assert.deepEqual(blank.project.pages.map((page) => page.label), ["第 1 页", "第 2 页", "第 3 页"]);
    const blankHtml = await fetch(`${runtime.url}${blank.page.viewUrl}`).then((result) => result.text());
    assert.match(blankHtml, /空白课件页/);

    const duplicateResponse = await fetch(`${runtime.url}/api/projects/${created.project.id}/pages/${firstPage.id}/duplicate`, {
      method: "POST"
    });
    const duplicate = await duplicateResponse.json();
    assert.equal(duplicateResponse.status, 200);
    assert.notEqual(duplicate.page.id, firstPage.id);
    assert.equal(duplicate.page.latestVersionId, "v001");
    const duplicateHtml = await fetch(`${runtime.url}${duplicate.page.viewUrl}`).then((result) => result.text());
    assert.match(duplicateHtml, /原始第一页/);

    const stableIds = duplicate.project.pages.map((page) => page.id);
    const reversedIds = [...stableIds].reverse();
    const reorderResponse = await fetch(`${runtime.url}/api/projects/${created.project.id}/pages/order`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pageIds: reversedIds })
    });
    const reordered = await reorderResponse.json();
    assert.equal(reorderResponse.status, 200);
    assert.deepEqual(reordered.project.pages.map((page) => page.id), reversedIds);
    assert.deepEqual(reordered.project.pages.map((page) => page.label), ["第 1 页", "第 2 页", "第 3 页", "第 4 页"]);
    const reorderedEditor = await fetch(`${runtime.url}${reordered.project.pages[0].editUrl}`).then((result) => result.text());
    const pageNavStart = reorderedEditor.lastIndexOf("const pageNav = ");
    const pageNavBlock = reorderedEditor.slice(pageNavStart, pageNavStart + 16000);
    assert.ok(pageNavStart >= 0);
    const pageNavMatch = pageNavBlock.match(/const pageNav = ([^\n]+);/);
    assert.ok(pageNavMatch);
    assert.deepEqual(JSON.parse(pageNavMatch[1]).pages.map((page) => page.id), reversedIds);

    const protectedDeleteResponse = await fetch(`${runtime.url}/api/projects/${created.project.id}/pages/${secondPage.id}`, {
      method: "DELETE"
    });
    const protectedDelete = await protectedDeleteResponse.json();
    assert.equal(protectedDeleteResponse.status, 409);
    assert.ok(protectedDelete.references.length >= 1);

    const deleteResponse = await fetch(`${runtime.url}/api/projects/${created.project.id}/pages/${secondPage.id}?force=true`, {
      method: "DELETE"
    });
    const deleted = await deleteResponse.json();
    assert.equal(deleteResponse.status, 200);
    assert.equal(deleted.project.pageCount, 3);
    assert.equal(deleted.project.deletedPages.length, 1);
    assert.equal(deleted.project.deletedPages[0].id, secondPage.id);
    assert.equal(deleted.project.pages.some((page) => page.id === secondPage.id), false);

    const deletedPageExport = await fetch(`${runtime.url}/api/projects/${created.project.id}/export`);
    const exportedZip = await unzipper.Open.buffer(Buffer.from(await deletedPageExport.arrayBuffer()));
    const exportedPaths = exportedZip.files.map((entry) => entry.path);
    assert.equal(exportedPaths.includes(secondPage.sourceRelativePath), false);
    assert.equal(exportedPaths.includes(secondPage.editRelativePath), false);

    const restoreResponse = await fetch(`${runtime.url}/api/projects/${created.project.id}/deleted-pages/${secondPage.id}/restore`, {
      method: "POST"
    });
    const restored = await restoreResponse.json();
    assert.equal(restoreResponse.status, 200);
    assert.equal(restored.project.deletedPages.length, 0);
    assert.equal(restored.project.pages.some((page) => page.id === secondPage.id), true);
    const restoredEditable = await fetch(`${runtime.url}${restored.page.editUrl}`).then((result) => result.text());
    assert.match(restoredEditable, /html-slide-mender-skill:start/);

    for (const page of restored.project.pages.slice(1)) {
      const response = await fetch(`${runtime.url}/api/projects/${created.project.id}/pages/${page.id}`, { method: "DELETE" });
      assert.equal(response.status, 200);
    }
    const lastPageResponse = await fetch(`${runtime.url}/api/projects/${created.project.id}/pages/${restored.project.pages[0].id}`, {
      method: "DELETE"
    });
    assert.equal(lastPageResponse.status, 400);
  } finally {
    await runtime.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("deleting a task removes edit history while preserving original source files", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "html-mender-delete-task-server-"));
  process.env.HTML_MENDER_DATA_DIR = dataDir;
  const { startServer } = await import(`../src/server.js?delete-task-test=${Date.now()}`);
  const runtime = await startServer({ host: "127.0.0.1", port: 0 });

  try {
    const form = new FormData();
    form.append("taskName", "待删除存档");
    form.append("files", new Blob([
      "<!doctype html><html><body>原始内容</body></html>"
    ], { type: "text/html" }), "lesson.html");
    const created = await fetch(`${runtime.url}/api/upload`, { method: "POST", body: form }).then((result) => result.json());
    const projectRoot = join(dataDir, "projects", created.project.id);
    const sourcePath = join(projectRoot, "source", "lesson.html");
    const outputPath = join(projectRoot, "output");
    const versionsPath = join(projectRoot, "versions");
    const metaPath = join(projectRoot, "meta.json");

    const response = await fetch(`${runtime.url}/api/projects/${created.project.id}`, { method: "DELETE" });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    await access(sourcePath);
    await assert.rejects(access(outputPath), /ENOENT/);
    await assert.rejects(access(versionsPath), /ENOENT/);
    await assert.rejects(access(metaPath), /ENOENT/);

    const listed = await fetch(`${runtime.url}/api/projects`).then((result) => result.json());
    assert.equal(listed.projects.length, 0);
  } finally {
    await runtime.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

async function createZip(archivePath, entries) {
  return new Promise((resolvePromise, reject) => {
    const output = createWriteStream(archivePath);
    const archive = new ZipArchive({ zlib: { level: 9 } });
    output.on("close", resolvePromise);
    output.on("error", reject);
    archive.on("error", reject);
    archive.pipe(output);
    for (const entry of entries) archive.append(entry.content, { name: entry.name });
    archive.finalize();
  });
}
