export const SCENE_MANIFEST_VERSION = "1.0";

const INTERACTION_MANIFEST_PATTERN = /<script\b[^>]*data-hsm-interaction-manifest[^>]*>([\s\S]*?)<\/script\s*>/gi;
const NODE_ATTRIBUTE_PATTERN = /\bdata-hsm-node-id\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;
const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"
]);

function interactionManifestEntries(html) {
  const interactions = [];
  for (const match of String(html || "").matchAll(INTERACTION_MANIFEST_PATTERN)) {
    try {
      const manifest = JSON.parse(match[1] || "{}");
      if (Array.isArray(manifest.interactions)) {
        interactions.push(...manifest.interactions);
      }
    } catch (_error) {
      // Invalid imported manifests must not hide the page itself from the scene tree.
    }
  }
  return interactions;
}

function nodeIdFromTag(tag) {
  const match = String(tag || "").match(NODE_ATTRIBUTE_PATTERN);
  return String(match?.[1] || match?.[2] || match?.[3] || "");
}

function nodeParentMap(html) {
  const parents = new Map();
  const stack = [];
  const tagPattern = /<!--[\s\S]*?-->|<![^>]*>|<\/?[a-zA-Z][^>]*>/g;
  for (const match of String(html || "").matchAll(tagPattern)) {
    const tag = match[0];
    const closeMatch = tag.match(/^<\s*\/\s*([^\s>]+)/);
    if (closeMatch) {
      const closingName = closeMatch[1].toLowerCase();
      const matchingIndex = stack.map((entry) => entry.name).lastIndexOf(closingName);
      if (matchingIndex >= 0) {
        stack.length = matchingIndex;
      }
      continue;
    }
    if (/^\s*<!/.test(tag)) {
      continue;
    }
    const openMatch = tag.match(/^<\s*([^\s/>]+)/);
    if (!openMatch) {
      continue;
    }
    const name = openMatch[1].toLowerCase();
    const nodeId = nodeIdFromTag(tag);
    if (nodeId && !parents.has(nodeId)) {
      const parentNode = stack.findLast((entry) => entry.nodeId);
      parents.set(nodeId, parentNode?.nodeId || "");
    }
    if (!VOID_ELEMENTS.has(name) && !/\/\s*>$/.test(tag)) {
      stack.push({ name, nodeId });
    }
  }
  return parents;
}

function ancestorDistance(parents, nodeId, ancestorId) {
  let current = String(nodeId || "");
  let distance = 0;
  const visited = new Set();
  while (current && !visited.has(current)) {
    if (current === ancestorId) {
      return distance;
    }
    visited.add(current);
    current = parents.get(current) || "";
    distance += 1;
  }
  return -1;
}

function pageScene(page) {
  return {
    id: `scene:page:${page.id}`,
    type: "page",
    pageId: String(page.id),
    parentSceneId: null,
    title: String(page.title || page.label || page.sourceRelativePath || page.id),
    sourceRelativePath: String(page.sourceRelativePath || ""),
    entry: { type: "page" }
  };
}

function modalScenes(page, html) {
  const pageSceneId = `scene:page:${page.id}`;
  const parents = nodeParentMap(html);
  const interactions = interactionManifestEntries(html)
    .filter((interaction) =>
      interaction?.id &&
      interaction?.trigger?.nodeId &&
      interaction?.action?.type === "openModal" &&
      interaction?.action?.targetId
    );
  const sceneIdByInteractionId = new Map(interactions.map((interaction) => [
    String(interaction.id),
    `scene:modal:${page.id}:${interaction.id}`
  ]));

  const scenes = interactions.map((interaction) => {
    const triggerNodeId = String(interaction.trigger.nodeId);
    const possibleParents = interactions
      .filter((candidate) => candidate !== interaction)
      .map((candidate) => ({
        interaction: candidate,
        distance: ancestorDistance(parents, triggerNodeId, String(candidate.action.targetId))
      }))
      .filter((candidate) => candidate.distance >= 0)
      .sort((a, b) => a.distance - b.distance);
    const parentInteraction = possibleParents[0]?.interaction;
    return {
      id: sceneIdByInteractionId.get(String(interaction.id)),
      type: "modal",
      pageId: String(page.id),
      parentSceneId: parentInteraction
        ? sceneIdByInteractionId.get(String(parentInteraction.id))
        : pageSceneId,
      title: String(interaction.name || "弹窗场景"),
      sourceRelativePath: String(page.sourceRelativePath || ""),
      entry: {
        type: "interaction",
        interactionId: String(interaction.id),
        triggerNodeId,
        targetNodeId: String(interaction.action.targetId)
      }
    };
  });
  const sceneById = new Map(scenes.map((scene) => [scene.id, scene]));
  for (const scene of scenes) {
    const visited = new Set([scene.id]);
    let parentSceneId = scene.parentSceneId;
    while (parentSceneId && parentSceneId !== pageSceneId) {
      if (visited.has(parentSceneId)) {
        scene.parentSceneId = pageSceneId;
        break;
      }
      visited.add(parentSceneId);
      parentSceneId = sceneById.get(parentSceneId)?.parentSceneId || pageSceneId;
    }
  }
  return scenes;
}

export function buildProjectSceneManifest({ pages = [], htmlByPageId = {} } = {}) {
  const scenes = [];
  for (const page of pages) {
    if (!page?.id) {
      continue;
    }
    scenes.push(pageScene(page));
    scenes.push(...modalScenes(page, htmlByPageId[page.id] || ""));
  }
  return {
    schemaVersion: SCENE_MANIFEST_VERSION,
    scenes
  };
}
