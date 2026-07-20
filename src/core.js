import { ZipArchive } from "archiver";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { posix } from "node:path";
import { fileURLToPath } from "node:url";
import { pinyin } from "pinyin-pro";
import unzipper from "unzipper";

const currentDir = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(currentDir, "..");
const injectorPath = resolveEditorInjectorPath(appRoot);
const editorWorkingDirectory = resolveEditorWorkingDirectory(appRoot);

export function resolveEditorInjectorPath(rootPath = appRoot) {
  const resourceRoot = basename(rootPath) === "app.asar" ? `${rootPath}.unpacked` : rootPath;
  return resolve(resourceRoot, "vendor/html-slide-mender/scripts/inject-html-editor.mjs");
}

export function resolveEditorWorkingDirectory(rootPath = appRoot) {
  return dirname(resolveEditorInjectorPath(rootPath));
}

export function isHtmlFile(fileName = "") {
  return /\.html?$/i.test(String(fileName).trim());
}

export function isHtmlContent(content = "") {
  let source = String(content).replace(/^\uFEFF/, "").trimStart();
  while (source.startsWith("<!--")) {
    const commentEnd = source.indexOf("-->");
    if (commentEnd < 0) return false;
    source = source.slice(commentEnd + 3).trimStart();
  }
  return /^(?:<!doctype\s+html\b|<html\b|<head\b|<body\b)/i.test(source);
}

export function isZipFile(fileName = "") {
  return /\.zip$/i.test(String(fileName).trim());
}

export function sanitizeFileName(fileName = "") {
  const rawName = basename(String(fileName).replace(/\\/g, "/"));
  const extension = isHtmlFile(rawName) ? extname(rawName).toLowerCase() : ".html";
  const stem = rawName.replace(/\.html?$/i, "");
  const readableStem = Array.from(stem)
    .map((char) => {
      if (/\p{Script=Han}/u.test(char)) {
        return `-${pinyin(char, { toneType: "none", type: "array" })[0] || ""}-`;
      }
      return char;
    })
    .join("");
  const safeStem = readableStem
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

  return `${safeStem || "deck"}${extension}`;
}

export function toEditableFileName(fileName = "") {
  const safeName = sanitizeFileName(fileName);
  const extension = extname(safeName) || ".html";
  return `${safeName.slice(0, -extension.length)}.editable${extension}`;
}

export async function extractProjectZip({ zipPath, targetDir }) {
  await mkdir(targetDir, { recursive: true });
  const directory = await unzipper.Open.file(zipPath);
  const files = directory.files.filter((entry) => entry.type === "File");
  const extractedFiles = [];
  const mediaCounts = { html: 0, image: 0, video: 0, other: 0 };

  for (const entry of files) {
    const safeRelativePath = normalizeProjectRelativePath(entry.path);
    const outputPath = resolve(targetDir, ...safeRelativePath.split("/"));
    if (!isInsideDirectory(targetDir, outputPath)) {
      throw new Error(`Unsafe zip entry: ${entry.path}`);
    }

    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, await entry.buffer());
    extractedFiles.push(safeRelativePath);
    mediaCounts[classifyProjectFile(safeRelativePath)] += 1;
  }

  const entryHtml = findProjectEntryHtml(extractedFiles);
  if (!entryHtml) {
    throw new Error("ZIP 项目包里没有找到 HTML 入口文件。");
  }

  return {
    entryHtml,
    files: extractedFiles,
    mediaCounts,
    rootName: findCommonProjectRoot(extractedFiles)
  };
}

export async function createEditableProject({ sourceDir, outputDir, entryHtml, files = [], lang = "zh-CN", includeEntry = false }) {
  const safeEntryHtml = normalizeProjectRelativePath(entryHtml);
  await mkdir(outputDir, { recursive: true });
  await copyProjectResources({ sourceDir, outputDir });

  const pages = await discoverProjectPages({ sourceDir, entryHtml: safeEntryHtml, files, includeEntry });
  let outputSize = 0;

  for (const page of pages) {
    const inputPath = resolve(sourceDir, ...page.sourceRelativePath.split("/"));
    const outputPath = resolve(outputDir, ...page.editRelativePath.split("/"));
    await makeEditableHtml({ inputPath, outputPath, lang });
    const outputStats = await stat(outputPath);
    page.outputPath = outputPath;
    page.outputSize = outputStats.size;
    outputSize += outputStats.size;
  }

  return {
    entryHtml: safeEntryHtml,
    editRelativePath: pages[0]?.editRelativePath || toEditableRelativePath(safeEntryHtml),
    outputPath: pages[0]?.outputPath || "",
    outputSize,
    pages
  };
}

export async function discoverProjectPages({ sourceDir, entryHtml, files = [], includeEntry = false }) {
  const safeEntryHtml = normalizeProjectRelativePath(entryHtml);
  const htmlFiles = files
    .filter(isHtmlFile)
    .map(normalizeProjectRelativePath);
  const uniqueHtmlFiles = Array.from(new Set(htmlFiles.length ? htmlFiles : [safeEntryHtml]));
  const entryDir = posix.dirname(safeEntryHtml) === "." ? "" : posix.dirname(safeEntryHtml);
  const sameDirHtmlFiles = uniqueHtmlFiles.filter((file) => {
    const fileDir = posix.dirname(file) === "." ? "" : posix.dirname(file);
    return fileDir === entryDir;
  });
  const entryMarkup = await readFile(resolve(sourceDir, ...safeEntryHtml.split("/")), "utf8").catch(() => "");
  const iframePages = extractIframeSources(entryMarkup, entryDir)
    .filter((file) => uniqueHtmlFiles.includes(file));
  const numberedPages = sameDirHtmlFiles.filter((file) => parsePageNumber(file) != null);
  const selected = iframePages.length
    ? mergePageLists(iframePages, numberedPages)
    : numberedPages.length
      ? numberedPages
      : uniqueHtmlFiles;

  return selected
    .filter((file) => includeEntry || file !== safeEntryHtml || selected.length === 1)
    .sort(compareProjectPages)
    .map((sourceRelativePath, index) => ({
      sourceRelativePath,
      editRelativePath: toEditableRelativePath(sourceRelativePath),
      label: makePageLabel(sourceRelativePath, index),
      title: basename(sourceRelativePath)
    }));
}

export async function createProjectVersion({
  baseDir,
  versionDir,
  versionId,
  entryHtml,
  html,
  excludeRelativePath = "",
  note = ""
}) {
  const safeEntryHtml = normalizeProjectRelativePath(entryHtml);
  const safeExcludeRelativePath = excludeRelativePath ? normalizeProjectRelativePath(excludeRelativePath) : "";
  const createdAt = new Date().toISOString();

  await mkdir(versionDir, { recursive: true });
  await copyProjectResources({
    sourceDir: baseDir,
    outputDir: versionDir,
    excludeRelativePath: safeExcludeRelativePath
  });

  const htmlPath = resolve(versionDir, ...safeEntryHtml.split("/"));
  await mkdir(dirname(htmlPath), { recursive: true });
  await writeFile(htmlPath, String(html || ""), "utf8");

  const archivePath = resolve(dirname(versionDir), `${versionId}.zip`);
  const archive = await zipProjectDirectory({ directoryPath: versionDir, archivePath });
  const htmlStats = await stat(htmlPath);

  return {
    id: versionId,
    note,
    createdAt,
    entryHtml: safeEntryHtml,
    htmlPath,
    archivePath,
    size: htmlStats.size,
    archiveSize: archive.bytes
  };
}

export async function createPageVersion({ versionsDir, pageId, versionId, html, note = "" }) {
  if (!/^[a-z0-9-]+$/i.test(String(pageId)) || !/^v\d+$/i.test(String(versionId))) {
    throw new Error("Invalid page version identifier.");
  }
  const createdAt = new Date().toISOString();
  const versionDirectory = resolve(versionsDir, pageId);
  const htmlPath = resolve(versionDirectory, `${versionId}.html`);
  await mkdir(versionDirectory, { recursive: true });
  await writeFile(htmlPath, String(html || ""), "utf8");
  const htmlStats = await stat(htmlPath);
  return {
    id: versionId,
    key: `${pageId}-${versionId}`,
    pageId,
    note,
    createdAt,
    size: htmlStats.size,
    htmlPath
  };
}

export async function commitProjectPageEdit({
  sourceDir,
  outputDir,
  projectId,
  sourceRelativePath,
  editRelativePath,
  html,
  pageNav = null,
  lang = "zh-CN"
}) {
  const safeSourceRelativePath = normalizeProjectRelativePath(sourceRelativePath);
  const safeEditRelativePath = normalizeProjectRelativePath(editRelativePath);
  const cleanHtml = String(html || "");
  const sourcePath = resolve(sourceDir, ...safeSourceRelativePath.split("/"));
  const outputPagePath = resolve(outputDir, ...safeSourceRelativePath.split("/"));
  const editablePath = resolve(outputDir, ...safeEditRelativePath.split("/"));

  await mkdir(dirname(sourcePath), { recursive: true });
  await mkdir(dirname(outputPagePath), { recursive: true });
  await writeFile(sourcePath, cleanHtml, "utf8");
  await writeFile(outputPagePath, cleanHtml, "utf8");
  await makeEditableHtml({
    inputPath: outputPagePath,
    outputPath: editablePath,
    lang
  });
  await injectVersionSaveButton({
    htmlPath: editablePath,
    projectId,
    editRelativePath: safeEditRelativePath,
    pageNav
  });

  const outputStats = await stat(editablePath);
  return {
    sourceRelativePath: safeSourceRelativePath,
    editRelativePath: safeEditRelativePath,
    outputPath: editablePath,
    outputSize: outputStats.size
  };
}

export async function injectVersionSaveButton({ htmlPath, projectId, editRelativePath, pageNav = null }) {
  const source = await readFile(htmlPath, "utf8");
  const cleaned = stripVersionSaveInjection(source);
  const injection = buildVersionSaveInjection({ projectId, editRelativePath, pageNav });
  const output = injectBeforeClosingBody(cleaned, injection);
  await writeFile(htmlPath, output, "utf8");
}

export async function injectProjectPreviewToolbar({ htmlPath, pageLabel = "", toolbar = {} }) {
  const source = await readFile(htmlPath, "utf8");
  const cleaned = stripProjectPreviewToolbar(source);
  const injection = buildProjectPreviewToolbar({ pageLabel, toolbar });
  const output = injectBeforeClosingBody(cleaned, injection);
  await writeFile(htmlPath, output, "utf8");
}

export async function makeEditableHtml({ inputPath, outputPath, lang = "zh-CN" }) {
  await mkdir(dirname(outputPath), { recursive: true });

  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [
      injectorPath,
      inputPath,
      "--out",
      outputPath,
      "--lang",
      lang,
      "--mode",
      "basic"
    ], {
      cwd: editorWorkingDirectory,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1"
      },
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", async (code) => {
      if (code !== 0) {
        reject(new Error(stderr || stdout || `inject-html-editor exited with code ${code}`));
        return;
      }
      try {
        await stat(outputPath);
        resolvePromise({ stdout, stderr });
      } catch {
        reject(new Error(`编辑器没有生成输出文件：${basename(outputPath)}`));
      }
    });
  });
}

export async function zipOutputs({ archivePath, files }) {
  await mkdir(dirname(archivePath), { recursive: true });

  return new Promise((resolvePromise, reject) => {
    const output = createWriteStream(archivePath);
    const archive = new ZipArchive({ zlib: { level: 9 } });
    const usedNames = new Set();
    const entries = [];

    output.on("close", () => resolvePromise({ bytes: archive.pointer(), entries }));
    output.on("error", reject);
    archive.on("error", reject);
    archive.pipe(output);

    for (const file of files) {
      const entryName = makeUniqueArchiveName(sanitizeFileName(file.name), usedNames);
      entries.push(entryName);
      archive.file(file.path, { name: entryName });
    }

    archive.finalize();
  });
}

export async function zipProjectDirectory({ directoryPath, archivePath }) {
  await mkdir(dirname(archivePath), { recursive: true });
  const files = await listProjectFiles(directoryPath);

  return new Promise((resolvePromise, reject) => {
    const output = createWriteStream(archivePath);
    const archive = new ZipArchive({ zlib: { level: 9 } });
    const entries = [];

    output.on("close", () => resolvePromise({ bytes: archive.pointer(), entries }));
    output.on("error", reject);
    archive.on("error", reject);
    archive.pipe(output);

    for (const file of files) {
      entries.push(file.relativePath);
      archive.file(file.path, { name: file.relativePath });
    }

    archive.finalize();
  });
}

function stripVersionSaveInjection(html) {
  return String(html || "").replace(
    /\n?<!-- hsm-local-version-save:start -->[\s\S]*?<!-- hsm-local-version-save:end -->\n?/g,
    "\n"
  );
}

function stripProjectPreviewToolbar(html) {
  return String(html || "").replace(
    /\n?<!-- hsm-local-project-toolbar:start -->[\s\S]*?<!-- hsm-local-project-toolbar:end -->\n?/g,
    "\n"
  );
}

export function createStaticThumbnailHtml(html, baseHref = "") {
  const withoutControls = stripProjectPreviewToolbar(stripVersionSaveInjection(String(html || "")));
  const withoutScripts = withoutControls
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "")
    .replace(/\s+on[a-z][\w:-]*\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s+(?:href|src|action|formaction)\s*=\s*(?:"\s*javascript:[^"]*"|'\s*javascript:[^']*'|\s*javascript:[^\s>]+)/gi, "")
    .replace(/\s+srcdoc\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/<base\b[^>]*>/gi, "");
  const base = `<base href="${escapeAttribute(baseHref)}">`;
  if (/<head\b[^>]*>/i.test(withoutScripts)) {
    return withoutScripts.replace(/<head\b[^>]*>/i, (match) => `${match}${base}`);
  }
  if (/<html\b[^>]*>/i.test(withoutScripts)) {
    return withoutScripts.replace(/<html\b[^>]*>/i, (match) => `${match}<head>${base}</head>`);
  }
  return `<head>${base}</head>${withoutScripts}`;
}

function buildVersionSaveInjection({ projectId, editRelativePath, pageNav = null }) {
  const projectIdJson = JSON.stringify(String(projectId || ""));
  const editRelativePathJson = JSON.stringify(String(editRelativePath || ""));
  const pageNavJson = JSON.stringify(pageNav || {});
  return `<!-- hsm-local-version-save:start -->
<style data-hsm-version-save>
  #html-slide-mender-root {
    z-index: 2147483645 !important;
  }
  .hsm-version-save-bar {
    position: fixed;
    left: 18px;
    right: 18px;
    bottom: 18px;
    z-index: 2147483647;
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    padding: 10px 12px;
    border: 1px solid rgba(15, 118, 110, 0.55);
    background: rgba(255, 250, 241, 0.96);
    color: #1d2522;
    font: 13px/1.4 Avenir Next, Trebuchet MS, Verdana, sans-serif;
    box-shadow: 0 12px 34px rgba(29, 37, 34, 0.16);
  }
  .hsm-version-save-nav {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .hsm-version-save-bar button {
    min-height: 34px;
    border: 1px solid #0f766e;
    background: #0f766e;
    color: #fffaf1;
    padding: 0 12px;
    cursor: pointer;
    font: inherit;
  }
  .hsm-version-save-bar button.hsm-copy-button {
    background: #fffaf1;
    color: #0a4f49;
  }
  .hsm-version-save-bar a {
    min-height: 34px;
    border: 1px solid rgba(15, 118, 110, 0.42);
    color: #0a4f49;
    background: #fffaf1;
    padding: 7px 10px;
    text-decoration: none;
    font: inherit;
  }
  .hsm-version-save-bar a:hover {
    background: #e3f3ef;
  }
  .hsm-version-save-bar button:disabled {
    opacity: 0.62;
    cursor: not-allowed;
  }
  .hsm-version-save-status {
    min-width: 9em;
    color: #65706b;
  }
  .hsm-page-sidebar {
    position: fixed;
    left: 18px;
    top: 92px;
    bottom: 86px;
    z-index: 2147483647;
    width: 236px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 10px;
    border: 1px solid rgba(15, 118, 110, 0.48);
    background: rgba(255, 250, 241, 0.97);
    color: #1d2522;
    font: 12px/1.35 Avenir Next, Trebuchet MS, Verdana, sans-serif;
    box-shadow: 0 12px 34px rgba(29, 37, 34, 0.16);
    transform: translateX(calc(-100% - 28px));
    transition: transform 160ms ease;
  }
  .hsm-page-sidebar[data-open="true"] {
    transform: translateX(0);
  }
  .hsm-page-sidebar-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .hsm-page-sidebar-title {
    color: #0a4f49;
    font-weight: 800;
  }
  .hsm-page-sidebar-head-actions {
    display: flex;
    gap: 5px;
  }
  .hsm-page-sidebar-create,
  .hsm-page-sidebar-close {
    border: 1px solid rgba(15, 118, 110, 0.42);
    background: #fffaf1;
    color: #0a4f49;
    min-height: 28px;
    padding: 0 8px;
    cursor: pointer;
    font: inherit;
  }
  .hsm-page-sidebar-create {
    border-color: #0f766e;
    background: #0f766e;
    color: #fffaf1;
    font-weight: 800;
  }
  .hsm-page-thumbs {
    display: grid;
    gap: 8px;
    margin: 0;
    padding: 0;
    overflow: auto;
    list-style: none;
  }
  .hsm-page-thumb-item {
    position: relative;
    display: grid;
    gap: 5px;
    padding: 5px;
    border: 1px solid transparent;
    background: rgba(255, 253, 247, 0.72);
  }
  .hsm-page-thumb-item.is-dragging {
    opacity: 0.52;
  }
  .hsm-page-thumb-item.drop-before {
    border-top: 4px solid #0f766e;
  }
  .hsm-page-thumb-item.drop-after {
    border-bottom: 4px solid #0f766e;
  }
  .hsm-page-thumb {
    position: relative;
    display: block;
    padding: 8px;
    border: 1px solid rgba(15, 118, 110, 0.28);
    background: #fffdf7;
    color: #1d2522;
    text-decoration: none;
  }
  .hsm-page-thumb:hover {
    background: #e3f3ef;
  }
  .hsm-page-thumb[aria-current="page"] {
    border-color: #0f766e;
    background: #dff4ee;
    box-shadow: inset 4px 0 0 #0f766e;
  }
  .hsm-page-thumb-number {
    position: absolute;
    left: 12px;
    top: 12px;
    z-index: 2;
    display: inline-grid;
    width: 24px;
    height: 24px;
    place-items: center;
    border: 1px solid rgba(15, 118, 110, 0.36);
    background: #fffaf1;
    color: #0a4f49;
    font-weight: 800;
  }
  .hsm-page-thumb-preview {
    position: relative;
    display: block;
    width: 100%;
    aspect-ratio: 16 / 9;
    overflow: hidden;
    border: 1px solid rgba(15, 118, 110, 0.24);
    background: #eef2ee;
  }
  .hsm-page-thumb-preview iframe {
    position: absolute;
    inset: 0 auto auto 0;
    width: 800%;
    height: 800%;
    border: 0;
    pointer-events: none;
    transform: scale(0.125);
    transform-origin: left top;
    background: #fff;
  }
  .hsm-page-thumb-preview-fallback {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    color: #65706b;
    background: linear-gradient(135deg, #f7f4ea, #e7eeea);
    font-size: 11px;
  }
  .hsm-page-thumb-preview[data-loaded="true"] .hsm-page-thumb-preview-fallback {
    display: none;
  }
  .hsm-page-thumb-copy {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 8px;
    align-items: baseline;
    padding-top: 7px;
  }
  .hsm-page-thumb-label {
    display: block;
    color: #0a4f49;
    font-weight: 800;
  }
  .hsm-page-thumb-title {
    display: block;
    color: #65706b;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .hsm-scene-tree,
  .hsm-scene-children {
    display: grid;
    gap: 4px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .hsm-scene-tree {
    padding: 2px 4px 4px 34px;
  }
  .hsm-scene-children {
    padding: 4px 0 0 14px;
  }
  .hsm-scene-open {
    width: 100%;
    min-height: 30px;
    border: 1px solid rgba(15, 118, 110, 0.28);
    background: #fffdf7;
    color: #0a4f49;
    padding: 5px 8px;
    text-align: left;
    cursor: pointer;
    font: 700 11px/1.35 Avenir Next, Trebuchet MS, Verdana, sans-serif;
  }
  .hsm-scene-open:hover,
  .hsm-scene-open:focus-visible {
    border-color: #0f766e;
    background: #e3f3ef;
    outline: none;
  }
  .hsm-scene-open[aria-current="true"] {
    border-color: #0f766e;
    background: #dff4ee;
  }
  .hsm-scene-breadcrumb {
    display: flex;
    align-items: center;
    gap: 5px;
    max-width: min(44vw, 520px);
    overflow: hidden;
  }
  .hsm-scene-breadcrumb button,
  .hsm-scene-breadcrumb span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .hsm-scene-breadcrumb button {
    min-height: 30px;
    border: 0;
    background: transparent;
    color: #0a4f49;
    padding: 0 4px;
    text-decoration: underline;
  }
  .hsm-scene-breadcrumb span[aria-current="page"] {
    color: #1d2522;
    font-weight: 800;
  }
  .hsm-scene-message {
    color: #7c4a03;
    font-weight: 700;
  }
  .hsm-page-thumb-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .hsm-page-thumb-actions button {
    min-height: 25px;
    border: 1px solid rgba(15, 118, 110, 0.34);
    background: #fffaf1;
    color: #0a4f49;
    padding: 2px 6px;
    cursor: pointer;
    font: 700 10px/1.2 Avenir Next, Trebuchet MS, Verdana, sans-serif;
  }
  .hsm-page-thumb-actions button:hover {
    background: #e3f3ef;
  }
  .hsm-page-thumb-actions button:disabled {
    opacity: 0.42;
    cursor: not-allowed;
  }
  .hsm-page-thumb-actions [data-hsm-page-drag-handle] {
    cursor: grab;
    font-size: 13px;
  }
  .hsm-page-thumb-actions [data-hsm-delete-page] {
    border-color: rgba(180, 83, 9, 0.34);
    color: #9a4d08;
  }
  @media (max-width: 760px) {
    .hsm-page-sidebar {
      top: 70px;
      bottom: 118px;
      width: 168px;
    }
  }
</style>
<script data-hsm-version-save>
(() => {
  const projectId = ${projectIdJson};
  const editRelativePath = ${editRelativePathJson};
  const pageNav = ${pageNavJson};
  if (!projectId || document.querySelector(".hsm-version-save-bar")) return;
  window.__HTML_MENDER_PAGE_NAV__ = pageNav;

  const bar = document.createElement("div");
  bar.className = "hsm-version-save-bar";
  bar.setAttribute("data-hsm-version-save", "true");
  bar.setAttribute("data-hsm-editor", "task-toolbar");
  const links = [
    pageNav.projectUrl ? '<a data-hsm-nav href="' + pageNav.projectUrl + '">退出编辑并返回列表</a>' : '',
    pageNav.previousUrl ? '<a data-hsm-nav href="' + pageNav.previousUrl + '">上一页</a>' : '',
    pageNav.nextUrl ? '<a data-hsm-nav href="' + pageNav.nextUrl + '">下一页</a>' : ''
  ].filter(Boolean).join("");
  const pages = Array.isArray(pageNav.pages) ? pageNav.pages : [];
  const scenes = Array.isArray(pageNav.scenes) ? pageNav.scenes : [];
  const pageListButtonHtml = pages.length
    ? '<button data-hsm-page-list class="hsm-copy-button" type="button" aria-expanded="true">课件画面</button>'
    : '';
  const initialVersion = pageNav.currentVersionId || "v001";
  const pageLabel = pageNav.pageLabel || "当前页";
  const pageTitle = pageNav.pageTitle || pageLabel || "首页";
  bar.innerHTML = '<strong>' + escapeText(pageNav.taskName || "当前任务") + ' · ' + escapeText(pageLabel) + '</strong>'
    + '<button data-hsm-save type="button">保存版本</button>'
    + '<button data-hsm-copy class="hsm-copy-button" type="button">复制 HTML</button>'
    + pageListButtonHtml
    + '<nav class="hsm-scene-breadcrumb" data-hsm-scene-breadcrumb aria-label="当前位置"></nav>'
    + '<span class="hsm-version-save-status">当前 ' + escapeText(initialVersion) + ' · 已保存</span>'
    + '<span class="hsm-scene-message" data-hsm-scene-message role="status" aria-live="polite"></span>'
    + '<span class="hsm-version-save-nav">' + links + '</span>';
  document.documentElement.appendChild(bar);

  const button = bar.querySelector("[data-hsm-save]");
  const copyButton = bar.querySelector("[data-hsm-copy]");
  const pageListButton = bar.querySelector("[data-hsm-page-list]");
  const status = bar.querySelector(".hsm-version-save-status");
  const sceneBreadcrumb = bar.querySelector("[data-hsm-scene-breadcrumb]");
  const sceneMessage = bar.querySelector("[data-hsm-scene-message]");
  const pageSidebar = pages.length ? buildPageSidebar(pages) : null;
  let baselineHtml = null;
  let likelyDirty = false;
  let navigating = false;

  function escapeText(value) {
    const node = document.createElement("span");
    node.textContent = String(value || "");
    return node.innerHTML;
  }

  function buildPageSidebar(items) {
    const aside = document.createElement("aside");
    aside.className = "hsm-page-sidebar";
    aside.setAttribute("data-hsm-page-sidebar", "true");
    aside.setAttribute("data-hsm-version-save", "true");
    aside.setAttribute("data-hsm-editor", "task-page-sidebar");
    const remembered = localStorage.getItem("hsm-page-sidebar-open");
    aside.dataset.open = remembered === "false" ? "false" : "true";

    const head = document.createElement("div");
    head.className = "hsm-page-sidebar-head";
    const title = document.createElement("span");
    title.className = "hsm-page-sidebar-title";
    title.textContent = "课件画面";
    const headActions = document.createElement("span");
    headActions.className = "hsm-page-sidebar-head-actions";
    const create = document.createElement("button");
    create.className = "hsm-page-sidebar-create";
    create.type = "button";
    create.textContent = "+ 空白页";
    create.setAttribute("data-hsm-create-page", "true");
    const close = document.createElement("button");
    close.className = "hsm-page-sidebar-close";
    close.type = "button";
    close.textContent = "收起";
    close.addEventListener("click", () => setPageSidebarOpen(false));
    headActions.append(create, close);
    head.append(title, headActions);

    const list = document.createElement("ol");
    list.className = "hsm-page-thumbs";
    items.forEach((item, index) => {
      const li = document.createElement("li");
      li.className = "hsm-page-thumb-item";
      li.dataset.pageId = item.id || "";
      const link = document.createElement("a");
      link.className = "hsm-page-thumb";
      link.href = item.editUrl || "#";
      link.setAttribute("data-hsm-page-nav", "true");
      if (item.current) {
        link.setAttribute("aria-current", "page");
      }
      const number = document.createElement("span");
      number.className = "hsm-page-thumb-number";
      number.textContent = String(index + 1);
      const preview = document.createElement("span");
      preview.className = "hsm-page-thumb-preview";
      preview.innerHTML = '<iframe data-hsm-page-preview data-preview-url="" sandbox="allow-same-origin" loading="lazy" tabindex="-1" aria-hidden="true"></iframe><span class="hsm-page-thumb-preview-fallback">正在加载页面</span>';
      const frame = preview.querySelector("[data-hsm-page-preview]");
      frame.dataset.previewUrl = item.thumbnailUrl || item.viewUrl || "";
      frame.title = (item.label || ("第 " + (index + 1) + " 页")) + "缩略图";
      const copy = document.createElement("span");
      copy.className = "hsm-page-thumb-copy";
      const label = document.createElement("span");
      label.className = "hsm-page-thumb-label";
      label.textContent = item.label || ("第 " + (index + 1) + " 页");
      const itemTitle = document.createElement("span");
      itemTitle.className = "hsm-page-thumb-title";
      itemTitle.textContent = item.title || "课件页";
      copy.append(label, itemTitle);
      link.append(number, preview, copy);
      const sceneTree = buildSceneTree(item);
      const actions = document.createElement("span");
      actions.className = "hsm-page-thumb-actions";
      actions.innerHTML = '<button type="button" data-hsm-page-drag-handle title="拖动排序">⋮⋮</button>'
        + '<button type="button" data-hsm-move-page="up"' + (index === 0 ? ' disabled' : '') + '>上移</button>'
        + '<button type="button" data-hsm-move-page="down"' + (index === items.length - 1 ? ' disabled' : '') + '>下移</button>'
        + '<button type="button" data-hsm-create-page="after">新增</button>'
        + '<button type="button" data-hsm-duplicate-page>复制</button>'
        + '<button type="button" data-hsm-delete-page' + (items.length <= 1 ? ' disabled' : '') + '>删除</button>';
      li.append(link);
      if (sceneTree) li.append(sceneTree);
      li.append(actions);
      list.appendChild(li);
    });

    aside.append(head, list);
    document.documentElement.appendChild(aside);
    return aside;
  }

  function buildSceneTree(page) {
    if (!page.current) return null;
    const pageScenes = scenes.filter((scene) => scene?.type === "modal" && scene.pageId === page.id);
    if (!pageScenes.length) return null;
    const children = new Map();
    pageScenes.forEach((scene) => {
      const parentId = String(scene.parentSceneId || "");
      const group = children.get(parentId) || [];
      group.push(scene);
      children.set(parentId, group);
    });
    const root = document.createElement("ul");
    root.className = "hsm-scene-tree";
    root.setAttribute("data-hsm-scene-tree", "true");
    root.setAttribute("aria-label", "当前页面里的画面");

    const appendChildren = (parentId, list, visited = new Set()) => {
      for (const scene of children.get(parentId) || []) {
        if (!scene?.id || visited.has(scene.id)) continue;
        const nextVisited = new Set(visited);
        nextVisited.add(scene.id);
        const item = document.createElement("li");
        const open = document.createElement("button");
        open.type = "button";
        open.className = "hsm-scene-open";
        open.setAttribute("data-hsm-open-scene", scene.id);
        open.textContent = scene.title || "弹出内容";
        item.append(open);
        const childScenes = children.get(scene.id) || [];
        if (childScenes.length) {
          const nested = document.createElement("ul");
          nested.className = "hsm-scene-children";
          appendChildren(scene.id, nested, nextVisited);
          item.append(nested);
        }
        list.append(item);
      }
    };
    appendChildren("scene:page:" + page.id, root);
    return root.childElementCount ? root : null;
  }

  function renderSceneBreadcrumb(path = []) {
    if (!sceneBreadcrumb) return;
    sceneBreadcrumb.replaceChildren();
    const home = document.createElement(path.length ? "button" : "span");
    home.textContent = pageTitle;
    if (path.length) {
      home.type = "button";
      home.setAttribute("data-hsm-scene-depth", "0");
    } else {
      home.setAttribute("aria-current", "page");
    }
    sceneBreadcrumb.append(home);
    path.forEach((scene, index) => {
      const separator = document.createElement("span");
      separator.textContent = "›";
      separator.setAttribute("aria-hidden", "true");
      const isCurrent = index === path.length - 1;
      const crumb = document.createElement(isCurrent ? "span" : "button");
      crumb.textContent = scene?.title || "弹出内容";
      if (isCurrent) {
        crumb.setAttribute("aria-current", "page");
      } else {
        crumb.type = "button";
        crumb.setAttribute("data-hsm-scene-depth", String(index + 1));
      }
      sceneBreadcrumb.append(separator, crumb);
    });
  }

  function renderSceneLocation(path = []) {
    renderSceneBreadcrumb(path);
    pageSidebar?.querySelectorAll("[data-hsm-open-scene]").forEach((button) => {
      button.setAttribute("aria-current", path.some((scene) => scene?.id === button.dataset.hsmOpenScene) ? "true" : "false");
    });
  }

  function interactionScenePath(detail = {}) {
    const scene = scenes.find((candidate) =>
      candidate?.type === "modal" && (
        candidate.id === detail.sceneId
        || candidate.entry?.interactionId === detail.interactionId
        || candidate.entry?.interactionId === detail.sceneId
      )
    );
    if (!scene) return [];
    const sceneById = new Map(scenes.map((candidate) => [String(candidate?.id || ""), candidate]));
    const path = [];
    const visited = new Set();
    let current = scene;
    while (current?.id && !visited.has(current.id)) {
      visited.add(current.id);
      path.push(current);
      const parentId = String(current.parentSceneId || "");
      if (!parentId || parentId.startsWith("scene:page:")) break;
      current = sceneById.get(parentId);
    }
    return path.reverse();
  }

  function showSceneMessage(message = "") {
    if (sceneMessage) sceneMessage.textContent = message;
  }

  function enterScene(sceneId) {
    showSceneMessage("");
    const entered = window.__htmlSlideMenderBootstrap?.editor?.enterSceneById?.(sceneId);
    if (!entered) {
      showSceneMessage("这个画面暂时无法打开，可以从课件中的原按钮进入");
    }
  }

  function exitScenesToDepth(depth) {
    showSceneMessage("");
    const exited = window.__htmlSlideMenderBootstrap?.editor?.exitScenesToDepth?.(depth);
    if (!exited && Number(depth) > 0) {
      showSceneMessage("这个画面暂时无法打开，可以从课件中的原按钮进入");
    }
  }

  renderSceneLocation([]);
  window.addEventListener("hsm-scene-navigation", (event) => {
    const path = Array.isArray(event.detail?.path) ? event.detail.path : [];
    renderSceneLocation(path);
  });
  window.addEventListener("hsm-scene-event", (event) => {
    const detail = event.detail || {};
    if (detail.preview !== true || !["scene.entered", "scene.exited"].includes(detail.type)) return;
    const path = interactionScenePath(detail);
    if (!path.length) return;
    renderSceneLocation(detail.type === "scene.exited" ? path.slice(0, -1) : path);
  });

  function setPageSidebarOpen(open) {
    if (!pageSidebar) return;
    pageSidebar.dataset.open = open ? "true" : "false";
    if (pageListButton) {
      pageListButton.setAttribute("aria-expanded", open ? "true" : "false");
      pageListButton.textContent = open ? "隐藏画面" : "课件画面";
    }
    try {
      localStorage.setItem("hsm-page-sidebar-open", open ? "true" : "false");
    } catch (_error) {
    }
  }

  if (pageSidebar) {
    setPageSidebarOpen(pageSidebar.dataset.open === "true");
    initializePagePreviews();
  }

  function prepareThumbnailDocument(frame) {
    try {
      const previewDocument = frame.contentDocument;
      if (!previewDocument) return;
      previewDocument.querySelectorAll("[data-hsm-project-toolbar], [data-hsm-version-save], [data-hsm-editor]").forEach((node) => node.remove());
      const style = previewDocument.createElement("style");
      style.textContent = "html,body{overflow:hidden!important}*{animation-play-state:paused!important;transition:none!important}";
      previewDocument.head?.appendChild(style);
      frame.closest(".hsm-page-thumb-preview")?.setAttribute("data-loaded", "true");
    } catch (_error) {
      frame.closest(".hsm-page-thumb-preview")?.setAttribute("data-loaded", "true");
    }
  }

  function loadPagePreview(frame, force = false) {
    if (!frame?.dataset.previewUrl || (frame.dataset.loaded === "true" && !force)) return;
    frame.dataset.loaded = "true";
    frame.addEventListener("load", () => prepareThumbnailDocument(frame), { once: true });
    frame.src = frame.dataset.previewUrl + (frame.dataset.previewUrl.includes("?") ? "&" : "?") + "hsm-thumbnail=" + Date.now();
  }

  function initializePagePreviews() {
    const frames = Array.from(pageSidebar?.querySelectorAll("[data-hsm-page-preview]") || []);
    const current = pageSidebar?.querySelector('[aria-current="page"] [data-hsm-page-preview]');
    loadPagePreview(current);
    if (!("IntersectionObserver" in window)) {
      frames.forEach((frame) => loadPagePreview(frame));
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        loadPagePreview(entry.target);
        observer.unobserve(entry.target);
      }
    }, { root: pageSidebar?.querySelector(".hsm-page-thumbs") || null, rootMargin: "220px 0px" });
    frames.forEach((frame) => observer.observe(frame));
  }

  function reloadCurrentPagePreview() {
    const frame = pageSidebar?.querySelector('[aria-current="page"] [data-hsm-page-preview]');
    if (frame) loadPagePreview(frame, true);
  }

  async function serializeCleanHtml() {
    const editor = window.__htmlSlideMenderBootstrap?.editor;
    if (editor?.commitActiveText) {
      editor.commitActiveText();
    }
    if (editor?.serializeCleanHtml) {
      return await editor.serializeCleanHtml("basic");
    }

    const clone = document.documentElement.cloneNode(true);
    clone.querySelectorAll("[data-hsm-version-save], .hsm-version-save-bar, [data-hsm-editor], [data-hsm-project-toolbar]").forEach((node) => node.remove());
    const doctype = document.doctype
      ? "<!DOCTYPE " + document.doctype.name + ">"
      : "<!doctype html>";
    return doctype + "\\n" + clone.outerHTML;
  }

  async function saveCurrentVersion() {
    button.disabled = true;
    status.textContent = "保存中...";
    try {
      const html = await serializeCleanHtml();
      const response = await fetch("/api/projects/" + encodeURIComponent(projectId) + "/versions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ html, editRelativePath })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "保存失败");
      baselineHtml = html;
      likelyDirty = false;
      status.textContent = pageLabel + " " + (payload.version?.id || "新版本") + " 已成功保存";
      try {
        localStorage.setItem("hsm-project-updated", JSON.stringify({
          projectId,
          versionId: payload.version?.id || "",
          editRelativePath,
          savedAt: Date.now()
        }));
      } catch (_error) {
      }
      window.dispatchEvent(new CustomEvent("hsm-version-saved", { detail: payload }));
      reloadCurrentPagePreview();
      return true;
    } catch (error) {
      status.textContent = error?.message || "保存失败";
      return false;
    } finally {
      button.disabled = false;
    }
  }

  async function copyCurrentHtml() {
    copyButton.disabled = true;
    try {
      const html = await serializeCleanHtml();
      let copied = false;
      if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(html);
          copied = true;
        } catch (_error) {
        }
      }
      if (!copied) {
        const textarea = document.createElement("textarea");
        textarea.value = html;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        copied = document.execCommand("copy");
        textarea.remove();
      }
      if (!copied) throw new Error("系统未允许写入剪贴板");
      status.textContent = pageLabel + "完整 HTML 已复制到剪贴板";
    } catch (error) {
      status.textContent = error?.message || "复制失败";
    } finally {
      copyButton.disabled = false;
    }
  }

  async function hasUnsavedChanges() {
    const html = await serializeCleanHtml();
    if (baselineHtml == null) baselineHtml = html;
    return likelyDirty || html !== baselineHtml;
  }

  async function leaveWithGuard(targetUrl) {
    if (navigating || !targetUrl) return;
    if (await hasUnsavedChanges()) {
      if (window.confirm("当前页面有未保存修改。是否保存后离开？")) {
        if (!await saveCurrentVersion()) return;
      } else if (!window.confirm("确定放弃本次修改并离开吗？点击取消可继续编辑。")) {
        status.textContent = "继续编辑，修改尚未保存";
        return;
      }
    }
    navigating = true;
    window.location.href = targetUrl;
  }

  function currentPageId() {
    const current = pages.find((page) => page.current);
    return current?.id || "";
  }

  async function preparePageManagementAction() {
    if (!await hasUnsavedChanges()) return true;
    if (window.confirm("当前页面有未保存修改。是否先保存再管理页面？")) {
      return await saveCurrentVersion();
    }
    if (window.confirm("确定放弃当前未保存修改并继续页面操作吗？")) {
      return true;
    }
    status.textContent = "页面操作已取消，继续编辑当前修改";
    return false;
  }

  async function requestPageManagement(url, options, button, preferredPageId, openCreatedPage) {
    if (!await preparePageManagementAction()) return;
    if (button) button.disabled = true;
    status.textContent = "正在更新页面...";
    try {
      const response = await fetch(url, options);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "页面操作失败");
      const destination = openCreatedPage
        ? payload.page?.editUrl
        : payload.project?.pages?.find((page) => page.id === preferredPageId)?.editUrl || payload.project?.pages?.[0]?.editUrl;
      if (!destination) throw new Error("页面已更新，但没有找到可打开的页面");
      try {
        localStorage.setItem("hsm-project-updated", JSON.stringify({ projectId, pageManagedAt: Date.now() }));
      } catch (_error) {
      }
      navigating = true;
      window.location.href = destination;
    } catch (error) {
      status.textContent = error?.message || "页面操作失败";
      if (button?.isConnected) button.disabled = false;
    }
  }

  async function createSidebarPage(afterPageId, button) {
    await requestPageManagement(
      "/api/projects/" + encodeURIComponent(projectId) + "/pages",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ afterPageId: afterPageId || currentPageId() })
      },
      button,
      "",
      true
    );
  }

  async function duplicateSidebarPage(pageId, button) {
    await requestPageManagement(
      "/api/projects/" + encodeURIComponent(projectId) + "/pages/" + encodeURIComponent(pageId) + "/duplicate",
      { method: "POST" },
      button,
      "",
      true
    );
  }

  async function deleteSidebarPage(pageId, button) {
    const item = pages.find((page) => page.id === pageId);
    if (!window.confirm("确定把“" + (item?.label || "这个页面") + "”移入回收站吗？源码和版本会保留。")) return;
    if (!await preparePageManagementAction()) return;
    button.disabled = true;
    status.textContent = "正在检查页面互动...";
    const baseUrl = "/api/projects/" + encodeURIComponent(projectId) + "/pages/" + encodeURIComponent(pageId);
    try {
      let response = await fetch(baseUrl, { method: "DELETE" });
      let payload = await response.json();
      if (response.status === 409) {
        const labels = (payload.references || []).map((reference) => reference.pageLabel || reference.interactionName).filter(Boolean).join("、");
        const warning = payload.error + (labels ? "\\n引用位置：" + labels : "") + "\\n仍要移入回收站吗？";
        if (!window.confirm(warning)) {
          status.textContent = "已取消删除，页面和互动保持不变";
          button.disabled = false;
          return;
        }
        response = await fetch(baseUrl + "?force=true", { method: "DELETE" });
        payload = await response.json();
      }
      if (!response.ok) throw new Error(payload.error || "页面删除失败");
      const destination = payload.project?.pages?.find((page) => page.id === currentPageId())?.editUrl || payload.project?.pages?.[0]?.editUrl;
      if (!destination) throw new Error("页面已更新，但没有找到可打开的页面");
      navigating = true;
      window.location.href = destination;
    } catch (error) {
      status.textContent = error?.message || "页面删除失败";
      if (button?.isConnected) button.disabled = false;
    }
  }

  async function saveSidebarPageOrder(pageIds, button) {
    await requestPageManagement(
      "/api/projects/" + encodeURIComponent(projectId) + "/pages/order",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageIds })
      },
      button,
      currentPageId(),
      false
    );
  }

  async function moveSidebarPage(pageId, direction, button) {
    const pageIds = pages.map((page) => page.id);
    const index = pageIds.indexOf(pageId);
    const nextIndex = direction === "up" ? index - 1 : index + 1;
    if (index < 0 || nextIndex < 0 || nextIndex >= pageIds.length) return;
    const current = pageIds[index];
    pageIds[index] = pageIds[nextIndex];
    pageIds[nextIndex] = current;
    await saveSidebarPageOrder(pageIds, button);
  }

  function clearSidebarDropIndicators() {
    pageSidebar?.querySelectorAll(".hsm-page-thumb-item").forEach((item) => {
      item.classList.remove("is-dragging", "drop-before", "drop-after");
    });
  }

  button.addEventListener("click", saveCurrentVersion);
  copyButton.addEventListener("click", copyCurrentHtml);
  pageListButton?.addEventListener("click", () => {
    setPageSidebarOpen(pageSidebar?.dataset.open !== "true");
  });
  bar.querySelectorAll("[data-hsm-nav]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      leaveWithGuard(link.href);
    });
  });
  pageSidebar?.querySelectorAll("[data-hsm-page-nav]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      leaveWithGuard(link.href);
    });
  });
  pageSidebar?.addEventListener("click", (event) => {
    const action = event.target.closest("button");
    if (!action) return;
    if (action.hasAttribute("data-hsm-open-scene")) {
      event.preventDefault();
      enterScene(action.dataset.hsmOpenScene || "");
      return;
    }
    const item = action.closest(".hsm-page-thumb-item");
    const pageId = item?.dataset.pageId || currentPageId();
    if (action.hasAttribute("data-hsm-create-page")) {
      event.preventDefault();
      createSidebarPage(action.dataset.hsmCreatePage === "after" ? pageId : currentPageId(), action);
      return;
    }
    if (action.hasAttribute("data-hsm-duplicate-page")) {
      event.preventDefault();
      duplicateSidebarPage(pageId, action);
      return;
    }
    if (action.hasAttribute("data-hsm-delete-page")) {
      event.preventDefault();
      deleteSidebarPage(pageId, action);
      return;
    }
    if (action.hasAttribute("data-hsm-move-page")) {
      event.preventDefault();
      moveSidebarPage(pageId, action.dataset.hsmMovePage, action);
    }
  });
  sceneBreadcrumb?.addEventListener("click", (event) => {
    const action = event.target.closest("button[data-hsm-scene-depth]");
    if (!action) return;
    const depth = Number(action.dataset.hsmSceneDepth || 0);
    window.requestAnimationFrame(() => exitScenesToDepth(depth));
  });

  let sidebarDraggedPageId = "";
  pageSidebar?.addEventListener("dragstart", (event) => {
    if (sidebarPointerDrag) {
      event.preventDefault();
      return;
    }
    const handle = event.target.closest("[data-hsm-page-drag-handle]");
    const item = handle?.closest(".hsm-page-thumb-item");
    if (!handle || !item) return;
    sidebarDraggedPageId = item.dataset.pageId || "";
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", sidebarDraggedPageId);
    item.classList.add("is-dragging");
  });
  pageSidebar?.addEventListener("dragover", (event) => {
    const target = event.target.closest(".hsm-page-thumb-item");
    if (!target || !sidebarDraggedPageId) return;
    event.preventDefault();
    const rect = target.getBoundingClientRect();
    clearSidebarDropIndicators();
    target.classList.add(event.clientY > rect.top + rect.height / 2 ? "drop-after" : "drop-before");
  });
  pageSidebar?.addEventListener("drop", (event) => {
    const target = event.target.closest(".hsm-page-thumb-item");
    if (!target || !sidebarDraggedPageId) return;
    event.preventDefault();
    const draggedPageId = sidebarDraggedPageId;
    sidebarDraggedPageId = "";
    const targetPageId = target.dataset.pageId;
    const rect = target.getBoundingClientRect();
    const after = event.clientY > rect.top + rect.height / 2;
    clearSidebarDropIndicators();
    if (!targetPageId || draggedPageId === targetPageId) return;
    const pageIds = pages.map((page) => page.id).filter((pageId) => pageId !== draggedPageId);
    const targetIndex = pageIds.indexOf(targetPageId);
    if (targetIndex < 0) return;
    pageIds.splice(targetIndex + (after ? 1 : 0), 0, draggedPageId);
    saveSidebarPageOrder(pageIds, null);
  });
  pageSidebar?.addEventListener("dragend", () => {
    sidebarDraggedPageId = "";
    clearSidebarDropIndicators();
  });

  let sidebarPointerDrag = null;
  pageSidebar?.addEventListener("pointerdown", (event) => {
    const handle = event.target.closest("[data-hsm-page-drag-handle]");
    const item = handle?.closest(".hsm-page-thumb-item");
    if (!handle || !item || event.pointerType === "mouse") return;
    sidebarPointerDrag = {
      pageId: item.dataset.pageId || "",
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      targetPageId: "",
      after: false
    };
    handle.setPointerCapture(event.pointerId);
    item.classList.add("is-dragging");
    event.preventDefault();
  });
  pageSidebar?.addEventListener("pointermove", (event) => {
    const current = sidebarPointerDrag;
    if (!current || current.pointerId !== event.pointerId) return;
    if (!current.moved && Math.hypot(event.clientX - current.startX, event.clientY - current.startY) < 6) return;
    current.moved = true;
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest(".hsm-page-thumb-item");
    clearSidebarDropIndicators();
    pageSidebar.querySelector('[data-page-id="' + CSS.escape(current.pageId) + '"]')?.classList.add("is-dragging");
    if (!target) {
      current.targetPageId = "";
      return;
    }
    const rect = target.getBoundingClientRect();
    current.targetPageId = target.dataset.pageId || "";
    current.after = event.clientY > rect.top + rect.height / 2;
    target.classList.add(current.after ? "drop-after" : "drop-before");
    event.preventDefault();
  });
  pageSidebar?.addEventListener("pointerup", finishSidebarPointerDrag);
  pageSidebar?.addEventListener("pointercancel", (event) => finishSidebarPointerDrag(event, true));

  function finishSidebarPointerDrag(event, canceled = false) {
    const current = sidebarPointerDrag;
    if (!current || current.pointerId !== event.pointerId) return;
    sidebarPointerDrag = null;
    const handle = event.target.closest?.("[data-hsm-page-drag-handle]");
    if (handle?.hasPointerCapture?.(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    clearSidebarDropIndicators();
    if (canceled || !current.moved || !current.targetPageId || current.targetPageId === current.pageId) return;
    const pageIds = pages.map((page) => page.id).filter((pageId) => pageId !== current.pageId);
    const targetIndex = pageIds.indexOf(current.targetPageId);
    if (targetIndex < 0) return;
    pageIds.splice(targetIndex + (current.after ? 1 : 0), 0, current.pageId);
    saveSidebarPageOrder(pageIds, null);
  }

  let sidebarMouseDrag = null;
  pageSidebar?.addEventListener("mousedown", (event) => {
    const handle = event.target.closest("[data-hsm-page-drag-handle]");
    const item = handle?.closest(".hsm-page-thumb-item");
    if (!handle || !item || event.button !== 0) return;
    sidebarMouseDrag = {
      pageId: item.dataset.pageId || "",
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      targetPageId: "",
      after: false
    };
    item.classList.add("is-dragging");
    event.preventDefault();
  });
  document.addEventListener("mousemove", (event) => {
    const current = sidebarMouseDrag;
    if (!current) return;
    if (!current.moved && Math.hypot(event.clientX - current.startX, event.clientY - current.startY) < 6) return;
    current.moved = true;
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest(".hsm-page-thumb-item");
    clearSidebarDropIndicators();
    pageSidebar.querySelector('[data-page-id="' + CSS.escape(current.pageId) + '"]')?.classList.add("is-dragging");
    if (!target) {
      current.targetPageId = "";
      return;
    }
    const rect = target.getBoundingClientRect();
    current.targetPageId = target.dataset.pageId || "";
    current.after = event.clientY > rect.top + rect.height / 2;
    target.classList.add(current.after ? "drop-after" : "drop-before");
    event.preventDefault();
  });
  document.addEventListener("mouseup", (event) => {
    const current = sidebarMouseDrag;
    if (!current || event.button !== 0) return;
    sidebarMouseDrag = null;
    clearSidebarDropIndicators();
    if (!current.moved || !current.targetPageId || current.targetPageId === current.pageId) return;
    const pageIds = pages.map((page) => page.id).filter((pageId) => pageId !== current.pageId);
    const targetIndex = pageIds.indexOf(current.targetPageId);
    if (targetIndex < 0) return;
    pageIds.splice(targetIndex + (current.after ? 1 : 0), 0, current.pageId);
    saveSidebarPageOrder(pageIds, null);
  });

  document.addEventListener("input", (event) => {
    if (!bar.contains(event.target)) likelyDirty = true;
  }, true);
  document.addEventListener("change", (event) => {
    if (!bar.contains(event.target)) likelyDirty = true;
  }, true);
  document.addEventListener("click", (event) => {
    const path = event.composedPath?.() || [];
    const editorExit = path.find((item) => item?.matches?.("[data-action='exit']"));
    if (editorExit && !bar.contains(editorExit)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      leaveWithGuard(pageNav.projectUrl);
      return;
    }
    const editorAction = path.find((item) => item?.dataset?.action && item?.dataset?.action !== "collapse");
    if (editorAction && !bar.contains(editorAction)) likelyDirty = true;
  }, true);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && pageSidebar?.dataset.open === "true") {
      setPageSidebarOpen(false);
    }
  });
  window.addEventListener("beforeunload", (event) => {
    if (likelyDirty && !navigating) {
      event.preventDefault();
      event.returnValue = "";
    }
  });

  setTimeout(async () => {
    try {
      baselineHtml = await serializeCleanHtml();
      likelyDirty = false;
    } catch (_error) {
    }
  }, 500);
})();
</script>
<!-- hsm-local-version-save:end -->`;
}

function buildProjectPreviewToolbar({ pageLabel, toolbar }) {
  const safePageLabel = escapeHtml(String(pageLabel || "当前页"));
  const projectUrl = escapeAttribute(toolbar.projectUrl || "");
  const editUrl = escapeAttribute(toolbar.editUrl || "");
  const previousUrl = escapeAttribute(toolbar.previousUrl || "");
  const nextUrl = escapeAttribute(toolbar.nextUrl || "");
  const latestVersionId = escapeHtml(toolbar.latestVersionId || "尚未单独保存");
  const lastSavedAt = toolbar.lastSavedAt
    ? escapeHtml(new Date(toolbar.lastSavedAt).toLocaleString("zh-CN"))
    : "";

  return `<!-- hsm-local-project-toolbar:start -->
<style data-hsm-project-toolbar>
  .hsm-project-toolbar {
    position: fixed;
    left: 50%;
    bottom: 18px;
    z-index: 2147483647;
    display: flex;
    align-items: center;
    gap: 10px;
    max-width: calc(100vw - 28px);
    padding: 10px 12px;
    border: 1px solid rgba(15, 118, 110, 0.56);
    background: rgba(255, 250, 241, 0.96);
    color: #1d2522;
    font: 13px/1.45 Avenir Next, Trebuchet MS, Verdana, sans-serif;
    box-shadow: 0 12px 34px rgba(29, 37, 34, 0.16);
    transform: translateX(-50%);
  }
  .hsm-project-toolbar strong {
    color: #0a4f49;
    white-space: nowrap;
  }
  .hsm-project-toolbar span {
    color: #65706b;
    white-space: nowrap;
  }
  .hsm-project-toolbar a {
    min-height: 34px;
    border: 1px solid rgba(15, 118, 110, 0.42);
    color: #0a4f49;
    background: #fffaf1;
    padding: 7px 10px;
    text-decoration: none;
    font: inherit;
    display: inline-flex;
    align-items: center;
  }
  .hsm-project-toolbar a.hsm-project-toolbar-primary {
    border-color: #0f766e;
    background: #0f766e;
    color: #fffaf1;
    font-weight: 700;
  }
  .hsm-project-toolbar a:hover {
    background: #e3f3ef;
  }
  .hsm-project-toolbar a.hsm-project-toolbar-primary:hover {
    background: #0a4f49;
  }
  @media (max-width: 760px) {
    .hsm-project-toolbar {
      left: 10px;
      right: 10px;
      bottom: 10px;
      transform: none;
      flex-wrap: wrap;
    }
  }
</style>
<div class="hsm-project-toolbar" data-hsm-project-toolbar="true">
  <strong>${safePageLabel}</strong>
  <span>最近：${latestVersionId}${lastSavedAt ? ` · ${lastSavedAt}` : ""}</span>
  ${editUrl ? `<a class="hsm-project-toolbar-primary" href="${editUrl}">编辑本页</a>` : ""}
  ${projectUrl ? `<a href="${projectUrl}">返回列表</a>` : ""}
  ${previousUrl ? `<a href="${previousUrl}">上一页</a>` : ""}
  ${nextUrl ? `<a href="${nextUrl}">下一页</a>` : ""}
</div>
<!-- hsm-local-project-toolbar:end -->`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

function injectBeforeClosingBody(html, injection) {
  const source = String(html || "");
  const bodyEndMatches = Array.from(source.matchAll(/<\/body\s*>/gi));
  const bodyEnd = bodyEndMatches.at(-1);
  if (!bodyEnd || bodyEnd.index == null) {
    return `${source}\n${injection}\n`;
  }
  return `${source.slice(0, bodyEnd.index)}${injection}\n${source.slice(bodyEnd.index)}`;
}

function toEditableRelativePath(relativePath) {
  const safeRelativePath = normalizeProjectRelativePath(relativePath);
  const extension = extname(safeRelativePath) || ".html";
  return `${safeRelativePath.slice(0, -extension.length)}.editable${extension}`;
}

function extractIframeSources(html, baseDir) {
  const iframeSources = [];
  const pattern = /<iframe\b[^>]*\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi;
  let match;
  while ((match = pattern.exec(String(html || "")))) {
    const rawSource = match[1] || match[2] || match[3] || "";
    const cleanSource = rawSource.split("#")[0].split("?")[0];
    if (!isHtmlFile(cleanSource) || /^(?:https?:)?\/\//i.test(cleanSource)) {
      continue;
    }
    const resolved = normalizeProjectRelativePath(posix.join(baseDir || "", cleanSource));
    iframeSources.push(resolved);
  }
  return Array.from(new Set(iframeSources));
}

function mergePageLists(primaryPages, fallbackPages) {
  const pages = new Set(primaryPages);
  for (const page of fallbackPages) {
    pages.add(page);
  }
  return Array.from(pages);
}

function compareProjectPages(left, right) {
  const leftNumber = parsePageNumber(left);
  const rightNumber = parsePageNumber(right);
  if (leftNumber != null && rightNumber != null && leftNumber !== rightNumber) {
    return leftNumber - rightNumber;
  }
  if (leftNumber != null && rightNumber == null) {
    return -1;
  }
  if (leftNumber == null && rightNumber != null) {
    return 1;
  }
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}

function parsePageNumber(relativePath) {
  const stem = basename(relativePath).replace(/\.[^.]+$/i, "");
  const match = stem.match(/^(?:p|page|slide|第)?\s*(\d+)(?:\s*页)?$/i);
  return match ? Number(match[1]) : null;
}

function makePageLabel(relativePath, index) {
  const pageNumber = parsePageNumber(relativePath);
  return pageNumber != null ? `第 ${pageNumber} 页` : `第 ${index + 1} 页`;
}

export function normalizeProjectRelativePath(entryPath) {
  const normalized = posix.normalize(String(entryPath || "").replace(/\\/g, "/"));
  if (!normalized || normalized === "." || normalized.startsWith("../") || normalized.includes("/../") || posix.isAbsolute(normalized)) {
    throw new Error(`Unsafe zip entry: ${entryPath}`);
  }
  return normalized;
}

function findProjectEntryHtml(files) {
  const htmlFiles = files.filter(isHtmlFile).sort((a, b) => a.localeCompare(b));
  return htmlFiles.find((file) => file.toLowerCase() === "index.html")
    || htmlFiles.find((file) => file.toLowerCase().endsWith("/index.html"))
    || htmlFiles[0]
    || "";
}

function findCommonProjectRoot(files) {
  const firstParts = files
    .map((file) => normalizeProjectRelativePath(file).split("/"))
    .filter((parts) => parts.length > 1)
    .map((parts) => parts[0]);
  if (!firstParts.length) {
    return "";
  }
  const [firstRoot] = firstParts;
  return firstParts.every((root) => root === firstRoot) ? firstRoot : "";
}

function classifyProjectFile(filePath) {
  const extension = extname(filePath).toLowerCase();
  if (extension === ".html" || extension === ".htm") return "html";
  if ([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".avif", ".bmp"].includes(extension)) return "image";
  if ([".mp4", ".webm", ".mov", ".m4v", ".ogv"].includes(extension)) return "video";
  return "other";
}

async function copyProjectResources({ sourceDir, outputDir, excludeRelativePath }) {
  const files = await listProjectFiles(sourceDir);
  for (const file of files) {
    if (file.relativePath === excludeRelativePath) {
      continue;
    }
    const outputPath = resolve(outputDir, ...file.relativePath.split("/"));
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, await readFile(file.path));
  }
}

async function listProjectFiles(directoryPath, baseDir = directoryPath) {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const fullPath = join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listProjectFiles(fullPath, baseDir));
    } else if (entry.isFile()) {
      files.push({
        path: fullPath,
        relativePath: relative(baseDir, fullPath).split(sep).join("/")
      });
    }
  }
  return files;
}

function isInsideDirectory(parentDir, childPath) {
  const relativePath = relative(resolve(parentDir), resolve(childPath));
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function makeUniqueArchiveName(fileName, usedNames) {
  if (!usedNames.has(fileName)) {
    usedNames.add(fileName);
    return fileName;
  }

  const extension = extname(fileName);
  const stem = extension ? fileName.slice(0, -extension.length) : fileName;
  let index = 2;
  let candidate = `${stem}-${index}${extension}`;
  while (usedNames.has(candidate)) {
    index += 1;
    candidate = `${stem}-${index}${extension}`;
  }
  usedNames.add(candidate);
  return candidate;
}
