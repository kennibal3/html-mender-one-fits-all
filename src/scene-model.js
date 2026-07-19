import { createHash } from "node:crypto";

export const SCENE_MANIFEST_VERSION = "1.0";

const INTERACTION_MANIFEST_PATTERN = /<script\b[^>]*data-hsm-interaction-manifest[^>]*>([\s\S]*?)<\/script\s*>/gi;
const NODE_ATTRIBUTE_PATTERN = /\bdata-hsm-node-id\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;
const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"
]);
const MODAL_CONTAINER_ELEMENTS = new Set(["aside", "article", "dialog", "div", "section"]);
const RAW_TEXT_ELEMENTS = new Set(["script", "style"]);

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

function escapePattern(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function attributeValue(tag, name) {
  const pattern = new RegExp(`(?:^|\\s)${escapePattern(name)}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const match = String(tag || "").match(pattern);
  return String(match?.[1] || match?.[2] || match?.[3] || "");
}

function hasAttribute(tag, name) {
  return new RegExp(`(?:^|\\s)${escapePattern(name)}(?:\\s*=|[\\s>])`, "i").test(String(tag || ""));
}

function htmlElementTree(html) {
  const source = String(html || "");
  const elements = [];
  const stack = [];
  const tagPattern = /<!--[\s\S]*?-->|<![^>]*>|<\/?[a-zA-Z][^>]*>/g;
  for (const match of source.matchAll(tagPattern)) {
    const tag = match[0];
    const rawTextElement = stack.at(-1);
    if (rawTextElement && RAW_TEXT_ELEMENTS.has(rawTextElement.name)) {
      const rawTextClose = new RegExp(`^<\\s*\\/\\s*${escapePattern(rawTextElement.name)}\\s*>`, "i");
      if (!rawTextClose.test(tag)) {
        continue;
      }
    }
    const closeMatch = tag.match(/^<\s*\/\s*([^\s>]+)/);
    if (closeMatch) {
      const closingName = closeMatch[1].toLowerCase();
      const matchingIndex = stack.map((entry) => entry.name).lastIndexOf(closingName);
      if (matchingIndex >= 0) {
        const elementIndex = stack[matchingIndex].elementIndex;
        elements[elementIndex].contentEnd = match.index;
        elements[elementIndex].end = match.index + tag.length;
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
    const element = {
      name,
      tag,
      start: match.index,
      contentStart: match.index + tag.length,
      contentEnd: source.length,
      end: source.length,
      parentIndex: stack.at(-1)?.elementIndex ?? null
    };
    const elementIndex = elements.push(element) - 1;
    if (VOID_ELEMENTS.has(name) || /\/\s*>$/.test(tag)) {
      element.contentEnd = element.contentStart;
      element.end = element.contentStart;
    } else {
      stack.push({ name, elementIndex });
    }
  }
  return { source, elements };
}

function decodeTextEntities(value) {
  return String(value || "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function visibleText(html) {
  return decodeTextEntities(String(html || "")
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, " ")
    .replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function visibleModalTitle(source, element) {
  const content = source.slice(element.contentStart, element.contentEnd);
  const heading = content.match(/<h([1-4])\b[^>]*>([\s\S]*?)<\/h\1\s*>/i);
  const title = visibleText(heading?.[2] || "");
  return title || "弹出内容";
}

function modalCandidate(element, source) {
  if (!MODAL_CONTAINER_ELEMENTS.has(element.name)) {
    return null;
  }
  const id = attributeValue(element.tag, "id");
  const className = attributeValue(element.tag, "class");
  const role = attributeValue(element.tag, "role").toLowerCase();
  const ariaModal = attributeValue(element.tag, "aria-modal").toLowerCase();
  const style = attributeValue(element.tag, "style");
  const semanticText = `${id} ${className}`;
  const explicitSemantic = element.name === "dialog"
    || role === "dialog"
    || role === "alertdialog"
    || ariaModal === "true"
    || /(?:^|[\s_-])(?:modal|popup|dialog)(?:$|[\s_-])/i.test(semanticText);
  const overlaySemantic = /(?:^|[\s_-])overlay(?:$|[\s_-])/i.test(semanticText);
  const hidden = hasAttribute(element.tag, "hidden")
    || attributeValue(element.tag, "aria-hidden").toLowerCase() === "true"
    || /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(style)
    || (element.name === "dialog" && !hasAttribute(element.tag, "open"));
  const labelledHiddenRegion = hidden && hasAttribute(element.tag, "aria-labelledby");
  if (!explicitSemantic && !overlaySemantic && !labelledHiddenRegion) {
    return null;
  }
  return {
    element,
    id,
    nodeId: nodeIdFromTag(element.tag),
    title: visibleModalTitle(source, element),
    confidence: explicitSemantic ? "high" : "medium",
    status: explicitSemantic ? "confirmed" : "pending"
  };
}

function selectorForCandidate(candidate) {
  if (candidate.nodeId) {
    const escapedNodeId = candidate.nodeId.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return `[data-hsm-node-id="${escapedNodeId}"]`;
  }
  if (/^[a-zA-Z][\w:.-]*$/.test(candidate.id)) {
    return `#${candidate.id}`;
  }
  if (candidate.id) {
    const escapedId = candidate.id.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return `[id="${escapedId}"]`;
  }
  return "";
}

function staticSceneId(page, candidate, ordinal) {
  const stableTarget = candidate.nodeId
    ? `node:${candidate.nodeId}`
    : candidate.id
      ? `id:${candidate.id}`
      : `${candidate.element.name}:${candidate.title}:${ordinal}`;
  const fingerprint = createHash("sha256")
    .update(`${page.id}|${page.sourceRelativePath || ""}|${stableTarget}`)
    .digest("hex")
    .slice(0, 12);
  return `scene:modal:${page.id}:static:${fingerprint}`;
}

function staticModalScenes(page, html, interactionScenes) {
  const pageSceneId = `scene:page:${page.id}`;
  const { source, elements } = htmlElementTree(html);
  const interactionSceneIdByTargetNodeId = new Map(interactionScenes.map((scene) => [
    String(scene.entry.targetNodeId || ""),
    scene.id
  ]));
  const candidates = elements
    .map((element, elementIndex) => ({ ...modalCandidate(element, source), elementIndex }))
    .filter((candidate) => candidate.element)
    .filter((candidate) => !candidate.nodeId || !interactionSceneIdByTargetNodeId.has(candidate.nodeId));
  const sceneIdByElementIndex = new Map(candidates.map((candidate, index) => [
    candidate.elementIndex,
    staticSceneId(page, candidate, index)
  ]));
  const targetSceneIdByElementIndex = new Map();
  elements.forEach((element, elementIndex) => {
    const targetSceneId = interactionSceneIdByTargetNodeId.get(nodeIdFromTag(element.tag));
    if (targetSceneId) {
      targetSceneIdByElementIndex.set(elementIndex, targetSceneId);
    }
  });

  return candidates.map((candidate) => {
    let parentElementIndex = candidate.element.parentIndex;
    let parentSceneId = pageSceneId;
    while (parentElementIndex != null) {
      const staticParentId = sceneIdByElementIndex.get(parentElementIndex);
      const interactionParentId = targetSceneIdByElementIndex.get(parentElementIndex);
      if (staticParentId || interactionParentId) {
        parentSceneId = staticParentId || interactionParentId;
        break;
      }
      parentElementIndex = elements[parentElementIndex]?.parentIndex ?? null;
    }
    const selector = selectorForCandidate(candidate);
    const fingerprint = sceneIdByElementIndex.get(candidate.elementIndex).split(":").at(-1);
    return {
      id: sceneIdByElementIndex.get(candidate.elementIndex),
      type: "modal",
      pageId: String(page.id),
      parentSceneId,
      title: candidate.title,
      sourceRelativePath: String(page.sourceRelativePath || ""),
      discovery: {
        source: "static-scan",
        confidence: candidate.confidence,
        status: candidate.status
      },
      entry: {
        type: "static",
        targetNodeId: candidate.nodeId,
        targetSelector: selector,
        fingerprint
      }
    };
  });
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
    const html = htmlByPageId[page.id] || "";
    const interactionScenes = modalScenes(page, html);
    scenes.push(pageScene(page));
    scenes.push(...interactionScenes);
    scenes.push(...staticModalScenes(page, html, interactionScenes));
  }
  return {
    schemaVersion: SCENE_MANIFEST_VERSION,
    scenes
  };
}
