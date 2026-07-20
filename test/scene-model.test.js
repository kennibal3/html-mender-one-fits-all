import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  SCENE_MANIFEST_VERSION,
  buildProjectSceneManifest
} from "../src/scene-model.js";

const testDirectory = dirname(fileURLToPath(import.meta.url));

function deepContentFixture(relativePath) {
  return readFileSync(join(testDirectory, "fixtures", "deep-content-v1", relativePath), "utf8");
}

function interactionManifest(interactions) {
  return `<script type="application/json" data-hsm-interaction-manifest="1">${JSON.stringify({
    schemaVersion: "1.3",
    interactions,
    sequences: []
  })}</script>`;
}

test("scene manifest creates stable page scenes", () => {
  const pages = [
    { id: "p001", label: "第 1 页", title: "首页", sourceRelativePath: "index.html" },
    { id: "p002", label: "第 2 页", title: "练习", sourceRelativePath: "lesson.html" }
  ];

  const manifest = buildProjectSceneManifest({
    pages,
    htmlByPageId: { p001: "<html><body>首页</body></html>", p002: "<html><body>练习</body></html>" }
  });

  assert.equal(manifest.schemaVersion, SCENE_MANIFEST_VERSION);
  assert.deepEqual(manifest.scenes, [
    {
      id: "scene:page:p001",
      type: "page",
      pageId: "p001",
      parentSceneId: null,
      title: "首页",
      sourceRelativePath: "index.html",
      entry: { type: "page" }
    },
    {
      id: "scene:page:p002",
      type: "page",
      pageId: "p002",
      parentSceneId: null,
      title: "练习",
      sourceRelativePath: "lesson.html",
      entry: { type: "page" }
    }
  ]);
});

test("page scenes prefer the lesson's visible heading over its technical file title", () => {
  const manifest = buildProjectSceneManifest({
    pages: [{
      id: "p001",
      label: "第 1 页",
      title: "technical-file-name.html",
      sourceRelativePath: "technical-file-name.html"
    }],
    htmlByPageId: {
      p001: "<!doctype html><html><body><h1><span>首页</span></h1></body></html>"
    }
  });

  assert.equal(manifest.scenes.find((scene) => scene.type === "page")?.title, "首页");
});

test("page scene titles ignore script strings and headings inside hidden content", () => {
  const manifest = buildProjectSceneManifest({
    pages: [{ id: "p001", label: "第 1 页", title: "index.html", sourceRelativePath: "index.html" }],
    htmlByPageId: {
      p001: `<!doctype html><html><body>
        <script>const fakeHeading = "<h1>脚本里的标题</h1>";</script>
        <section hidden><h1>隐藏内容标题</h1></section>
        <main><h2>课堂首页</h2></main>
      </body></html>`
    }
  });

  assert.equal(manifest.scenes.find((scene) => scene.type === "page")?.title, "课堂首页");
});

test("scene manifest nests modal scenes by live target containment", () => {
  const interactions = [
    {
      id: "open-course",
      name: "课程介绍",
      trigger: { event: "click", nodeId: "open-course-trigger" },
      action: { type: "openModal", targetId: "course-modal" }
    },
    {
      id: "open-quiz",
      name: "练习题",
      trigger: { event: "click", nodeId: "open-quiz-trigger" },
      action: { type: "openModal", targetId: "quiz-modal" }
    }
  ];
  const html = `<!doctype html><html><body>
    <button data-hsm-node-id="open-course-trigger">打开课程介绍</button>
    <section data-hsm-node-id="course-modal" hidden>
      <button data-hsm-node-id="open-quiz-trigger">开始练习</button>
      <section data-hsm-node-id="quiz-modal" hidden>题目</section>
    </section>
    ${interactionManifest(interactions)}
  </body></html>`;

  const manifest = buildProjectSceneManifest({
    pages: [{ id: "p001", label: "第 1 页", title: "首页", sourceRelativePath: "index.html" }],
    htmlByPageId: { p001: html }
  });

  assert.deepEqual(manifest.scenes.map((scene) => ({
    id: scene.id,
    type: scene.type,
    parentSceneId: scene.parentSceneId,
    entry: scene.entry
  })), [
    {
      id: "scene:page:p001",
      type: "page",
      parentSceneId: null,
      entry: { type: "page" }
    },
    {
      id: "scene:modal:p001:open-course",
      type: "modal",
      parentSceneId: "scene:page:p001",
      entry: {
        type: "interaction",
        interactionId: "open-course",
        triggerNodeId: "open-course-trigger",
        targetNodeId: "course-modal"
      }
    },
    {
      id: "scene:modal:p001:open-quiz",
      type: "modal",
      parentSceneId: "scene:modal:p001:open-course",
      entry: {
        type: "interaction",
        interactionId: "open-quiz",
        triggerNodeId: "open-quiz-trigger",
        targetNodeId: "quiz-modal"
      }
    }
  ]);
});

test("scene manifest ignores malformed manifests without losing page scenes", () => {
  const manifest = buildProjectSceneManifest({
    pages: [{ id: "p001", label: "第 1 页", sourceRelativePath: "index.html" }],
    htmlByPageId: {
      p001: '<html><body><script data-hsm-interaction-manifest="1">{broken</script></body></html>'
    }
  });

  assert.equal(manifest.scenes.length, 1);
  assert.equal(manifest.scenes[0].id, "scene:page:p001");
});

test("scene manifest breaks cyclic modal ancestry", () => {
  const interactions = [
    {
      id: "open-a",
      name: "弹窗 A",
      trigger: { event: "click", nodeId: "trigger-a" },
      action: { type: "openModal", targetId: "target-a" }
    },
    {
      id: "open-b",
      name: "弹窗 B",
      trigger: { event: "click", nodeId: "trigger-b" },
      action: { type: "openModal", targetId: "target-b" }
    }
  ];
  const html = `<!doctype html><html><body>
    <section data-hsm-node-id="target-a">
      <button data-hsm-node-id="trigger-b">打开 B</button>
      <section data-hsm-node-id="target-b">
        <button data-hsm-node-id="trigger-a">打开 A</button>
      </section>
    </section>
    ${interactionManifest(interactions)}
  </body></html>`;
  const manifest = buildProjectSceneManifest({
    pages: [{ id: "p001", label: "第 1 页", sourceRelativePath: "index.html" }],
    htmlByPageId: { p001: html }
  });
  const byId = new Map(manifest.scenes.map((scene) => [scene.id, scene]));

  for (const scene of manifest.scenes) {
    const visited = new Set([scene.id]);
    let parentSceneId = scene.parentSceneId;
    while (parentSceneId) {
      assert.equal(visited.has(parentSceneId), false, `场景父子关系不能形成循环：${scene.id}`);
      visited.add(parentSceneId);
      parentSceneId = byId.get(parentSceneId)?.parentSceneId || null;
    }
  }
});

test("static scan discovers nested hidden modal candidates with visible titles", () => {
  const html = deepContentFixture("g8-23-nested-modal/index.html");
  const options = {
    pages: [{ id: "p001", label: "第 1 页", title: "首页", sourceRelativePath: "index.html" }],
    htmlByPageId: { p001: html }
  };

  const firstManifest = buildProjectSceneManifest(options);
  const secondManifest = buildProjectSceneManifest(options);
  const staticScenes = firstManifest.scenes.filter((scene) => scene.entry.type === "static");

  assert.equal(staticScenes.length, 2);
  assert.deepEqual(staticScenes.map((scene) => scene.title), ["课程介绍", "任务详情"]);
  assert.equal(staticScenes[0].parentSceneId, "scene:page:p001");
  assert.equal(staticScenes[1].parentSceneId, staticScenes[0].id);
  assert.deepEqual(staticScenes.map((scene) => scene.discovery), [
    { source: "static-scan", confidence: "medium", status: "pending" },
    { source: "static-scan", confidence: "medium", status: "pending" }
  ]);
  assert.deepEqual(staticScenes.map((scene) => scene.entry.targetSelector), ["#intro", "#detail"]);
  assert.deepEqual(
    secondManifest.scenes.filter((scene) => scene.entry.type === "static").map((scene) => scene.id),
    staticScenes.map((scene) => scene.id),
    "同一份课件重复扫描必须得到稳定场景 ID"
  );
  assert.ok(staticScenes.every((scene) => /^scene:modal:p001:static:[a-f0-9]{12}$/.test(scene.id)));
});

test("static scan confirms semantic modals and ignores ordinary hidden animation", () => {
  const html = `<!doctype html><html><body>
    <p id="animation-tip" hidden>只是逐步出现的普通提示</p>
    <div id="course-modal" class="course-modal" role="dialog" hidden>
      <h2><span>课程</span> 介绍</h2>
      <p>这里是弹出内容。</p>
    </div>
  </body></html>`;
  const manifest = buildProjectSceneManifest({
    pages: [{ id: "p001", label: "第 1 页", sourceRelativePath: "index.html" }],
    htmlByPageId: { p001: html }
  });
  const staticScenes = manifest.scenes.filter((scene) => scene.entry.type === "static");

  assert.equal(staticScenes.length, 1);
  assert.equal(staticScenes[0].title, "课程 介绍");
  assert.equal(staticScenes[0].entry.targetSelector, "#course-modal");
  assert.deepEqual(staticScenes[0].discovery, {
    source: "static-scan",
    confidence: "high",
    status: "confirmed"
  });
  assert.equal(manifest.scenes.some((scene) => scene.title.includes("animation-tip")), false);
});

test("static scan does not duplicate a modal already declared by an interaction", () => {
  const interaction = {
    id: "open-course",
    name: "课程介绍",
    trigger: { event: "click", nodeId: "open-course-trigger" },
    action: { type: "openModal", targetId: "course-modal" }
  };
  const html = `<!doctype html><html><body>
    <button data-hsm-node-id="open-course-trigger">打开课程介绍</button>
    <section id="course-panel" class="modal" data-hsm-node-id="course-modal" hidden>
      <h2>课程介绍</h2>
    </section>
    ${interactionManifest([interaction])}
  </body></html>`;
  const manifest = buildProjectSceneManifest({
    pages: [{ id: "p001", label: "第 1 页", sourceRelativePath: "index.html" }],
    htmlByPageId: { p001: html }
  });

  assert.deepEqual(manifest.scenes.map((scene) => scene.id), [
    "scene:page:p001",
    "scene:modal:p001:open-course"
  ]);
});

test("static scan does not confuse data attributes with modal visibility attributes", () => {
  const html = `<!doctype html><html><body>
    <section data-id="ordinary-card" data-hidden="true" aria-labelledby="ordinary-title">
      <h2 id="ordinary-title">普通页面卡片</h2>
    </section>
  </body></html>`;
  const manifest = buildProjectSceneManifest({
    pages: [{ id: "p001", label: "第 1 页", sourceRelativePath: "index.html" }],
    htmlByPageId: { p001: html }
  });

  assert.deepEqual(manifest.scenes.map((scene) => scene.id), ["scene:page:p001"]);
});

test("unnamed interaction modals use a teacher-facing visible fallback title", () => {
  const interaction = {
    id: "open-untitled",
    trigger: { event: "click", nodeId: "open-trigger" },
    action: { type: "openModal", targetId: "untitled-modal" }
  };
  const html = `<!doctype html><html><body>
    <button data-hsm-node-id="open-trigger">打开内容</button>
    <section data-hsm-node-id="untitled-modal" hidden>内容</section>
    ${interactionManifest([interaction])}
  </body></html>`;
  const manifest = buildProjectSceneManifest({
    pages: [{ id: "p001", label: "第 1 页", sourceRelativePath: "index.html" }],
    htmlByPageId: { p001: html }
  });

  assert.equal(manifest.scenes.find((scene) => scene.type === "modal")?.title, "弹出内容");
});
