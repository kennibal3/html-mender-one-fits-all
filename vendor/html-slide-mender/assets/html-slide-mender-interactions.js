/* HTML_MENDER_INTERACTIONS_RUNTIME */
(() => {
  const MANIFEST_SELECTOR = 'script[data-hsm-interaction-manifest]';
  const NODE_ATTRIBUTE = "data-hsm-node-id";
  const HIDDEN_ATTRIBUTE = "data-hsm-interaction-hidden";
  const DISPLAY_ATTRIBUTE = "data-hsm-interaction-display";
  const SCHEMA_VERSION = "1.3";
  let activeModal = null;
  const sequenceStates = new Map();
  let sequenceListenersInstalled = false;

  function readManifest() {
    const node = document.querySelector(MANIFEST_SELECTOR);
    if (!node) {
      return { schemaVersion: SCHEMA_VERSION, interactions: [], sequences: [] };
    }
    try {
      const parsed = JSON.parse(node.textContent || "{}");
      return {
        schemaVersion: String(parsed.schemaVersion || SCHEMA_VERSION),
        interactions: Array.isArray(parsed.interactions) ? parsed.interactions : [],
        sequences: Array.isArray(parsed.sequences) ? parsed.sequences : []
      };
    } catch (_error) {
      return { schemaVersion: SCHEMA_VERSION, interactions: [], sequences: [] };
    }
  }

  function findNode(nodeId) {
    if (!nodeId) {
      return null;
    }
    return Array.from(document.querySelectorAll(`[${NODE_ATTRIBUTE}]`))
      .find((element) => element.getAttribute(NODE_ATTRIBUTE) === nodeId) || null;
  }

  function isNativeControl(element) {
    return Boolean(element?.closest?.("button,a,input,select,textarea,summary,video,audio,iframe,[role='button'],[role='link'],[contenteditable='true']"));
  }

  function setVisible(element, visible) {
    if (!element) {
      return false;
    }
    if (!element.hasAttribute(DISPLAY_ATTRIBUTE)) {
      element.setAttribute(DISPLAY_ATTRIBUTE, element.style.display || "");
    }
    if (visible) {
      const originalDisplay = element.getAttribute(DISPLAY_ATTRIBUTE) || "";
      if (originalDisplay) {
        element.style.display = originalDisplay;
      } else {
        element.style.removeProperty("display");
      }
      element.removeAttribute(HIDDEN_ATTRIBUTE);
      element.removeAttribute("aria-hidden");
    } else {
      element.style.display = "none";
      element.setAttribute(HIDDEN_ATTRIBUTE, "true");
      element.setAttribute("aria-hidden", "true");
    }
    return visible;
  }

  function toggleVisibility(element) {
    return setVisible(element, element?.hasAttribute(HIDDEN_ATTRIBUTE));
  }

  function prefersReducedMotion() {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches || false;
  }

  function playInteractionEffect(element, effect = {}) {
    if (!element || prefersReducedMotion() || typeof element.animate !== "function") {
      return null;
    }
    const type = String(effect.type || "none");
    const duration = Math.min(3000, Math.max(100, Number(effect.duration) || 400));
    const keyframes = {
      fadeIn: [{ opacity: 0 }, { opacity: 1 }],
      flyIn: [{ opacity: 0, transform: "translateY(28px)" }, { opacity: 1, transform: "translateY(0)" }],
      zoomIn: [{ opacity: 0, transform: "scale(0.9)" }, { opacity: 1, transform: "scale(1)" }]
    }[type];
    if (!keyframes) {
      return null;
    }
    return element.animate(keyframes, {
      duration,
      easing: "cubic-bezier(0.2, 0.8, 0.2, 1)"
    });
  }

  function safePageDestination(value) {
    const href = String(value || "").trim();
    if (!href) {
      return "";
    }
    try {
      const url = new URL(href, document.baseURI);
      if (!["http:", "https:", "file:"].includes(url.protocol)) {
        return "";
      }
      return url.href;
    } catch (_error) {
      return "";
    }
  }

  function navigateToPage(interaction) {
    const destination = safePageDestination(interaction.action?.href);
    if (!destination) {
      return false;
    }
    window.location.assign(destination);
    return true;
  }

  function safeExternalDestination(value) {
    const href = String(value || "").trim();
    if (!href) return "";
    try {
      const url = new URL(href, document.baseURI);
      if (!["http:", "https:", "mailto:", "tel:"].includes(url.protocol)) return "";
      return url.href;
    } catch (_error) {
      return "";
    }
  }

  function openExternalUrl(interaction) {
    const destination = safeExternalDestination(interaction.action?.href);
    if (!destination) return false;
    if (interaction.action?.newWindow !== false) {
      const opened = window.open(destination, "_blank", "noopener,noreferrer");
      if (opened) opened.opener = null;
      return Boolean(opened);
    }
    window.location.assign(destination);
    return true;
  }

  function closeInteractionModal() {
    if (!activeModal) {
      return false;
    }
    const { root, trigger, onKeydown } = activeModal;
    document.removeEventListener("keydown", onKeydown, true);
    root.remove();
    activeModal = null;
    trigger?.focus?.();
    return true;
  }

  function openInteractionModal(interaction, trigger) {
    const target = findNode(interaction.action?.targetId);
    if (!target) {
      return false;
    }
    closeInteractionModal();

    const root = document.createElement("div");
    root.setAttribute("data-hsm-interaction-modal", interaction.id || "modal");
    Object.assign(root.style, {
      position: "fixed",
      inset: "0",
      zIndex: "2147483000",
      display: "grid",
      placeItems: "center",
      padding: "24px",
      background: "rgba(15, 23, 42, 0.58)"
    });

    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-label", interaction.name || "课件说明");
    dialog.tabIndex = -1;
    Object.assign(dialog.style, {
      position: "relative",
      width: "min(900px, 92vw)",
      maxHeight: "88vh",
      overflow: "auto",
      padding: "28px",
      border: "1px solid rgba(15, 118, 110, 0.32)",
      borderRadius: "14px",
      background: "#fffdf7",
      color: "#1d2522",
      boxShadow: "0 28px 80px rgba(15, 23, 42, 0.28)"
    });

    const close = document.createElement("button");
    close.type = "button";
    close.setAttribute("aria-label", "关闭弹窗");
    close.textContent = "×";
    Object.assign(close.style, {
      position: "absolute",
      top: "10px",
      right: "12px",
      width: "36px",
      height: "36px",
      border: "1px solid #cbd5e1",
      borderRadius: "8px",
      background: "#ffffff",
      color: "#0f172a",
      font: "700 24px/1 sans-serif",
      cursor: "pointer"
    });

    const content = target.cloneNode(true);
    content.removeAttribute(NODE_ATTRIBUTE);
    content.querySelectorAll?.(`[${NODE_ATTRIBUTE}]`).forEach((node) => node.removeAttribute(NODE_ATTRIBUTE));
    setVisible(content, true);
    content.style.maxWidth = "100%";
    content.querySelectorAll?.("img,video,iframe").forEach((media) => {
      media.style.maxWidth = "100%";
      media.style.height = "auto";
    });

    const onKeydown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeInteractionModal();
        return;
      }
      if (event.key !== "Tab") {
        return;
      }
      const focusable = Array.from(dialog.querySelectorAll("button,a,input,select,textarea,[tabindex]:not([tabindex='-1'])"));
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    close.addEventListener("click", closeInteractionModal);
    root.addEventListener("click", (event) => {
      if (event.target === root) {
        closeInteractionModal();
      }
    });
    dialog.append(close, content);
    root.appendChild(dialog);
    document.documentElement.appendChild(root);
    document.addEventListener("keydown", onKeydown, true);
    activeModal = { root, trigger, onKeydown };
    close.focus();
    playInteractionEffect(dialog, interaction.effect);
    return true;
  }

  function emitInteractionEvent(interaction, payload = {}) {
    const detail = {
      schemaVersion: SCHEMA_VERSION,
      eventId: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      type: "interaction.activated",
      timestamp: new Date().toISOString(),
      interactionId: interaction.id,
      triggerId: interaction.trigger?.nodeId || "",
      targetId: interaction.action?.targetId || "",
      action: interaction.action?.type || "",
      payload
    };
    window.dispatchEvent(new CustomEvent("hsm-interaction-event", { detail }));
    try {
      window.HtmlMenderInteractionAdapter?.emit?.(detail);
    } catch (_error) {
      // Platform recording must never block the lesson interaction.
    }
  }

  function emitSequenceEvent(sequence, type, payload = {}) {
    const detail = {
      schemaVersion: SCHEMA_VERSION,
      eventId: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      type,
      timestamp: new Date().toISOString(),
      sequenceId: sequence.id || "",
      stepId: payload.stepId || "",
      targetId: payload.targetId || "",
      action: "advanceSequence",
      payload
    };
    window.dispatchEvent(new CustomEvent("hsm-interaction-event", { detail }));
    try {
      window.HtmlMenderInteractionAdapter?.emit?.(detail);
    } catch (_error) {
      // Platform recording must never block the lesson interaction.
    }
  }

  function initializeSequence(sequence) {
    if (!sequence?.id || !Array.isArray(sequence.steps)) {
      return null;
    }
    const steps = sequence.steps
      .map((step) => ({ step, element: findNode(step?.nodeId) }))
      .filter((entry) => entry.step?.id && entry.element);
    if (!steps.length) {
      return null;
    }
    const state = { sequence, steps, index: 0, started: false, completed: false };
    for (const entry of steps) {
      setVisible(entry.element, false);
    }
    sequenceStates.set(sequence.id, state);
    return state;
  }

  function sequenceState(sequenceOrId) {
    const id = typeof sequenceOrId === "string" ? sequenceOrId : sequenceOrId?.id;
    return sequenceStates.get(id) || (typeof sequenceOrId === "object" ? initializeSequence(sequenceOrId) : null);
  }

  function advanceSequence(sequenceOrId) {
    const state = sequenceState(sequenceOrId);
    if (!state || state.completed || state.index >= state.steps.length) {
      return false;
    }
    if (!state.started) {
      state.started = true;
      emitSequenceEvent(state.sequence, "sequence.started", { stepCount: state.steps.length });
    }
    const entry = state.steps[state.index];
    setVisible(entry.element, true);
    playInteractionEffect(entry.element, entry.step.effect);
    state.index += 1;
    emitSequenceEvent(state.sequence, "sequence.step", {
      stepId: entry.step.id,
      targetId: entry.step.nodeId,
      stepIndex: state.index,
      stepCount: state.steps.length
    });
    if (state.index >= state.steps.length) {
      state.completed = true;
      emitSequenceEvent(state.sequence, "sequence.completed", { stepCount: state.steps.length });
    }
    return true;
  }

  function resetSequence(sequenceOrId) {
    const state = sequenceState(sequenceOrId);
    if (!state) {
      return false;
    }
    for (const entry of state.steps) {
      setVisible(entry.element, false);
    }
    state.index = 0;
    state.started = false;
    state.completed = false;
    return true;
  }

  function nextActiveSequence() {
    return Array.from(sequenceStates.values()).find((state) => !state.completed) || null;
  }

  function shouldAdvanceSequence(event) {
    if (!event || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) {
      return false;
    }
    if (activeModal || document.querySelector('[data-hsm-editor="skill-runtime"]')) {
      return false;
    }
    if (isNativeControl(event.target)) {
      return false;
    }
    return !event.target?.closest?.("[data-hsm-interaction-modal],[data-hsm-sequence-ignore]");
  }

  function installSequenceAdvanceListeners() {
    if (sequenceListenersInstalled || !sequenceStates.size) {
      return;
    }
    sequenceListenersInstalled = true;
    document.addEventListener("click", (event) => {
      if (!shouldAdvanceSequence(event)) {
        return;
      }
      const state = nextActiveSequence();
      if (state && advanceSequence(state.sequence)) {
        event.preventDefault();
      }
    });
    document.addEventListener("keydown", (event) => {
      const advancesSequence = event.key === "ArrowRight" || event.key === " ";
      if (!advancesSequence) {
        return;
      }
      if (!shouldAdvanceSequence(event)) {
        return;
      }
      const state = nextActiveSequence();
      if (state && advanceSequence(state.sequence)) {
        event.preventDefault();
      }
    });
  }

  function activateInteraction(interaction) {
    const actionType = interaction.action?.type;
    if (actionType === "goToPage") {
      const navigating = navigateToPage(interaction);
      emitInteractionEvent(interaction, { navigating, href: interaction.action?.href || "" });
      return navigating;
    }
    if (actionType === "openUrl") {
      const opened = openExternalUrl(interaction);
      emitInteractionEvent(interaction, { opened, href: interaction.action?.href || "" });
      return opened;
    }
    if (actionType === "openModal") {
      const trigger = findNode(interaction.trigger?.nodeId);
      const opened = openInteractionModal(interaction, trigger);
      emitInteractionEvent(interaction, { opened });
      return opened;
    }
    const target = findNode(interaction.action?.targetId);
    if (!target || actionType !== "toggleVisibility") {
      return false;
    }
    const visible = toggleVisibility(target);
    if (visible) {
      playInteractionEffect(target, interaction.effect);
    }
    emitInteractionEvent(interaction, { visible });
    return visible;
  }

  function bindInteraction(interaction) {
    const trigger = findNode(interaction.trigger?.nodeId);
    const actionType = interaction.action?.type;
    const target = findNode(interaction.action?.targetId);
    const requiresTarget = actionType === "toggleVisibility" || actionType === "openModal";
    if (!trigger || (requiresTarget && !target) || interaction.trigger?.event !== "click") {
      return false;
    }

    if (interaction.initialState?.target === "hidden") {
      setVisible(target, false);
    }
    if (!isNativeControl(trigger)) {
      trigger.setAttribute("role", actionType === "openUrl" ? "link" : "button");
      if (!trigger.hasAttribute("tabindex")) {
        trigger.setAttribute("tabindex", "0");
      }
    }
    if (target) {
      trigger.setAttribute("aria-controls", interaction.action.targetId);
    }

    trigger.addEventListener("click", (event) => {
      event.preventDefault();
      activateInteraction(interaction);
    });
    trigger.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }
      event.preventDefault();
      activateInteraction(interaction);
    });
    return true;
  }

  function start() {
    if (document.querySelector('[data-hsm-editor="skill-runtime"]')) {
      return { active: false, reason: "editor" };
    }
    const reducedMotion = prefersReducedMotion();
    const manifest = readManifest();
    const clickTriggerNodeIds = new Set(
      manifest.interactions.map((interaction) => interaction.trigger?.nodeId).filter(Boolean)
    );
    let bound = 0;
    for (const interaction of manifest.interactions) {
      if (bindInteraction(interaction)) {
        bound += 1;
      }
    }
    sequenceStates.clear();
    for (const sequence of manifest.sequences) {
      initializeSequence({
        ...sequence,
        steps: (sequence.steps || []).filter((step) => !clickTriggerNodeIds.has(step?.nodeId))
      });
    }
    installSequenceAdvanceListeners();
    return {
      active: true,
      bound,
      sequences: sequenceStates.size,
      reducedMotion,
      schemaVersion: manifest.schemaVersion
    };
  }

  window.HtmlMenderInteractions = {
    readManifest,
    start,
    setVisible,
    toggleVisibility,
    navigateToPage,
    safeExternalDestination,
    openExternalUrl,
    openInteractionModal,
    closeInteractionModal,
    playInteractionEffect,
    initializeSequence,
    advanceSequence,
    resetSequence,
    shouldAdvanceSequence
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
