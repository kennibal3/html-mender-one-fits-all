import assert from "node:assert/strict";
import test from "node:test";
import {
  SCENE_MANIFEST_VERSION,
  buildProjectSceneManifest
} from "../src/scene-model.js";

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
