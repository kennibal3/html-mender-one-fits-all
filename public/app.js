const RECENT_TASK_LIMIT = 5;

const uploadForm = document.querySelector("#upload-form");
const taskNameInput = document.querySelector("#task-name");
const assetInput = document.querySelector("#asset-input");
const dropZone = document.querySelector("#drop-zone");
const statusEl = document.querySelector("#status");
const uploadButton = document.querySelector("#upload-button");

const projectsList = document.querySelector("#recent-tasks");
const showAllTasksButton = document.querySelector("#show-all-tasks");
const backToAllButton = document.querySelector("#back-to-all");
const refreshButton = document.querySelector("#refresh-button");

let projects = [];
let showAllRecent = false;
let selectedProjectId = new URLSearchParams(window.location.search).get("project") || "";
let draggedPage = null;
let pointerDraggedPage = null;
let mouseDraggedPage = null;

uploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const files = Array.from(assetInput.files || []);
  const taskName = taskNameInput.value.trim();
  if (!taskName) {
    setStatus(statusEl, "请先填写任务名称。");
    taskNameInput.focus();
    return;
  }
  if (!files.length) {
    setStatus(statusEl, "请选择 HTML 文件或 ZIP 项目包。");
    return;
  }

  const hasZip = files.some(isZipUpload);
  if (hasZip && files.length > 1) {
    setStatus(statusEl, "ZIP 项目包请一次只上传一个；多个页面请直接选择多个 HTML 文件。");
    return;
  }

  uploadButton.disabled = true;
  setStatus(statusEl, hasZip ? "正在解压 ZIP 并建立逐页版本..." : `正在创建任务并处理 ${files.length} 个文件...`);

  try {
    const payload = hasZip
      ? await uploadZipTask({ taskName, file: files[0] })
      : await uploadHtmlTask({ taskName, files });
    projects = mergeProjects(projects, [payload.project]);
    openTask(payload.project.id);
    const rejected = payload.rejected?.length ? `，${payload.rejected.length} 个文件未识别` : "";
    setStatus(statusEl, `任务“${payload.project.name}”已创建，共 ${payload.project.pageCount} 页${rejected}。`);
    assetInput.value = "";
    taskNameInput.value = "";
  } catch (error) {
    setStatus(statusEl, error.message || "任务创建失败。");
  } finally {
    uploadButton.disabled = false;
  }
});

bindDropZone({
  dropZone,
  input: assetInput,
  statusElement: statusEl,
  selectedMessage: (files) => {
    const count = files.length;
    return files.some(isZipUpload)
      ? `已选择 ZIP 项目包：${files[0]?.name || "未命名文件"}`
      : `已选择 ${count} 个待识别文件。`;
  },
  emptyMessage: "等待文件上传"
});

refreshButton.addEventListener("click", loadProjects);
showAllTasksButton.addEventListener("click", () => {
  showAllRecent = !showAllRecent;
  renderProjects();
});
backToAllButton.addEventListener("click", () => openTask(""));
window.addEventListener("popstate", () => {
  selectedProjectId = new URLSearchParams(window.location.search).get("project") || "";
  renderProjects();
});
window.addEventListener("storage", (event) => {
  if (event.key === "hsm-project-updated") loadProjects();
});
window.addEventListener("focus", loadProjects);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) loadProjects();
});

projectsList.addEventListener("click", async (event) => {
  const openTrigger = event.target.closest("[data-open-task]");
  if (openTrigger) {
    openTask(openTrigger.dataset.openTask);
    return;
  }

  const deleteTrigger = event.target.closest("[data-delete-task]");
  if (deleteTrigger) {
    await deleteTask(deleteTrigger.dataset.deleteTask, deleteTrigger);
    return;
  }

  const exportTrigger = event.target.closest("[data-export-task]");
  if (exportTrigger) {
    const project = projects.find((item) => item.id === exportTrigger.dataset.exportTask);
    if (project) await exportTask(project, exportTrigger);
    return;
  }

  const createPageTrigger = event.target.closest("[data-create-page]");
  if (createPageTrigger) {
    await createPage(createPageTrigger.dataset.projectId, createPageTrigger.dataset.afterPageId || "", createPageTrigger);
    return;
  }

  const duplicatePageTrigger = event.target.closest("[data-duplicate-page]");
  if (duplicatePageTrigger) {
    await duplicatePage(duplicatePageTrigger.dataset.projectId, duplicatePageTrigger.dataset.duplicatePage, duplicatePageTrigger);
    return;
  }

  const deletePageTrigger = event.target.closest("[data-delete-page]");
  if (deletePageTrigger) {
    await deletePage(deletePageTrigger.dataset.projectId, deletePageTrigger.dataset.deletePage, deletePageTrigger);
    return;
  }

  const restorePageTrigger = event.target.closest("[data-restore-page]");
  if (restorePageTrigger) {
    await restoreDeletedPage(restorePageTrigger.dataset.projectId, restorePageTrigger.dataset.restorePage, restorePageTrigger);
    return;
  }

  const movePageTrigger = event.target.closest("[data-move-page]");
  if (movePageTrigger) {
    await movePage(
      movePageTrigger.dataset.projectId,
      movePageTrigger.dataset.pageId,
      movePageTrigger.dataset.movePage,
      movePageTrigger
    );
    return;
  }

  const restoreTrigger = event.target.closest("[data-restore-version]");
  if (restoreTrigger) {
    if (!window.confirm(`确定恢复 ${restoreTrigger.dataset.versionId} 吗？恢复后会生成一个新版本。`)) return;
    restoreTrigger.disabled = true;
    try {
      const payload = await requestJson(
        `/api/projects/${encodeURIComponent(restoreTrigger.dataset.projectId)}/pages/${encodeURIComponent(restoreTrigger.dataset.pageId)}/restore`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ versionKey: restoreTrigger.dataset.restoreVersion })
        }
      );
      projects = mergeProjects(projects, [payload.project]);
      renderProjects();
      setStatus(statusEl, `${payload.version.pageLabel || "页面"} ${payload.version.id} 已成功恢复并保存。`);
    } catch (error) {
      setStatus(statusEl, error.message || "版本恢复失败。");
    } finally {
      restoreTrigger.disabled = false;
    }
  }
});

projectsList.addEventListener("dragstart", (event) => {
  if (pointerDraggedPage) {
    event.preventDefault();
    return;
  }
  const handle = event.target.closest("[data-page-drag-handle]");
  if (!handle) return;
  draggedPage = {
    projectId: handle.dataset.projectId,
    pageId: handle.dataset.pageId
  };
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", draggedPage.pageId);
  handle.closest("[data-page-card]")?.classList.add("is-dragging");
});

projectsList.addEventListener("dragover", (event) => {
  const target = event.target.closest("[data-page-card]");
  if (!target || !draggedPage || target.dataset.projectId !== draggedPage.projectId) return;
  event.preventDefault();
  const rect = target.getBoundingClientRect();
  const after = event.clientY > rect.top + rect.height / 2;
  clearPageDropIndicators();
  target.classList.add(after ? "drop-after" : "drop-before");
});

projectsList.addEventListener("drop", async (event) => {
  const target = event.target.closest("[data-page-card]");
  if (!target || !draggedPage || target.dataset.projectId !== draggedPage.projectId) return;
  event.preventDefault();
  const rect = target.getBoundingClientRect();
  const after = event.clientY > rect.top + rect.height / 2;
  const current = draggedPage;
  draggedPage = null;
  clearPageDropIndicators();
  await reorderPageByDrop(current.projectId, current.pageId, target.dataset.pageId, after);
});

projectsList.addEventListener("dragend", () => {
  draggedPage = null;
  clearPageDropIndicators();
});

projectsList.addEventListener("pointerdown", (event) => {
  const handle = event.target.closest("[data-page-drag-handle]");
  const card = handle?.closest("[data-page-card]");
  if (!handle || !card || event.pointerType === "mouse") return;
  pointerDraggedPage = {
    projectId: card.dataset.projectId,
    pageId: card.dataset.pageId,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    moved: false,
    targetPageId: "",
    after: false
  };
  handle.setPointerCapture(event.pointerId);
  card.classList.add("is-dragging");
  event.preventDefault();
});

projectsList.addEventListener("pointermove", (event) => {
  const current = pointerDraggedPage;
  if (!current || current.pointerId !== event.pointerId) return;
  if (!current.moved && Math.hypot(event.clientX - current.startX, event.clientY - current.startY) < 6) return;
  current.moved = true;
  const target = document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-page-card]");
  clearPageDropIndicators();
  projectsList.querySelector(`[data-page-card][data-page-id="${CSS.escape(current.pageId)}"]`)?.classList.add("is-dragging");
  if (!target || target.dataset.projectId !== current.projectId) {
    current.targetPageId = "";
    return;
  }
  const rect = target.getBoundingClientRect();
  current.targetPageId = target.dataset.pageId;
  current.after = event.clientY > rect.top + rect.height / 2;
  target.classList.add(current.after ? "drop-after" : "drop-before");
  event.preventDefault();
});

projectsList.addEventListener("pointerup", finishPointerPageDrag);
projectsList.addEventListener("pointercancel", (event) => finishPointerPageDrag(event, true));

async function finishPointerPageDrag(event, canceled = false) {
  const current = pointerDraggedPage;
  if (!current || current.pointerId !== event.pointerId) return;
  pointerDraggedPage = null;
  const handle = event.target.closest?.("[data-page-drag-handle]");
  if (handle?.hasPointerCapture?.(event.pointerId)) handle.releasePointerCapture(event.pointerId);
  clearPageDropIndicators();
  if (canceled || !current.moved || !current.targetPageId || current.targetPageId === current.pageId) return;
  await reorderPageByDrop(current.projectId, current.pageId, current.targetPageId, current.after);
}

projectsList.addEventListener("mousedown", (event) => {
  const handle = event.target.closest("[data-page-drag-handle]");
  const card = handle?.closest("[data-page-card]");
  if (!handle || !card || event.button !== 0) return;
  mouseDraggedPage = {
    projectId: card.dataset.projectId,
    pageId: card.dataset.pageId,
    startX: event.clientX,
    startY: event.clientY,
    moved: false,
    targetPageId: "",
    after: false
  };
  card.classList.add("is-dragging");
  event.preventDefault();
});

document.addEventListener("mousemove", (event) => {
  const current = mouseDraggedPage;
  if (!current) return;
  if (!current.moved && Math.hypot(event.clientX - current.startX, event.clientY - current.startY) < 6) return;
  current.moved = true;
  const target = document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-page-card]");
  clearPageDropIndicators();
  projectsList.querySelector(`[data-page-card][data-page-id="${CSS.escape(current.pageId)}"]`)?.classList.add("is-dragging");
  if (!target || target.dataset.projectId !== current.projectId) {
    current.targetPageId = "";
    return;
  }
  const rect = target.getBoundingClientRect();
  current.targetPageId = target.dataset.pageId;
  current.after = event.clientY > rect.top + rect.height / 2;
  target.classList.add(current.after ? "drop-after" : "drop-before");
  event.preventDefault();
});

document.addEventListener("mouseup", async (event) => {
  const current = mouseDraggedPage;
  if (!current || event.button !== 0) return;
  mouseDraggedPage = null;
  clearPageDropIndicators();
  if (!current.moved || !current.targetPageId || current.targetPageId === current.pageId) return;
  await reorderPageByDrop(current.projectId, current.pageId, current.targetPageId, current.after);
});

async function uploadHtmlTask({ taskName, files }) {
  const body = new FormData();
  body.append("taskName", taskName);
  for (const file of files) body.append("files", file);
  return requestJson("/api/upload", { method: "POST", body });
}

async function uploadZipTask({ taskName, file }) {
  const body = new FormData();
  body.append("taskName", taskName);
  body.append("project", file);
  return requestJson("/api/projects/upload", { method: "POST", body });
}

async function loadProjects() {
  try {
    const payload = await requestJson("/api/projects");
    projects = payload.projects || [];
    renderProjects();
  } catch (error) {
    setStatus(statusEl, error.message || "读取任务列表失败。");
  }
}

function renderProjects() {
  backToAllButton.hidden = !selectedProjectId;
  showAllTasksButton.hidden = Boolean(selectedProjectId) || projects.length <= RECENT_TASK_LIMIT;
  showAllTasksButton.textContent = showAllRecent ? "收起" : "查看更多";
  const visible = selectedProjectId
    ? projects.filter((project) => project.id === selectedProjectId)
    : projects.slice(0, showAllRecent ? projects.length : RECENT_TASK_LIMIT);
  if (!visible.length) {
    projectsList.innerHTML = selectedProjectId
      ? '<div class="empty-state">没有找到这个任务，可能已被移动或删除。</div>'
      : '<div class="empty-state">还没有任务。请先在左侧创建一个命名任务。</div>';
    return;
  }
  projectsList.innerHTML = visible.map((project) => renderProject(project, project.id === selectedProjectId)).join("");
}

function renderProject(project, expanded) {
  const updatedAt = project.updatedAt || project.lastSavedAt || project.createdAt;
  const typeLabel = project.kind === "zip" ? "ZIP 项目" : project.pageCount > 1 ? "多页 HTML" : "单页 HTML";
  const actions = project.status === "ready"
    ? `<div class="job-actions">
        ${expanded ? "" : `<button type="button" data-open-task="${project.id}">打开任务</button>`}
        <button type="button" data-export-task="${project.id}">完整导出</button>
        <button class="danger" type="button" data-delete-task="${project.id}">删除存档</button>
      </div>`
    : `<div class="job-actions">
        <button class="danger" type="button" data-delete-task="${project.id}">删除记录</button>
      </div>`;
  return `<article class="job task-card ${expanded ? "is-expanded" : ""}">
    <div class="job-title-row">
      <div>
        <p class="job-name">${escapeHtml(project.name || project.originalName || "未命名任务")}</p>
        <span class="task-kind">${typeLabel}</span>
      </div>
      <span class="badge ${project.status}">${project.status === "ready" ? "已保存" : "失败"}</span>
    </div>
    <p class="job-meta">${project.pageCount || 0} 页 · 最近保存 ${formatDate(updatedAt)} · 共 ${project.versionCount || 0} 个页面版本</p>
    ${project.error ? `<p class="job-error">${escapeHtml(project.error)}</p>` : ""}
    ${actions}
    ${expanded ? renderProjectPages(project) : ""}
  </article>`;
}

function renderProjectPages(project) {
  const pages = Array.isArray(project.pages) ? project.pages : [];
  const deletedPages = Array.isArray(project.deletedPages) ? project.deletedPages : [];
  return `<div class="page-list" aria-label="任务页面列表">
    <div class="page-list-head">
      <div><span>任务页面</span><small>${pages.length} 页</small></div>
      <div class="page-management-actions">
        <button type="button" data-create-page data-project-id="${project.id}">+ 新建空白页</button>
        <details class="page-trash">
          <summary>回收站（${deletedPages.length}）</summary>
          ${renderDeletedPages(project, deletedPages)}
        </details>
      </div>
    </div>
    <div class="page-grid" data-page-order="${pages.map((page) => escapeHtml(page.id)).join(",")}">
      ${pages.map((page, index) => `<article class="page-card" data-page-card data-project-id="${project.id}" data-page-id="${escapeHtml(page.id)}">
        <div class="page-card-main">
          <button class="page-drag-handle" type="button" data-page-drag-handle data-project-id="${project.id}" data-page-id="${escapeHtml(page.id)}" title="拖动调整页面顺序" aria-label="拖动${escapeHtml(page.label || `第 ${index + 1} 页`)}">⋮⋮</button>
          <div>
          <strong>${escapeHtml(page.label || `第 ${index + 1} 页`)}</strong>
          <small>${escapeHtml(page.title || page.sourceRelativePath || "")}</small>
          <span class="page-save-meta">当前 ${escapeHtml(page.latestVersionId || "v001")} · ${formatDate(page.lastSavedAt)}</span>
          </div>
        </div>
        <div class="page-actions">
          <a href="${page.editUrl}">编辑</a>
          <a href="${page.viewUrl}">预览</a>
          <button type="button" data-move-page="up" data-project-id="${project.id}" data-page-id="${escapeHtml(page.id)}" ${index === 0 ? "disabled" : ""}>上移</button>
          <button type="button" data-move-page="down" data-project-id="${project.id}" data-page-id="${escapeHtml(page.id)}" ${index === pages.length - 1 ? "disabled" : ""}>下移</button>
          <button type="button" data-create-page data-project-id="${project.id}" data-after-page-id="${escapeHtml(page.id)}">在此页后新增</button>
          <button type="button" data-duplicate-page="${escapeHtml(page.id)}" data-project-id="${project.id}">复制</button>
          <button class="danger subtle" type="button" data-delete-page="${escapeHtml(page.id)}" data-project-id="${project.id}" ${pages.length <= 1 ? "disabled" : ""}>移入回收站</button>
        </div>
        ${renderPageVersions(project, page)}
      </article>`).join("")}
    </div>
  </div>`;
}

function renderDeletedPages(project, deletedPages) {
  if (!deletedPages.length) return '<p class="empty-version">回收站为空。</p>';
  return `<div class="deleted-page-list">${deletedPages.map((page) => `<div class="deleted-page-row">
    <span><strong>${escapeHtml(page.labelAtDeletion || page.label || "已删除页面")}</strong><small>${escapeHtml(page.title || page.sourceRelativePath || "")}</small></span>
    <button type="button" data-restore-page="${escapeHtml(page.id)}" data-project-id="${project.id}">恢复</button>
  </div>`).join("")}</div>`;
}

async function createPage(projectId, afterPageId, button) {
  await runPageOperation(button, async () => {
    const payload = await requestJson(`/api/projects/${encodeURIComponent(projectId)}/pages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ afterPageId })
    });
    syncProjectAfterPageOperation(payload.project);
    setStatus(statusEl, `${payload.page.label}已创建，可以立即打开编辑。`);
  });
}

async function duplicatePage(projectId, pageId, button) {
  await runPageOperation(button, async () => {
    const payload = await requestJson(`/api/projects/${encodeURIComponent(projectId)}/pages/${encodeURIComponent(pageId)}/duplicate`, {
      method: "POST"
    });
    syncProjectAfterPageOperation(payload.project);
    setStatus(statusEl, `${payload.page.label}已复制，并建立独立 v001。`);
  });
}

async function deletePage(projectId, pageId, button) {
  const project = projects.find((item) => item.id === projectId);
  const page = project?.pages?.find((item) => item.id === pageId);
  if (!window.confirm(`确定把“${page?.label || "这个页面"}”移入回收站吗？页面源码和历史版本会保留。`)) return;
  await runPageOperation(button, async () => {
    const baseUrl = `/api/projects/${encodeURIComponent(projectId)}/pages/${encodeURIComponent(pageId)}`;
    let response = await fetch(baseUrl, { method: "DELETE" });
    let payload = await response.json();
    if (response.status === 409) {
      const references = (payload.references || []).map((item) => item.pageLabel || item.interactionName).filter(Boolean).join("、");
      const warning = `${payload.error}${references ? `\n引用位置：${references}` : ""}\n仍要移入回收站吗？`;
      if (!window.confirm(warning)) return;
      response = await fetch(`${baseUrl}?force=true`, { method: "DELETE" });
      payload = await response.json();
    }
    if (!response.ok) throw new Error(payload.error || "页面删除失败");
    syncProjectAfterPageOperation(payload.project);
    setStatus(statusEl, "页面已移入回收站，其他页面已重新编号。" );
  });
}

async function restoreDeletedPage(projectId, pageId, button) {
  await runPageOperation(button, async () => {
    const payload = await requestJson(`/api/projects/${encodeURIComponent(projectId)}/deleted-pages/${encodeURIComponent(pageId)}/restore`, {
      method: "POST"
    });
    syncProjectAfterPageOperation(payload.project);
    setStatus(statusEl, `${payload.page.label}已从回收站恢复。`);
  });
}

async function movePage(projectId, pageId, direction, button) {
  const project = projects.find((item) => item.id === projectId);
  const pageIds = (project?.pages || []).map((page) => page.id);
  const index = pageIds.indexOf(pageId);
  const nextIndex = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || nextIndex < 0 || nextIndex >= pageIds.length) return;
  [pageIds[index], pageIds[nextIndex]] = [pageIds[nextIndex], pageIds[index]];
  await savePageOrder(projectId, pageIds, button);
}

async function reorderPageByDrop(projectId, draggedPageId, targetPageId, after) {
  if (draggedPageId === targetPageId) return;
  const project = projects.find((item) => item.id === projectId);
  const pageIds = (project?.pages || []).map((page) => page.id).filter((id) => id !== draggedPageId);
  const targetIndex = pageIds.indexOf(targetPageId);
  if (targetIndex < 0) return;
  pageIds.splice(targetIndex + (after ? 1 : 0), 0, draggedPageId);
  await savePageOrder(projectId, pageIds);
}

async function savePageOrder(projectId, pageIds, button = null) {
  await runPageOperation(button, async () => {
    const payload = await requestJson(`/api/projects/${encodeURIComponent(projectId)}/pages/order`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pageIds })
    });
    syncProjectAfterPageOperation(payload.project);
    setStatus(statusEl, "页面顺序已保存，并已重新编号。" );
  });
}

async function runPageOperation(button, operation) {
  if (button) button.disabled = true;
  try {
    await operation();
  } catch (error) {
    setStatus(statusEl, error.message || "页面操作失败。" );
  } finally {
    if (button?.isConnected) button.disabled = false;
  }
}

function syncProjectAfterPageOperation(project) {
  projects = mergeProjects(projects, [project]);
  renderProjects();
}

function clearPageDropIndicators() {
  for (const card of projectsList.querySelectorAll("[data-page-card]")) {
    card.classList.remove("is-dragging", "drop-before", "drop-after");
  }
}

function renderPageVersions(project, page) {
  const versions = Array.isArray(page.versions) ? [...page.versions].reverse() : [];
  if (!versions.length) return '<p class="empty-version">尚无版本记录。</p>';
  return `<details class="page-versions">
    <summary>版本记录（${versions.length}）</summary>
    <div class="version-list">
      ${versions.map((version) => `<div class="version-row">
        <span class="version-code">${escapeHtml(version.id)}</span>
        <span class="version-time">${formatDate(version.createdAt)}</span>
        <span class="version-note">${escapeHtml(version.note || "手动保存")}</span>
        <a href="${version.viewUrl}">预览</a>
        <a href="${version.downloadUrl}">下载 HTML</a>
        <button type="button"
          data-restore-version="${escapeHtml(version.key || version.id)}"
          data-version-id="${escapeHtml(version.id)}"
          data-project-id="${project.id}"
          data-page-id="${page.id}">恢复</button>
      </div>`).join("")}
    </div>
  </details>`;
}

async function deleteTask(projectId, button) {
  const project = projects.find((item) => item.id === projectId);
  const name = project?.name || project?.originalName || "这个任务";
  if (!window.confirm(`确定删除“${name}”的编辑存档吗？这只会删除修改记录、版本和可编辑副本，原始上传文件会保留。`)) {
    return;
  }
  button.disabled = true;
  try {
    await requestJson(`/api/projects/${encodeURIComponent(projectId)}`, { method: "DELETE" });
    projects = projects.filter((item) => item.id !== projectId);
    if (selectedProjectId === projectId) {
      selectedProjectId = "";
      window.history.pushState({}, "", "/");
    }
    renderProjects();
    setStatus(statusEl, "编辑存档已删除，原始文件已保留。");
  } catch (error) {
    setStatus(statusEl, error.message || "删除失败。");
  } finally {
    button.disabled = false;
  }
}

async function exportTask(project, button) {
  button.disabled = true;
  const extension = project.kind === "html" && project.pageCount === 1 ? "html" : "zip";
  const suggestedName = `${project.downloadName || "html-mender-task"}.${extension}`;
  const url = `/api/projects/${encodeURIComponent(project.id)}/export`;
  try {
    if (window.htmlMenderDesktop?.saveExport) {
      const result = await window.htmlMenderDesktop.saveExport({ url, suggestedName });
      if (!result?.canceled) setStatus(statusEl, `已导出到：${result.filePath}`);
    } else {
      window.location.href = url;
    }
  } catch (error) {
    setStatus(statusEl, error.message || "导出失败。");
  } finally {
    button.disabled = false;
  }
}

function openTask(projectId) {
  selectedProjectId = projectId || "";
  const url = selectedProjectId ? `/?project=${encodeURIComponent(selectedProjectId)}` : "/";
  window.history.pushState({}, "", url);
  renderProjects();
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "请求失败");
  return payload;
}

function bindDropZone({ dropZone, input, statusElement, selectedMessage, emptyMessage }) {
  for (const eventName of ["dragenter", "dragover"]) {
    dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropZone.classList.add("is-dragging");
    });
  }
  for (const eventName of ["dragleave", "drop"]) {
    dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropZone.classList.remove("is-dragging");
    });
  }
  dropZone.addEventListener("drop", (event) => {
    input.files = event.dataTransfer.files;
    const files = Array.from(event.dataTransfer.files || []);
    setStatus(statusElement, files.length ? selectedMessage(files) : emptyMessage);
  });
  input.addEventListener("change", () => {
    const files = Array.from(input.files || []);
    setStatus(statusElement, files.length ? selectedMessage(files) : emptyMessage);
  });
}

function isZipUpload(file) {
  return /\.zip$/i.test(file?.name || "") || /(?:^|\/)zip$/i.test(file?.type || "");
}

function mergeProjects(current, incoming) {
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) byId.set(item.id, item);
  return Array.from(byId.values()).sort((a, b) =>
    String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt))
  );
}

function setStatus(element, message) {
  element.textContent = message;
}

function formatDate(value) {
  return value ? new Date(value).toLocaleString() : "尚未保存";
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

loadProjects();
