import express from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startHttpServer } from "./server-runtime.js";
import { writeJsonAtomic } from "./task-store.js";
import {
  commitProjectPageEdit,
  createEditableProject,
  createPageVersion,
  createStaticThumbnailHtml,
  extractProjectZip,
  injectProjectPreviewToolbar,
  injectVersionSaveButton,
  isHtmlContent,
  isHtmlFile,
  isZipFile,
  makeEditableHtml,
  normalizeProjectRelativePath,
  sanitizeFileName,
  toEditableFileName,
  zipProjectDirectory,
  zipOutputs
} from "./core.js";

const currentDir = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(currentDir, "..");
const publicDir = resolve(appRoot, "public");
const dataDir = resolve(process.env.HTML_MENDER_DATA_DIR || resolve(appRoot, "data"));
const uploadDir = resolve(dataDir, "uploads");
const outputDir = resolve(dataDir, "outputs");
const projectsDir = resolve(dataDir, "projects");
const archiveDir = resolve(dataDir, "archives");
const EDITOR_RUNTIME_VERSION = 21;

for (const dir of [uploadDir, outputDir, projectsDir, archiveDir]) {
  mkdirSync(dir, { recursive: true });
}

const jobs = new Map();
const projects = new Map();
const app = express();
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || "127.0.0.1";

await hydrateProjectsFromDisk();

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${randomUUID()}-${sanitizeFileName(file.originalname)}`)
  }),
  limits: {
    files: 50,
    fileSize: 25 * 1024 * 1024
  }
});

const projectUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${randomUUID()}-${sanitizeZipName(file.originalname)}`)
  }),
  limits: {
    files: 1,
    fileSize: 500 * 1024 * 1024
  },
  fileFilter: (_req, file, cb) => {
    if (isZipFile(file.originalname)) {
      cb(null, true);
      return;
    }
    cb(new Error(`只支持 .zip 项目包：${file.originalname}`));
  }
});

app.use(express.json({ limit: "80mb" }));
app.use(express.static(publicDir));
app.use("/outputs", express.static(outputDir, {
  extensions: ["html"],
  setHeaders(res) {
    res.setHeader("Cache-Control", "no-store");
  }
}));
app.use("/projects", express.static(projectsDir, {
  setHeaders(res) {
    res.setHeader("Cache-Control", "no-store");
  }
}));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, jobs: jobs.size, projects: projects.size });
});

app.get("/api/jobs", (_req, res) => {
  res.json({ jobs: Array.from(jobs.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) });
});

app.get("/api/projects", (_req, res) => {
  res.json({ projects: Array.from(projects.values()).map(publicProject).sort((a, b) => (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt)) });
});

app.post("/api/projects/:id/pages", async (req, res, next) => {
  try {
    const project = requireReadyProject(req.params.id);
    const afterPageId = String(req.body?.afterPageId || "");
    const afterIndex = afterPageId
      ? project.pages.findIndex((page) => page.id === afterPageId)
      : project.pages.length - 1;
    if (afterPageId && afterIndex < 0) {
      res.status(404).json({ error: "没有找到新页面的插入位置。" });
      return;
    }
    const page = await createManagedProjectPage({
      project,
      insertIndex: afterIndex + 1,
      html: createBlankCoursewareHtml(project.name),
      title: "空白课件页",
      note: "新建空白页"
    });
    res.json({ page: publicProjectPage(project, page), project: publicProject(project) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/projects/:id/pages/:pageId/duplicate", async (req, res, next) => {
  try {
    const project = requireReadyProject(req.params.id);
    const sourcePage = project.pages.find((page) => page.id === req.params.pageId);
    if (!sourcePage) {
      res.status(404).json({ error: "没有找到要复制的页面。" });
      return;
    }
    const sourcePath = resolve(project.sourceDir, ...sourcePage.sourceRelativePath.split("/"));
    const html = await readFile(sourcePath, "utf8");
    const insertIndex = project.pages.findIndex((page) => page.id === sourcePage.id) + 1;
    const page = await createManagedProjectPage({
      project,
      insertIndex,
      html,
      title: `${sourcePage.title || sourcePage.label || "课件页"}（副本）`,
      note: `复制${sourcePage.label || "页面"}`,
      sourceDirectory: posix.dirname(sourcePage.sourceRelativePath)
    });
    res.json({ page: publicProjectPage(project, page), project: publicProject(project) });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/projects/:id/pages/order", async (req, res, next) => {
  try {
    const project = requireReadyProject(req.params.id);
    const pageIds = Array.isArray(req.body?.pageIds) ? req.body.pageIds.map(String) : [];
    const currentIds = project.pages.map((page) => page.id);
    const validOrder = pageIds.length === currentIds.length &&
      new Set(pageIds).size === pageIds.length &&
      currentIds.every((pageId) => pageIds.includes(pageId));
    if (!validOrder) {
      res.status(400).json({ error: "页面顺序必须完整，并且不能包含重复或未知页面。" });
      return;
    }
    const byId = new Map(project.pages.map((page) => [page.id, page]));
    project.pages = pageIds.map((pageId) => byId.get(pageId));
    await finalizePageManagementChange(project);
    res.json({ project: publicProject(project) });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/projects/:id/pages/:pageId", async (req, res, next) => {
  try {
    const project = requireReadyProject(req.params.id);
    if (project.pages.length <= 1) {
      res.status(400).json({ error: "任务至少需要保留一个页面。" });
      return;
    }
    const pageIndex = project.pages.findIndex((page) => page.id === req.params.pageId);
    if (pageIndex < 0) {
      res.status(404).json({ error: "没有找到要删除的页面。" });
      return;
    }
    const references = await findPageJumpReferences(project, req.params.pageId);
    if (references.length && req.query.force !== "true") {
      res.status(409).json({
        error: `这个页面被 ${references.length} 个跳转互动引用，删除后这些跳转将暂时失效。`,
        references
      });
      return;
    }
    const [page] = project.pages.splice(pageIndex, 1);
    const deletedPage = {
      ...page,
      deletedAt: new Date().toISOString(),
      deletedIndex: pageIndex,
      labelAtDeletion: page.label || `第 ${pageIndex + 1} 页`
    };
    project.deletedPages = [...(project.deletedPages || []), deletedPage];
    await removeManagedPageOutputs(project, page);
    await finalizePageManagementChange(project);
    res.json({ deletedPage: publicDeletedProjectPage(project, deletedPage), project: publicProject(project) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/projects/:id/deleted-pages/:pageId/restore", async (req, res, next) => {
  try {
    const project = requireReadyProject(req.params.id);
    const deletedIndex = (project.deletedPages || []).findIndex((page) => page.id === req.params.pageId);
    if (deletedIndex < 0) {
      res.status(404).json({ error: "回收站中没有找到这个页面。" });
      return;
    }
    const [deletedPage] = project.deletedPages.splice(deletedIndex, 1);
    const { deletedAt: _deletedAt, deletedIndex: originalIndex = project.pages.length, labelAtDeletion: _label, ...page } = deletedPage;
    const insertIndex = Math.max(0, Math.min(Number(originalIndex) || 0, project.pages.length));
    project.pages.splice(insertIndex, 0, page);
    await rebuildManagedPage(project, page);
    await finalizePageManagementChange(project);
    res.json({ page: publicProjectPage(project, page), project: publicProject(project) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/projects/:id/pages/:pageId/thumbnail", async (req, res, next) => {
  try {
    const project = projects.get(req.params.id);
    const page = project?.pages?.find((item) => item.id === req.params.pageId);
    if (!project || !page) {
      res.status(404).send("没有找到课件页面。");
      return;
    }
    const sourcePath = resolve(project.sourceDir, ...page.sourceRelativePath.split("/"));
    const source = await readFile(sourcePath, "utf8");
    const pageDirectory = posix.dirname(page.sourceRelativePath);
    const encodedDirectory = pageDirectory === "." ? "" : `${encodeRelativeUrlPath(pageDirectory)}/`;
    const baseHref = `/projects/${project.id}/output/${encodedDirectory}`;
    res.setHeader("Cache-Control", "no-store");
    res.type("html").send(createStaticThumbnailHtml(source, baseHref));
  } catch (error) {
    next(error);
  }
});

app.post("/api/upload", upload.array("files", 50), async (req, res, next) => {
  try {
    const files = req.files || [];
    if (!files.length) {
      res.status(400).json({ error: "请至少选择一个 HTML 文件。" });
      return;
    }

    const taskName = normalizeTaskName(req.body?.taskName);
    if (!taskName) {
      await Promise.all(files.map((file) => rm(file.path, { force: true }).catch(() => {})));
      res.status(400).json({ error: "请先填写任务名称。" });
      return;
    }

    const result = await processHtmlTask({ files, taskName });
    projects.set(result.project.id, result.project);
    await writeProjectMeta(result.project);
    res.json({ project: publicProject(result.project), rejected: result.rejected });
  } catch (error) {
    next(error);
  }
});

app.post("/api/projects/upload", projectUpload.single("project"), async (req, res, next) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "请上传一个 ZIP 项目包。" });
      return;
    }

    const taskName = normalizeTaskName(req.body?.taskName);
    if (!taskName) {
      await rm(req.file.path, { force: true }).catch(() => {});
      res.status(400).json({ error: "请先填写任务名称。" });
      return;
    }

    const project = await processProjectUpload(req.file, taskName);
    projects.set(project.id, project);
    await writeProjectMeta(project);
    res.json({ project: publicProject(project) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/projects/:id/versions", async (req, res, next) => {
  try {
    const project = projects.get(req.params.id);
    if (!project || project.status !== "ready") {
      res.status(404).json({ error: "没有找到可保存版本的项目。" });
      return;
    }

    const html = String(req.body?.html || "");
    if (!html.trim()) {
      res.status(400).json({ error: "当前页面内容为空，无法保存版本。" });
      return;
    }

    const version = await createNextProjectVersion({
      project,
      html,
      editRelativePath: req.body?.editRelativePath || "",
      note: req.body?.note || ""
    });
    res.json({ version: publicVersion(version), project: publicProject(project) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/jobs/:id/download", async (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job || job.status !== "ready" || !existsSync(job.outputPath)) {
    res.status(404).json({ error: "没有找到可下载的生成文件。" });
    return;
  }
  res.download(job.outputPath, job.outputName);
});

app.get("/api/jobs/archive.zip", async (req, res, next) => {
  try {
    const requestedIds = String(req.query.ids || "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    const selectedJobs = (requestedIds.length ? requestedIds.map((id) => jobs.get(id)) : Array.from(jobs.values()))
      .filter((job) => job?.status === "ready" && existsSync(job.outputPath));

    if (!selectedJobs.length) {
      res.status(400).json({ error: "还没有可打包的可编辑 HTML。" });
      return;
    }

    const archivePath = resolve(archiveDir, `html-mender-${Date.now()}.zip`);
    await zipOutputs({
      archivePath,
      files: selectedJobs.map((job) => ({ path: job.outputPath, name: job.outputName }))
    });
    res.download(archivePath, "html-mender-editable-html.zip");
  } catch (error) {
    next(error);
  }
});

app.get("/api/projects/:id/download", async (req, res, next) => {
  try {
    const project = projects.get(req.params.id);
    if (!project || project.status !== "ready" || !existsSync(project.outputDir)) {
      res.status(404).json({ error: "没有找到可导出的项目。" });
      return;
    }

    const archivePath = resolve(archiveDir, `html-mender-project-${project.id}.zip`);
    await zipProjectDirectory({ directoryPath: project.outputDir, archivePath });
    res.download(archivePath, `${project.downloadName}.zip`);
  } catch (error) {
    next(error);
  }
});

app.get("/api/projects/:id/export", async (req, res, next) => {
  try {
    const project = projects.get(req.params.id);
    if (!project || project.status !== "ready") {
      res.status(404).json({ error: "没有找到可导出的任务。" });
      return;
    }
    if (project.kind === "html" && project.pages?.length === 1) {
      const pagePath = resolve(project.sourceDir, ...project.pages[0].sourceRelativePath.split("/"));
      if (!existsSync(pagePath)) {
        res.status(404).json({ error: "没有找到当前页面文件。" });
        return;
      }
      res.download(pagePath, `${project.downloadName}.html`);
      return;
    }
    const archivePath = resolve(archiveDir, `html-mender-task-${project.id}.zip`);
    await zipProjectDirectory({ directoryPath: project.outputDir, archivePath });
    res.download(archivePath, `${project.downloadName}.zip`);
  } catch (error) {
    next(error);
  }
});

app.get("/api/projects/:id/versions/:versionId/download", async (req, res) => {
  const project = projects.get(req.params.id);
  const version = project?.versions?.find((item) => (item.key || item.id) === req.params.versionId);
  const filePath = version?.htmlPath || version?.archivePath;
  if (!project || !version || !filePath || !existsSync(filePath)) {
    res.status(404).json({ error: "没有找到可下载的历史版本。" });
    return;
  }

  const extension = version.htmlPath ? "html" : "zip";
  res.download(filePath, `${project.downloadName}-${version.pageId || "project"}-${version.id}.${extension}`);
});

app.get("/api/projects/:id/versions/:versionId/view", async (req, res, next) => {
  try {
    const project = projects.get(req.params.id);
    const version = project?.versions?.find((item) => (item.key || item.id) === req.params.versionId);
    if (!project || !version?.htmlPath || !existsSync(version.htmlPath)) {
      res.status(404).send("没有找到可预览的历史版本。");
      return;
    }
    const html = await readFile(version.htmlPath, "utf8");
    const pageDir = posix.dirname(version.pageRelativePath || "") === "."
      ? ""
      : `${posix.dirname(version.pageRelativePath)}/`;
    const baseHref = `/projects/${project.id}/output/${encodeRelativeUrlPath(pageDir)}`;
    res.type("html").send(injectBaseHref(html, baseHref));
  } catch (error) {
    next(error);
  }
});

app.post("/api/projects/:id/pages/:pageId/restore", async (req, res, next) => {
  try {
    const project = projects.get(req.params.id);
    const page = project?.pages?.find((item) => item.id === req.params.pageId);
    const version = project?.versions?.find((item) => (item.key || item.id) === req.body?.versionKey && item.pageId === page?.id);
    if (!project || !page || !version?.htmlPath || !existsSync(version.htmlPath)) {
      res.status(404).json({ error: "没有找到可恢复的页面版本。" });
      return;
    }
    const html = await readFile(version.htmlPath, "utf8");
    const restored = await createNextProjectVersion({
      project,
      html,
      editRelativePath: page.editRelativePath,
      note: `从 ${version.id} 恢复`
    });
    res.json({ version: publicVersion(restored), project: publicProject(project) });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/projects/:id", async (req, res, next) => {
  try {
    const project = projects.get(req.params.id);
    if (!project) {
      res.status(404).json({ error: "没有找到要删除的任务存档。" });
      return;
    }

    await Promise.all([
      project.outputDir ? rm(project.outputDir, { recursive: true, force: true }) : Promise.resolve(),
      project.versionsDir ? rm(project.versionsDir, { recursive: true, force: true }) : Promise.resolve(),
      rm(resolve(projectsDir, project.id, "meta.json"), { force: true })
    ]);
    projects.delete(project.id);
    res.json({
      ok: true,
      preservedSource: Boolean(project.sourceDir && existsSync(project.sourceDir))
    });
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  const message = error?.message || "处理失败，请检查 HTML 文件后再试。";
  res.status(400).json({ error: message });
});

async function processUpload(file) {
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const htmlFileName = normalizeHtmlUploadName(file.originalname);
  const outputName = toEditableFileName(htmlFileName);
  const jobOutputDir = resolve(outputDir, id);
  const outputPath = resolve(jobOutputDir, outputName);
  const baseJob = {
    id,
    originalName: file.originalname,
    safeName: sanitizeFileName(htmlFileName),
    outputName,
    createdAt,
    status: "processing"
  };

  try {
    const source = await readFile(file.path, "utf8");
    if (!isHtmlContent(source)) {
      throw new Error(`文件内容不是可识别的完整 HTML：${file.originalname}`);
    }
    await mkdir(jobOutputDir, { recursive: true });
    await makeEditableHtml({
      inputPath: file.path,
      outputPath,
      lang: "zh-CN"
    });
    const outputStats = await stat(outputPath);
    return {
      ...baseJob,
      status: "ready",
      size: file.size,
      outputSize: outputStats.size,
      editUrl: `/outputs/${id}/${encodeURIComponent(outputName)}`,
      downloadUrl: `/api/jobs/${id}/download`,
      outputPath
    };
  } catch (error) {
    return {
      ...baseJob,
      status: "failed",
      error: error?.message || "生成失败"
    };
  } finally {
    await rm(file.path, { force: true }).catch(() => {});
  }
}

async function processHtmlTask({ files, taskName }) {
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const projectRoot = resolve(projectsDir, id);
  const sourceDir = resolve(projectRoot, "source");
  const taskOutputDir = resolve(projectRoot, "output");
  const versionsDir = resolve(projectRoot, "versions");
  const acceptedFiles = [];
  const rejected = [];
  const usedNames = new Set();

  await mkdir(sourceDir, { recursive: true });
  for (const file of files) {
    try {
      const source = await readFile(file.path, "utf8");
      if (!isHtmlContent(source)) {
        rejected.push({ name: file.originalname, error: "内容不是可识别的完整 HTML" });
        continue;
      }
      const preferredName = sanitizeFileName(normalizeHtmlUploadName(file.originalname));
      const sourceName = makeUniqueHtmlName(preferredName, usedNames);
      await writeFile(resolve(sourceDir, sourceName), source, "utf8");
      acceptedFiles.push(sourceName);
    } finally {
      await rm(file.path, { force: true }).catch(() => {});
    }
  }

  if (!acceptedFiles.length) {
    throw new Error("所选文件中没有可识别的完整 HTML。");
  }

  const editable = await createEditableProject({
    sourceDir,
    outputDir: taskOutputDir,
    entryHtml: acceptedFiles[0],
    files: acceptedFiles,
    lang: "zh-CN",
    includeEntry: true
  });
  const pages = editable.pages.map((page, index) => ({
    ...sanitizeProjectPage(page),
    id: `p${String(index + 1).padStart(3, "0")}`,
    versionCount: 0
  }));
  const versions = [];

  for (const page of pages) {
    const html = await readFile(resolve(sourceDir, ...page.sourceRelativePath.split("/")), "utf8");
    const stored = await createPageVersion({
      versionsDir,
      pageId: page.id,
      versionId: "v001",
      html,
      note: "初始版本"
    });
    const version = decoratePageVersion({ projectId: id, page, version: stored });
    versions.push(version);
    page.latestVersionId = version.id;
    page.lastSavedAt = version.createdAt;
    page.versionCount = 1;
  }

  const project = {
    id,
    name: taskName,
    kind: "html",
    originalName: taskName,
    createdAt,
    updatedAt: createdAt,
    lastSavedAt: createdAt,
    status: "ready",
    size: files.reduce((sum, file) => sum + (file.size || 0), 0),
    downloadName: sanitizeFileName(`${taskName}.html`).replace(/\.html$/i, "") || "html-mender-task",
    entryHtml: acceptedFiles[0],
    editRelativePath: editable.editRelativePath,
    outputSize: editable.outputSize,
    mediaCounts: { html: pages.length, image: 0, video: 0, other: 0 },
    pages,
    pageCount: pages.length,
    editUrl: `/projects/${id}/output/${encodeRelativeUrlPath(editable.editRelativePath)}`,
    downloadUrl: `/api/projects/${id}/export`,
    outputDir: taskOutputDir,
    sourceDir,
    versionsDir,
    latestVersion: versions.at(-1) || null,
    versions,
    versionCount: versions.length,
    editorRuntimeVersion: EDITOR_RUNTIME_VERSION
  };
  await refreshProjectPageControls(project);
  return { project, rejected };
}

function normalizeHtmlUploadName(fileName = "") {
  const name = String(fileName).replace(/\\/g, "/").split("/").pop() || "deck";
  if (isHtmlFile(name)) return name;
  const stem = name.replace(/\.[^.]+$/, "") || "deck";
  return `${stem}.html`;
}

function normalizeTaskName(value = "") {
  return String(value).replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 80);
}

function makeUniqueHtmlName(fileName, usedNames) {
  const extension = ".html";
  const stem = String(fileName).replace(/\.html?$/i, "") || "page";
  let candidate = `${stem}${extension}`;
  let suffix = 2;
  while (usedNames.has(candidate.toLowerCase())) {
    candidate = `${stem}-${suffix}${extension}`;
    suffix += 1;
  }
  usedNames.add(candidate.toLowerCase());
  return candidate;
}

async function processProjectUpload(file, taskName) {
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const projectRoot = resolve(projectsDir, id);
  const sourceDir = resolve(projectRoot, "source");
  const outputDir = resolve(projectRoot, "output");
  const versionsDir = resolve(projectRoot, "versions");
  const downloadName = sanitizeZipName(file.originalname).replace(/\.zip$/i, "") || "html-mender-project";
  const baseProject = {
    id,
    name: taskName,
    kind: "zip",
    originalName: file.originalname,
    createdAt,
    updatedAt: createdAt,
    status: "processing",
    downloadName
  };

  try {
    const extracted = await extractProjectZip({
      zipPath: file.path,
      targetDir: sourceDir
    });
    const editable = await createEditableProject({
      sourceDir,
      outputDir,
      entryHtml: extracted.entryHtml,
      files: extracted.files,
      lang: "zh-CN"
    });
    const pages = editable.pages.map((page, index) => ({
      ...sanitizeProjectPage(page),
      id: `p${String(index + 1).padStart(3, "0")}`,
      versionCount: 0
    }));
    const versions = [];
    for (const page of pages) {
      const html = await readFile(resolve(sourceDir, ...page.sourceRelativePath.split("/")), "utf8");
      const stored = await createPageVersion({
        versionsDir,
        pageId: page.id,
        versionId: "v001",
        html,
        note: "初始版本"
      });
      const version = decoratePageVersion({ projectId: id, page, version: stored });
      versions.push(version);
      page.latestVersionId = version.id;
      page.lastSavedAt = version.createdAt;
      page.versionCount = 1;
    }

    const project = {
      ...baseProject,
      status: "ready",
      size: file.size,
      originalName: taskName,
      entryHtml: extracted.entryHtml,
      editRelativePath: editable.editRelativePath,
      outputSize: editable.outputSize,
      mediaCounts: extracted.mediaCounts,
      pages,
      pageCount: pages.length,
      editUrl: `/projects/${id}/output/${encodeRelativeUrlPath(editable.editRelativePath)}`,
      downloadUrl: `/api/projects/${id}/export`,
      outputDir,
      sourceDir,
      versionsDir,
      latestVersion: versions.at(-1) || null,
      lastSavedAt: createdAt,
      versions,
      versionCount: versions.length,
      editorRuntimeVersion: EDITOR_RUNTIME_VERSION
    };
    await refreshProjectPageControls(project);
    return project;
  } catch (error) {
    return {
      ...baseProject,
      status: "failed",
      size: file.size,
      error: error?.message || "项目包处理失败"
    };
  } finally {
    await rm(file.path, { force: true }).catch(() => {});
  }
}

async function createNextProjectVersion({ project, html, editRelativePath = "", note = "" }) {
  const page = findProjectPageByEditPath(project, editRelativePath);
  if (!page?.id) {
    throw new Error("没有找到当前页面，无法保存版本。");
  }
  const nextId = `v${String((page.versionCount || 0) + 1).padStart(3, "0")}`;
  const versionNote = note || (page ? `保存${page.label}` : "手动保存");
  const version = await createPageVersion({
    versionsDir: project.versionsDir,
    pageId: page.id,
    versionId: nextId,
    html,
    note: versionNote
  });
  const publicVersion = decoratePageVersion({
    projectId: project.id,
    page,
    version
  });
  const commit = await commitProjectPageEdit({
    sourceDir: project.sourceDir,
    outputDir: project.outputDir,
    projectId: project.id,
    sourceRelativePath: page.sourceRelativePath,
    editRelativePath: page.editRelativePath,
    html,
    pageNav: buildPageNav({ projectId: project.id, pages: project.pages || [], page, taskName: project.name }),
    lang: "zh-CN"
  });
  page.outputSize = commit.outputSize;
  page.lastSavedAt = publicVersion.createdAt;
  page.latestVersionId = publicVersion.id;
  page.versionCount = (page.versionCount || 0) + 1;
  await injectVersionSaveButton({
    htmlPath: resolve(project.outputDir, ...page.editRelativePath.split("/")),
    projectId: project.id,
    editRelativePath: page.editRelativePath,
    pageNav: buildPageNav({ projectId: project.id, pages: project.pages || [], page, taskName: project.name })
  });
  await injectProjectPreviewToolbar({
    htmlPath: resolve(project.outputDir, ...page.sourceRelativePath.split("/")),
    pageLabel: page.label,
    toolbar: buildPreviewToolbar({ projectId: project.id, pages: project.pages || [], page })
  });
  project.outputSize = (project.pages || []).reduce((sum, item) => sum + (item.outputSize || 0), 0);
  project.versions = [...(project.versions || []), publicVersion];
  project.latestVersion = publicVersion;
  project.lastSavedAt = publicVersion.createdAt;
  project.updatedAt = publicVersion.createdAt;
  project.versionCount = project.versions.length;
  await writeProjectMeta(project);
  return publicVersion;
}

function requireReadyProject(projectId) {
  const project = projects.get(projectId);
  if (!project || project.status !== "ready") {
    throw new Error("没有找到可管理页面的任务。");
  }
  project.pages = Array.isArray(project.pages) ? project.pages : [];
  project.deletedPages = Array.isArray(project.deletedPages) ? project.deletedPages : [];
  return project;
}

function nextProjectPageId(project) {
  const ids = [...(project.pages || []), ...(project.deletedPages || [])]
    .map((page) => String(page.id || ""));
  const highest = ids.reduce((max, id) => {
    const match = id.match(/^p(\d+)$/i);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return `p${String(highest + 1).padStart(3, "0")}`;
}

function managedPagePaths({ project, pageId, sourceDirectory = "" }) {
  const safeDirectory = sourceDirectory && sourceDirectory !== "."
    ? normalizeProjectRelativePath(`${sourceDirectory}/placeholder.html`).replace(/\/placeholder\.html$/i, "")
    : "";
  const fileName = `hsm-page-${pageId}.html`;
  const sourceRelativePath = safeDirectory ? `${safeDirectory}/${fileName}` : fileName;
  return {
    sourceRelativePath,
    editRelativePath: sourceRelativePath.replace(/\.html?$/i, ".editable.html")
  };
}

function renumberProjectPages(project) {
  for (const [index, page] of (project.pages || []).entries()) {
    page.label = `第 ${index + 1} 页`;
  }
}

async function createManagedProjectPage({ project, insertIndex, html, title, note, sourceDirectory = "" }) {
  const pageId = nextProjectPageId(project);
  const paths = managedPagePaths({ project, pageId, sourceDirectory });
  const page = {
    id: pageId,
    ...paths,
    label: "",
    title: title || "空白课件页",
    outputSize: 0,
    versionCount: 0
  };
  const safeInsertIndex = Math.max(0, Math.min(Number(insertIndex) || 0, project.pages.length));
  const previousVersions = [...(project.versions || [])];
  const previousLatestVersion = project.latestVersion || null;
  project.pages.splice(safeInsertIndex, 0, page);
  renumberProjectPages(project);
  try {
    await createNextProjectVersion({
      project,
      html,
      editRelativePath: page.editRelativePath,
      note: note || "新建页面"
    });
    await finalizePageManagementChange(project);
    return page;
  } catch (error) {
    project.pages = project.pages.filter((item) => item.id !== page.id);
    project.versions = previousVersions;
    project.latestVersion = previousLatestVersion;
    project.versionCount = previousVersions.length;
    await Promise.all([
      rm(resolve(project.sourceDir, ...page.sourceRelativePath.split("/")), { force: true }),
      rm(resolve(project.outputDir, ...page.sourceRelativePath.split("/")), { force: true }),
      rm(resolve(project.outputDir, ...page.editRelativePath.split("/")), { force: true }),
      rm(resolve(project.versionsDir, page.id), { recursive: true, force: true })
    ]).catch(() => {});
    renumberProjectPages(project);
    await writeProjectMeta(project).catch(() => {});
    throw error;
  }
}

async function rebuildManagedPage(project, page) {
  const sourcePath = resolve(project.sourceDir, ...page.sourceRelativePath.split("/"));
  const html = await readFile(sourcePath, "utf8");
  const commit = await commitProjectPageEdit({
    sourceDir: project.sourceDir,
    outputDir: project.outputDir,
    projectId: project.id,
    sourceRelativePath: page.sourceRelativePath,
    editRelativePath: page.editRelativePath,
    html,
    pageNav: buildPageNav({ projectId: project.id, pages: project.pages, page, taskName: project.name }),
    lang: "zh-CN"
  });
  page.outputSize = commit.outputSize;
}

async function removeManagedPageOutputs(project, page) {
  await Promise.all([
    rm(resolve(project.outputDir, ...page.sourceRelativePath.split("/")), { force: true }),
    rm(resolve(project.outputDir, ...page.editRelativePath.split("/")), { force: true })
  ]);
}

async function findPageJumpReferences(project, targetPageId) {
  const references = [];
  const manifestPattern = /<script\b[^>]*data-hsm-interaction-manifest[^>]*>([\s\S]*?)<\/script\s*>/gi;
  for (const page of project.pages || []) {
    if (page.id === targetPageId) continue;
    const sourcePath = resolve(project.sourceDir, ...page.sourceRelativePath.split("/"));
    const html = await readFile(sourcePath, "utf8").catch(() => "");
    for (const match of html.matchAll(manifestPattern)) {
      try {
        const manifest = JSON.parse(match[1] || "{}");
        for (const interaction of manifest.interactions || []) {
          if (interaction?.action?.type === "goToPage" && String(interaction.action.pageId || "") === targetPageId) {
            references.push({
              pageId: page.id,
              pageLabel: page.label || "",
              interactionId: String(interaction.id || ""),
              interactionName: String(interaction.name || "页面跳转")
            });
          }
        }
      } catch (_error) {
        // Invalid legacy manifests are ignored rather than blocking page management.
      }
    }
  }
  return references;
}

async function finalizePageManagementChange(project) {
  renumberProjectPages(project);
  const firstPage = project.pages[0];
  project.pageCount = project.pages.length;
  project.editRelativePath = firstPage?.editRelativePath || "";
  project.editUrl = firstPage
    ? `/projects/${project.id}/output/${encodeRelativeUrlPath(firstPage.editRelativePath)}`
    : "";
  project.outputSize = project.pages.reduce((sum, page) => sum + (page.outputSize || 0), 0);
  project.mediaCounts = { ...(project.mediaCounts || {}), html: project.pages.length };
  project.updatedAt = new Date().toISOString();
  await refreshProjectPageControls(project);
  await writeProjectMeta(project);
}

function createBlankCoursewareHtml(taskName = "") {
  const safeTitle = escapeHtmlText(`${taskName || "HTML Mender"} - 空白课件页`);
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${safeTitle}</title>
  <style>
    * { box-sizing: border-box; }
    html, body { width: 100%; min-height: 100%; margin: 0; }
    body { display: grid; min-height: 100vh; place-items: center; overflow: auto; background: #e8ece8; font-family: "Microsoft YaHei", "PingFang SC", sans-serif; }
    .hsm-blank-slide { position: relative; width: min(96vw, 1600px); aspect-ratio: 16 / 9; overflow: hidden; border: 1px solid #cbd5d1; background: #fffdf7; box-shadow: 0 24px 70px rgba(29, 37, 34, 0.16); }
    .hsm-blank-hint { position: absolute; inset: 0; display: grid; place-items: center; color: #7b8985; font-size: clamp(18px, 2vw, 30px); }
  </style>
</head>
<body>
  <main class="hsm-blank-slide" data-layout-editable="true">
    <p class="hsm-blank-hint">空白课件页</p>
  </main>
</body>
</html>`;
}

function escapeHtmlText(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function decorateProjectVersion({ projectId, version }) {
  return {
    id: version.id,
    note: version.note,
    createdAt: version.createdAt,
    entryHtml: version.entryHtml,
    pageLabel: version.pageLabel || "",
    pageRelativePath: version.pageRelativePath || "",
    size: version.size,
    archiveSize: version.archiveSize,
    viewUrl: `/projects/${projectId}/versions/${version.id}/${encodeRelativeUrlPath(version.entryHtml)}`,
    downloadUrl: `/api/projects/${projectId}/versions/${version.id}/download`,
    archivePath: version.archivePath
  };
}

function decoratePageVersion({ projectId, page, version }) {
  return {
    ...version,
    pageLabel: page.label || "",
    pageRelativePath: page.sourceRelativePath,
    entryHtml: page.sourceRelativePath,
    viewUrl: `/api/projects/${projectId}/versions/${version.key}/view`,
    downloadUrl: `/api/projects/${projectId}/versions/${version.key}/download`
  };
}

function publicProject(project) {
  const {
    outputDir: _outputDir,
    sourceDir: _sourceDir,
    versionsDir: _versionsDir,
    ...rest
  } = project;
  const pages = (project.pages || []).map((page) => publicProjectPage(project, page));
  const deletedPages = (project.deletedPages || []).map((page) => publicDeletedProjectPage(project, page));
  const firstPage = pages[0];
  return {
    ...rest,
    name: project.name || inferProjectDisplayName(project),
    originalName: inferProjectDisplayName(project),
    pages,
    deletedPages,
    pageCount: pages.length || project.pageCount || 0,
    editUrl: firstPage?.editUrl || project.editUrl,
    versions: (project.versions || []).map(publicVersion),
    latestVersion: project.latestVersion ? publicVersion(project.latestVersion) : null,
    versionCount: project.versions?.length || 0
  };
}

function publicProjectPage(project, page) {
  const { outputPath: _outputPath, ...rest } = page;
  return {
    ...rest,
    versions: (project.versions || [])
      .filter((version) => version.pageId === page.id)
      .map((version) => ({ ...publicVersion(version), pageLabel: page.label || version.pageLabel || "" })),
    editUrl: `/projects/${project.id}/output/${encodeRelativeUrlPath(page.editRelativePath)}`,
    viewUrl: `/projects/${project.id}/output/${encodeRelativeUrlPath(page.sourceRelativePath)}`
  };
}

function publicDeletedProjectPage(project, page) {
  const { outputPath: _outputPath, ...rest } = page;
  return {
    ...rest,
    versions: (project.versions || [])
      .filter((version) => version.pageId === page.id)
      .map((version) => ({ ...publicVersion(version), pageLabel: page.labelAtDeletion || version.pageLabel || "" }))
  };
}

function buildPageNav({ projectId, pages, page, taskName = "" }) {
  const pageIndex = pages.findIndex((item) => item.editRelativePath === page.editRelativePath);
  const previousPage = pageIndex > 0 ? pages[pageIndex - 1] : null;
  const nextPage = pageIndex >= 0 && pageIndex < pages.length - 1 ? pages[pageIndex + 1] : null;
  return {
    projectUrl: `/?project=${encodeURIComponent(projectId)}`,
    taskName,
    pageLabel: page.label || "",
    currentVersionId: page.latestVersionId || "v001",
    previewUrl: `/projects/${projectId}/output/${encodeRelativeUrlPath(page.sourceRelativePath)}`,
    previousUrl: previousPage ? `/projects/${projectId}/output/${encodeRelativeUrlPath(previousPage.editRelativePath)}` : "",
    nextUrl: nextPage ? `/projects/${projectId}/output/${encodeRelativeUrlPath(nextPage.editRelativePath)}` : "",
    pages: pages.map((item, index) => ({
      id: item.id || `p${String(index + 1).padStart(3, "0")}`,
      label: item.label || `第 ${index + 1} 页`,
      title: item.title || item.sourceRelativePath || item.editRelativePath || "",
      sourceRelativePath: item.sourceRelativePath || "",
      editRelativePath: item.editRelativePath || "",
      editUrl: `/projects/${projectId}/output/${encodeRelativeUrlPath(item.editRelativePath)}`,
      viewUrl: `/projects/${projectId}/output/${encodeRelativeUrlPath(item.sourceRelativePath)}`,
      thumbnailUrl: `/api/projects/${projectId}/pages/${item.id || `p${String(index + 1).padStart(3, "0")}`}/thumbnail`,
      current: item.editRelativePath === page.editRelativePath
    }))
  };
}

function buildPreviewToolbar({ projectId, pages, page }) {
  const pageIndex = pages.findIndex((item) => item.sourceRelativePath === page.sourceRelativePath);
  const previousPage = pageIndex > 0 ? pages[pageIndex - 1] : null;
  const nextPage = pageIndex >= 0 && pageIndex < pages.length - 1 ? pages[pageIndex + 1] : null;
  return {
    projectUrl: `/?project=${encodeURIComponent(projectId)}`,
    editUrl: `/projects/${projectId}/output/${encodeRelativeUrlPath(page.editRelativePath)}`,
    previousUrl: previousPage ? `/projects/${projectId}/output/${encodeRelativeUrlPath(previousPage.sourceRelativePath)}` : "",
    nextUrl: nextPage ? `/projects/${projectId}/output/${encodeRelativeUrlPath(nextPage.sourceRelativePath)}` : "",
    latestVersionId: page.latestVersionId || "",
    lastSavedAt: page.lastSavedAt || ""
  };
}

function publicVersion(version) {
  const { archivePath: _archivePath, htmlPath: _htmlPath, ...rest } = version;
  return rest;
}

function injectBaseHref(html, href) {
  const base = `<base href="${href}">`;
  return /<head\b[^>]*>/i.test(html)
    ? html.replace(/<head\b[^>]*>/i, (match) => `${match}${base}`)
    : html.replace(/<html\b[^>]*>/i, (match) => `${match}<head>${base}</head>`);
}

function sanitizeZipName(fileName = "") {
  const stem = sanitizeFileName(String(fileName).replace(/\.zip$/i, ".html")).replace(/\.html$/i, "");
  return `${stem || "project"}.zip`;
}

function encodeRelativeUrlPath(relativePath) {
  return String(relativePath).split("/").map(encodeURIComponent).join("/");
}

function inferProjectDisplayName(project) {
  if (project.entryHtml && String(project.entryHtml).includes("/")) {
    return String(project.entryHtml).split("/")[0];
  }
  return project.originalName;
}

async function hydrateProjectsFromDisk() {
  const entries = await readdir(projectsDir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const metaPath = resolve(projectsDir, entry.name, "meta.json");
    try {
      const project = JSON.parse(await readFile(metaPath, "utf8"));
      if (project?.id && project?.status) {
        let upgraded = ensureProjectIdentity(project);
        await ensureProjectPages(project);
        upgraded = await upgradeProjectEditorRuntime(project) || upgraded;
        await refreshProjectPageControls(project);
        projects.set(project.id, project);
        if (upgraded) await writeProjectMeta(project);
      }
    } catch (_error) {
      // Projects created before metadata support are simply ignored on startup.
    }
  }
}

async function upgradeProjectEditorRuntime(project) {
  if (project.status !== "ready" || Number(project.editorRuntimeVersion || 0) >= EDITOR_RUNTIME_VERSION) return false;
  for (const page of project.pages || []) {
    const inputPath = resolve(project.sourceDir, ...page.sourceRelativePath.split("/"));
    const editablePath = resolve(project.outputDir, ...page.editRelativePath.split("/"));
    if (existsSync(inputPath)) {
      await makeEditableHtml({ inputPath, outputPath: editablePath, lang: "zh-CN" });
    }
  }
  project.editorRuntimeVersion = EDITOR_RUNTIME_VERSION;
  return true;
}

function ensureProjectIdentity(project) {
  let changed = false;
  const setDefault = (key, value) => {
    if (project[key] == null || project[key] === "") {
      project[key] = value;
      changed = true;
    }
  };
  setDefault("name", inferProjectDisplayName(project));
  setDefault("kind", "zip");
  setDefault("updatedAt", project.lastSavedAt || project.createdAt || new Date().toISOString());
  setDefault("downloadUrl", `/api/projects/${project.id}/export`);
  setDefault("deletedPages", []);
  for (const [index, page] of (project.pages || []).entries()) {
    if (!page.id) {
      page.id = `p${String(index + 1).padStart(3, "0")}`;
      changed = true;
    }
  }
  for (const version of project.versions || []) {
    if (!version.pageId && version.pageRelativePath) {
      const page = project.pages?.find((item) => item.sourceRelativePath === version.pageRelativePath);
      if (page) {
        version.pageId = page.id;
        version.key = version.key || `${page.id}-${version.id}`;
        changed = true;
      }
    }
  }
  return changed;
}

async function ensureProjectPages(project) {
  if (project.status !== "ready" || project.pages?.length || !project.sourceDir || !project.outputDir) {
    return;
  }
  const htmlFiles = await listHtmlFiles(project.sourceDir);
  const editable = await createEditableProject({
    sourceDir: project.sourceDir,
    outputDir: project.outputDir,
    entryHtml: project.entryHtml,
    files: htmlFiles,
    lang: "zh-CN"
  });
  for (const page of editable.pages) {
    await injectVersionSaveButton({
      htmlPath: page.outputPath,
      projectId: project.id,
      editRelativePath: page.editRelativePath,
      pageNav: buildPageNav({ projectId: project.id, pages: editable.pages, page, taskName: project.name })
    });
    await injectProjectPreviewToolbar({
      htmlPath: resolve(project.outputDir, ...page.sourceRelativePath.split("/")),
      pageLabel: page.label,
      toolbar: buildPreviewToolbar({ projectId: project.id, pages: editable.pages, page })
    });
  }
  project.pages = editable.pages.map((page) => sanitizeProjectPage(page));
  project.pageCount = editable.pages.length;
  project.editRelativePath = editable.editRelativePath;
  project.editUrl = `/projects/${project.id}/output/${encodeRelativeUrlPath(editable.editRelativePath)}`;
  project.outputSize = editable.outputSize;
  await writeProjectMeta(project);
}

async function refreshProjectPageControls(project) {
  if (project.status !== "ready" || !project.outputDir || !project.pages?.length) {
    return;
  }
  for (const page of project.pages) {
    const editablePath = resolve(project.outputDir, ...page.editRelativePath.split("/"));
    if (existsSync(editablePath)) {
      await injectVersionSaveButton({
        htmlPath: editablePath,
        projectId: project.id,
        editRelativePath: page.editRelativePath,
        pageNav: buildPageNav({ projectId: project.id, pages: project.pages, page, taskName: project.name })
      });
    }
    const previewPath = resolve(project.outputDir, ...page.sourceRelativePath.split("/"));
    if (existsSync(previewPath)) {
      await injectProjectPreviewToolbar({
        htmlPath: previewPath,
        pageLabel: page.label,
        toolbar: buildPreviewToolbar({ projectId: project.id, pages: project.pages, page })
      });
    }
  }
}

async function listHtmlFiles(directoryPath, baseDir = directoryPath) {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const fullPath = resolve(directoryPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listHtmlFiles(fullPath, baseDir));
    } else if (entry.isFile()) {
      const relativePath = fullPath.slice(baseDir.length + 1).split("/").join("/");
      if (isHtmlFile(relativePath)) {
        files.push(relativePath);
      }
    }
  }
  return files;
}

function sanitizeProjectPage(page) {
  const {
    id,
    sourceRelativePath,
    editRelativePath,
    label,
    title,
    outputSize,
    latestVersionId,
    lastSavedAt,
    versionCount
  } = page;
  return { id, sourceRelativePath, editRelativePath, label, title, outputSize, latestVersionId, lastSavedAt, versionCount };
}

function findProjectPageByEditPath(project, editRelativePath) {
  const safeEditPath = editRelativePath
    ? normalizeProjectRelativePath(editRelativePath)
    : project.editRelativePath;
  return (project.pages || []).find((page) => page.editRelativePath === safeEditPath)
    || (project.pages || [])[0]
    || null;
}

async function writeProjectMeta(project) {
  const metaPath = resolve(projectsDir, project.id, "meta.json");
  await writeJsonAtomic(metaPath, project);
}

export async function startServer(options = {}) {
  const runtime = await startHttpServer({
    app,
    host: options.host || host,
    port: options.port ?? port
  });
  console.log(`HTML Mender local app: ${runtime.url}`);
  return runtime;
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  await startServer();
}
