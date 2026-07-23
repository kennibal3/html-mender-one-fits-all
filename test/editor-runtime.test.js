import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("editor runtime excludes task toolbar elements from page editing", async () => {
  const runtime = await readFile(
    new URL("../vendor/html-slide-mender/assets/html-slide-mender-runtime.js", import.meta.url),
    "utf8"
  );
  const functionStart = runtime.indexOf("isPageElement(element) {");
  const functionEnd = runtime.indexOf("\n    },", functionStart);
  assert.ok(functionStart >= 0 && functionEnd > functionStart, "isPageElement function is missing");
  assert.match(runtime.slice(functionStart, functionEnd), /closest\?*\.?\("\[data-hsm-editor\]"\)/);
});

test("editor runtime exposes PPT-like element editing controls", async () => {
  const runtime = await readFile(
    new URL("../vendor/html-slide-mender/assets/html-slide-mender-runtime.js", import.meta.url),
    "utf8"
  );

  assert.match(runtime, /data-action="add-rect"/);
  assert.match(runtime, /data-action="add-circle"/);
  assert.match(runtime, /data-action="add-line"/);
  assert.match(runtime, /data-action="add-arrow"/);
  assert.match(runtime, /data-action="duplicate-element"/);
  assert.match(runtime, /data-action="delete-element"/);
  assert.match(runtime, /data-action="bring-forward"/);
  assert.match(runtime, /data-action="send-backward"/);
  assert.match(runtime, /data-action="toggle-lock-element"/);
  assert.match(runtime, /data-action="media-replace"/);
  assert.match(runtime, /data-style-control="opacity"/);
  assert.match(runtime, /data-style-control="borderRadius"/);
  assert.match(runtime, /data-style-control="shadow"/);
  assert.match(runtime, /data-control="letterSpacing"/);
  assert.match(runtime, /accept="image\/png,image\/jpeg,image\/webp,image\/gif,video\/mp4,video\/webm,video\/ogg,audio\/mpeg,audio\/wav,audio\/ogg,audio\/mp4,audio\/aac"/);
  assert.match(runtime, /createShapeElement\(kind\)/);
  assert.match(runtime, /kind === "line"/);
  assert.match(runtime, /replaceSelectedMedia\(file\)/);
  assert.match(runtime, /duplicateSelectedElement\(\)/);
  assert.match(runtime, /deleteSelectedElement\(/);
  assert.match(runtime, /changeSelectedElementZOrder\(/);
  assert.match(runtime, /toggleSelectedElementLock\(/);
  assert.match(runtime, /isItemLocked\(item\)/);
  assert.match(runtime, /data-hsm-locked/);
  assert.match(runtime, /applyLetterSpacing\(/);
  assert.match(runtime, /displayLetterSpacing\(item\)/);
  assert.match(runtime, /textShadow/);
  assert.match(runtime, /boxShadow/);
});

test("undo and redo use clear arrow symbols with accessible labels", async () => {
  const runtime = await readFile(
    new URL("../vendor/html-slide-mender/assets/html-slide-mender-runtime.js", import.meta.url),
    "utf8"
  );

  assert.match(
    runtime,
    /data-action="undo"[^>]*title="\$\{escapeAttr\(this\.t\("undo"\)\)\}"[^>]*aria-label="\$\{escapeAttr\(this\.t\("undo"\)\)\}"[^>]*>↶<\/button>/
  );
  assert.match(
    runtime,
    /data-action="redo"[^>]*title="\$\{escapeAttr\(this\.t\("redo"\)\)\}"[^>]*aria-label="\$\{escapeAttr\(this\.t\("redo"\)\)\}"[^>]*>↷<\/button>/
  );
});

test("editor runtime exposes a complete click-to-toggle interaction workflow", async () => {
  const runtime = await readFile(
    new URL("../vendor/html-slide-mender/assets/html-slide-mender-runtime.js", import.meta.url),
    "utf8"
  );

  assert.match(runtime, /data-action="toggle-interactions"/);
  assert.match(runtime, /data-action="begin-click-interaction"/);
  assert.match(runtime, /data-interaction-choice=/);
  assert.match(runtime, /"toggleVisibility", "interactionActionToggle"/);
  assert.match(runtime, /data-action="interaction-wizard-complete"/);
  assert.match(runtime, /data-action="delete-interaction"/);
  assert.match(runtime, /data-role="interaction-panel"/);
  assert.match(runtime, /data-role="interaction-list"/);
  assert.match(runtime, /ensureInteractionElementId\(/);
  assert.match(runtime, /loadInteractionManifest\(/);
  assert.match(runtime, /createToggleInteraction\(/);
  assert.match(runtime, /deleteInteraction\(/);
  assert.match(runtime, /refreshInteractionPanel\(/);
  assert.match(runtime, /interactionManifest\(/);
  assert.match(runtime, /interactionNodeExportPatches\(/);
  assert.match(runtime, /injectInteractionRuntimeIntoHtml\(/);
  assert.match(runtime, /data-hsm-node-id/);
  assert.match(runtime, /data-hsm-interaction-manifest/);
  assert.match(runtime, /data-hsm-interaction-runtime/);
  assert.match(runtime, /toggleVisibility/);
  assert.match(runtime, /schemaVersion/);

  const insertionStart = runtime.indexOf("\nfindInteractionInsertionNode(tree)");
  const insertionEnd = runtime.indexOf("\n    },", insertionStart);
  assert.ok(insertionStart >= 0 && insertionEnd > insertionStart, "interaction insertion locator is missing");
  const insertionRule = runtime.slice(insertionStart, insertionEnd);
  assert.match(insertionRule, /if \(tree\.tag === "body"\)/);
  assert.doesNotMatch(insertionRule, /tree\.tag === "body" \|\| tree\.tag === "html"/);
  assert.match(insertionRule, /return tree\.tag === "html" \? tree : null/);
});

test("interaction editing uses a guided mode that locks unrelated page tools", async () => {
  const runtime = await readFile(
    new URL("../vendor/html-slide-mender/assets/html-slide-mender-runtime.js", import.meta.url),
    "utf8"
  );

  assert.match(runtime, /2026-07-23-deep-modal-a1-session-v4/);
  assert.match(runtime, /data-role="interaction-home"/);
  assert.match(runtime, /data-action="begin-click-interaction"/);
  assert.match(runtime, /data-action="begin-sequence-interaction"/);
  assert.match(runtime, /data-role="interaction-wizard"/);
  assert.match(runtime, /data-role="interaction-wizard-step"/);
  assert.match(runtime, /data-role="interaction-wizard-body"/);
  assert.match(runtime, /data-role="interaction-wizard-footer"/);
  assert.match(runtime, /data-action="interaction-wizard-back"/);
  assert.match(runtime, /data-action="interaction-wizard-next"/);
  assert.match(runtime, /data-action="interaction-wizard-preview"/);
  assert.match(runtime, /data-action="interaction-wizard-complete"/);
  assert.match(runtime, /data-action="interaction-wizard-cancel"/);
  assert.match(runtime, /data-action="toggle-interaction-advanced"/);
  assert.match(runtime, /"toggleVisibility", "interactionActionToggle"/);
  assert.match(runtime, /"openModal", "interactionActionModal"/);
  assert.match(runtime, /"goToPage", "interactionActionPage"/);
  assert.match(runtime, /"openUrl", "interactionActionUrl"/);

  assert.match(runtime, /enterInteractionMode\(/);
  assert.match(runtime, /leaveInteractionMode\(/);
  assert.match(runtime, /beginInteractionWizard\(/);
  assert.match(runtime, /advanceInteractionWizard\(/);
  assert.match(runtime, /completeInteractionWizard\(/);
  assert.match(runtime, /cancelInteractionWizard\(/);
  assert.match(runtime, /isInteractionSelectionMode\(/);
  assert.match(runtime, /interactionWizardStep/);
  assert.match(runtime, /interactionWizardKind/);
  assert.match(runtime, /interactionWizardAction/);
  assert.match(runtime, /dataset\.interactionMode/);
  assert.match(runtime, /const INTERACTION_NODE_ATTRIBUTE = "data-hsm-node-id"/);
  assert.match(runtime, /getAttribute\?\.\(INTERACTION_NODE_ATTRIBUTE\)/);
  assert.doesNotMatch(runtime, /getAttribute\?\.\(NODE_ATTRIBUTE\)/);

  assert.match(runtime, /\.shell\[data-interaction-mode="true"\] \.mode-switch/);
  assert.match(runtime, /\.shell\[data-interaction-mode="true"\] \.group-insert/);
  assert.match(runtime, /\.shell\[data-interaction-mode="true"\] \.edit-popover/);
  assert.match(runtime, /\.interaction-panel-body/);
  assert.match(runtime, /\.interaction-panel-body \{[\s\S]*?flex: 1 1 auto/);
  assert.match(runtime, /\.interaction-panel-footer/);
  assert.match(runtime, /bottom: 72px/);
  assert.match(runtime, /overflow: hidden/);
});

test("completed interactions enter a live preview that can return to editing", async () => {
  const runtime = await readFile(
    new URL("../vendor/html-slide-mender/assets/html-slide-mender-runtime.js", import.meta.url),
    "utf8"
  );

  assert.match(runtime, /2026-07-23-deep-modal-a1-session-v4/);
  assert.match(runtime, /data-interaction-preview="false"/);
  assert.match(runtime, /data-role="interaction-preview-toolbar"/);
  assert.match(runtime, /data-action="stop-interaction-preview"/);
  assert.match(runtime, /startInteractionPreview\(/);
  assert.match(runtime, /stopInteractionPreview\(/);
  assert.match(runtime, /handleInteractionPreviewClick\(/);
  assert.match(runtime, /activateInteractionPreview\(/);
  assert.match(runtime, /openInteractionPreviewModal\(/);
  assert.match(runtime, /restoreInteractionPreviewState\(/);

  const finishStart = runtime.indexOf("\nfinishInteractionCreation(toastKey) {");
  const finishEnd = runtime.indexOf("\n    },", finishStart);
  assert.ok(finishStart >= 0 && finishEnd > finishStart, "interaction completion handler is missing");
  assert.match(runtime.slice(finishStart, finishEnd), /startInteractionPreview/);
  assert.match(runtime, /interactionPreviewUnsaved/);
});

test("click triggers cannot also be hidden progressive-reveal steps", async () => {
  const runtime = await readFile(
    new URL("../vendor/html-slide-mender/assets/html-slide-mender-runtime.js", import.meta.url),
    "utf8"
  );
  const interactionRuntime = await readFile(
    new URL("../vendor/html-slide-mender/assets/html-slide-mender-interactions.js", import.meta.url),
    "utf8"
  );

  assert.match(runtime, /isSequenceStepNode\(/);
  assert.match(runtime, /isClickInteractionTriggerNode\(/);
  assert.match(runtime, /interactionTriggerSequenceConflict/);
  assert.match(runtime, /sequenceTriggerConflict/);
  assert.match(runtime, /sequenceStepsWithoutTriggerConflicts\(/);
  assert.match(runtime, /interactionConflictWarning/);

  const canvasSelectionStart = runtime.indexOf("handleInteractionCanvasSelection(item)");
  const canvasSelectionEnd = runtime.indexOf("\n    },", canvasSelectionStart);
  assert.ok(canvasSelectionStart >= 0 && canvasSelectionEnd > canvasSelectionStart, "interaction canvas handler is missing");
  assert.match(runtime.slice(canvasSelectionStart, canvasSelectionEnd), /isSequenceStepNode\(nodeId\)/);

  const sequenceAddStart = runtime.indexOf("addSelectedItemsToSequence()");
  const sequenceAddEnd = runtime.indexOf("\n    },", sequenceAddStart);
  assert.ok(sequenceAddStart >= 0 && sequenceAddEnd > sequenceAddStart, "sequence add handler is missing");
  assert.match(runtime.slice(sequenceAddStart, sequenceAddEnd), /isClickInteractionTriggerNode\(nodeId\)/);

  assert.match(interactionRuntime, /clickTriggerNodeIds/);
  assert.match(interactionRuntime, /!clickTriggerNodeIds\.has\(step\?\.nodeId\)/);
});

test("editor runtime exposes page jump, modal, and reveal animation workflows", async () => {
  const runtime = await readFile(
    new URL("../vendor/html-slide-mender/assets/html-slide-mender-runtime.js", import.meta.url),
    "utf8"
  );
  const interactionRuntime = await readFile(
    new URL("../vendor/html-slide-mender/assets/html-slide-mender-interactions.js", import.meta.url),
    "utf8"
  );

  assert.match(runtime, /"goToPage", "interactionActionPage"/);
  assert.match(runtime, /"openModal", "interactionActionModal"/);
  assert.match(runtime, /data-role="interaction-page-select"/);
  assert.match(runtime, /data-role="interaction-effect"/);
  assert.match(runtime, /data-role="interaction-duration"/);
  assert.match(runtime, /createPageJumpInteraction\(/);
  assert.match(runtime, /createModalInteraction\(/);
  assert.match(runtime, /selectedInteractionEffect\(/);
  assert.match(runtime, /goToPage/);
  assert.match(runtime, /openModal/);
  assert.match(runtime, /effect:/);
  assert.match(runtime, /2026-07-23-deep-modal-a1-session-v4/);

  assert.match(interactionRuntime, /navigateToPage\(/);
  assert.match(interactionRuntime, /openInteractionModal\(/);
  assert.match(interactionRuntime, /playInteractionEffect\(/);
  assert.match(interactionRuntime, /prefers-reduced-motion/);
  assert.match(interactionRuntime, /aria-modal/);
  assert.match(interactionRuntime, /Escape/);
  assert.match(interactionRuntime, /goToPage/);
  assert.match(interactionRuntime, /openModal/);
});

test("editor runtime exposes a teacher-friendly progressive reveal timeline", async () => {
  const runtime = await readFile(
    new URL("../vendor/html-slide-mender/assets/html-slide-mender-runtime.js", import.meta.url),
    "utf8"
  );
  const interactionRuntime = await readFile(
    new URL("../vendor/html-slide-mender/assets/html-slide-mender-interactions.js", import.meta.url),
    "utf8"
  );

  assert.match(runtime, /const SCHEMA_VERSION = "1\.3"/);
  assert.match(runtime, /data-role="sequence-list"/);
  assert.match(runtime, /data-action="add-sequence-step"/);
  assert.match(runtime, /data-action="move-sequence-step-up"/);
  assert.match(runtime, /data-action="move-sequence-step-down"/);
  assert.match(runtime, /data-action="delete-sequence-step"/);
  assert.match(runtime, /data-action="preview-sequence"/);
  assert.match(runtime, /data-action="advance-sequence-preview"/);
  assert.match(runtime, /data-action="reset-sequence-preview"/);
  assert.match(runtime, /data-sequence-control="effect"/);
  assert.match(runtime, /data-sequence-control="duration"/);
  assert.match(runtime, /normalizeSequence\(/);
  assert.match(runtime, /addSelectedItemsToSequence\(/);
  assert.match(runtime, /moveSequenceStep\(/);
  assert.match(runtime, /updateSequenceStep\(/);
  assert.match(runtime, /deleteSequenceStep\(/);
  assert.match(runtime, /startSequencePreview\(/);
  assert.match(runtime, /advanceSequencePreview\(/);
  assert.match(runtime, /resetSequencePreview\(/);
  const serializerStart = runtime.indexOf("async serializeCleanHtml(");
  const serializerEnd = runtime.indexOf("\n    },", serializerStart);
  assert.ok(serializerStart >= 0 && serializerEnd > serializerStart, "serializer is missing");
  assert.match(runtime.slice(serializerStart, serializerEnd), /stopSequencePreview/);
  assert.match(runtime, /sequences: this\.sequences\.map/);
  assert.match(runtime, /for \(const sequence of this\.sequences\)/);

  assert.match(interactionRuntime, /const SCHEMA_VERSION = "1\.3"/);
  assert.match(interactionRuntime, /initializeSequence\(/);
  assert.match(interactionRuntime, /advanceSequence\(/);
  assert.match(interactionRuntime, /resetSequence\(/);
  assert.match(interactionRuntime, /shouldAdvanceSequence\(/);
  assert.match(interactionRuntime, /event\.key === "ArrowRight"/);
  assert.match(interactionRuntime, /event\.key === " "/);
  assert.match(interactionRuntime, /sequence\.started/);
  assert.match(interactionRuntime, /sequence\.step/);
  assert.match(interactionRuntime, /sequence\.completed/);
  assert.match(interactionRuntime, /isNativeControl\(event\.target\)/);
});

test("editor runtime exposes audio, media playback settings, and safe URL links", async () => {
  const runtime = await readFile(
    new URL("../vendor/html-slide-mender/assets/html-slide-mender-runtime.js", import.meta.url),
    "utf8"
  );
  const interactionRuntime = await readFile(
    new URL("../vendor/html-slide-mender/assets/html-slide-mender-interactions.js", import.meta.url),
    "utf8"
  );

  assert.match(runtime, /2026-07-23-deep-modal-a1-session-v4/);
  assert.match(runtime, /audio\/mpeg/);
  assert.match(runtime, /audio\/wav/);
  assert.match(runtime, /audio\/ogg/);
  assert.match(runtime, /audio\/mp4/);
  assert.match(runtime, /document\.querySelectorAll\("audio"\)/);
  assert.match(runtime, /imageMode: "audio"/);
  assert.match(runtime, /data-action="media-play-toggle"/);
  assert.match(runtime, /data-action="media-restart"/);
  assert.match(runtime, /data-media-control="autoplay"/);
  assert.match(runtime, /data-media-control="controls"/);
  assert.match(runtime, /data-media-control="loop"/);
  assert.match(runtime, /data-media-control="muted"/);
  assert.match(runtime, /toggleSelectedMediaPlayback\(/);
  assert.match(runtime, /restartSelectedMedia\(/);
  assert.match(runtime, /applySelectedMediaSetting\(/);
  assert.match(runtime, /captureMediaAttributes\(/);
  assert.match(runtime, /restoreMediaAttributes\(/);
  assert.match(runtime, /mediaAttributes/);

  assert.match(runtime, /data-role="interaction-url-input"/);
  assert.match(runtime, /data-role="interaction-new-window"/);
  assert.match(runtime, /"openUrl", "interactionActionUrl"/);
  assert.match(runtime, /createUrlInteraction\(/);
  assert.match(runtime, /openUrl/);

  assert.match(interactionRuntime, /safeExternalDestination\(/);
  assert.match(interactionRuntime, /openExternalUrl\(/);
  assert.match(interactionRuntime, /noopener/);
  assert.match(interactionRuntime, /openUrl/);
  assert.match(interactionRuntime, /https:/);
  assert.match(interactionRuntime, /mailto:/);
});

test("layout editing defaults to teacher-friendly visible elements", async () => {
  const runtime = await readFile(
    new URL("../vendor/html-slide-mender/assets/html-slide-mender-runtime.js", import.meta.url),
    "utf8"
  );

  assert.match(runtime, /showAdvancedLayout/);
  assert.match(runtime, /data-action="toggle-advanced-layout"/);
  assert.match(runtime, /isHighConfidenceLayoutCandidate\(element\)/);
  assert.match(runtime, /if \(!this\.showAdvancedLayout && !this\.isTeacherFriendlyLayoutCandidate\(element\)\)/);
  assert.match(runtime, /isTeacherFriendlyLayoutCandidate\(element\)/);
  assert.match(runtime, /hasMeaningfulLayoutContent\(element\)/);
  assert.match(runtime, /isLikelyDecorativeLayout\(element\)/);
  assert.match(runtime, /hasDirectMeaningfulLayoutContent\(element\)/);
  assert.match(runtime, /isWrapperOnlyLayout\(element\)/);
  assert.match(runtime, /isDirectlyEditableLayoutElement\(element\)/);
  assert.match(runtime, /isIntentionalLayoutGroup\(element\)/);
  assert.match(runtime, /shouldShowBoxInCurrentMode\(item, selected, editing, overflow\)/);
  assert.match(runtime, /isTeacherFriendlyTextBox\(item, selected, editing, overflow\)/);
  assert.match(runtime, /isBlankTeacherTextBox\(element\)/);
  assert.match(runtime, /isWrapperOnlyTextBox\(element\)/);
  const showBoxStart = runtime.indexOf("\nshouldShowBoxInCurrentMode(item, selected, editing, overflow)");
  const showBoxEnd = runtime.indexOf("\n    },", showBoxStart);
  assert.ok(showBoxStart >= 0 && showBoxEnd > showBoxStart, "layout box visibility function is missing");
  const showBoxRule = runtime.slice(showBoxStart, showBoxEnd);
  assert.doesNotMatch(showBoxRule, /selected \|\| editing \|\| overflow/);
  assert.doesNotMatch(showBoxRule, /if \(!this\.isLayoutMode\?\.\(\)\) \{\s*return true;/);
  assert.match(showBoxRule, /item\.type === "text"[\s\S]{0,140}this\.isTeacherFriendlyTextBox/);
  const textBoxStart = runtime.indexOf("\nisTeacherFriendlyTextBox(item, selected, editing, overflow)");
  const textBoxEnd = runtime.indexOf("\n    },", textBoxStart);
  assert.ok(textBoxStart >= 0 && textBoxEnd > textBoxStart, "layout text visibility function is missing");
  const textBoxRule = runtime.slice(textBoxStart, textBoxEnd);
  assert.doesNotMatch(textBoxRule, /return true;\n      }\n      const text = normalizeText/);
  assert.doesNotMatch(textBoxRule, /hasAttribute\("data-editable"\)[\s\S]{0,90}return true/);
  assert.match(textBoxRule, /this\.isBlankTeacherTextBox\(element\)/);
  assert.match(textBoxRule, /this\.isWrapperOnlyTextBox\(element\)/);
  assert.match(textBoxRule, /this\.isLargeStructureTextBox\(element\)/);
  assert.match(textBoxRule, /this\.isDirectTextEditTarget\(element\)/);
  assert.match(runtime, /isLargeStructureTextBox\(element\)/);
  assert.match(runtime, /isDirectTextEditTarget\(element\)/);

  const textCandidateStart = runtime.indexOf("\nisTextCandidate(element)");
  const textCandidateEnd = runtime.indexOf("\n    },", textCandidateStart);
  assert.ok(textCandidateStart >= 0 && textCandidateEnd > textCandidateStart, "text candidate filter is missing");
  const textCandidateRule = runtime.slice(textCandidateStart, textCandidateEnd);
  assert.match(textCandidateRule, /this\.isDirectTextEditTarget\?*\.?\(element\)/);

  const wrapperTextStart = runtime.indexOf("\nisWrapperOnlyTextBox(element)");
  const wrapperTextEnd = runtime.indexOf("\n    },", wrapperTextStart);
  assert.ok(wrapperTextStart >= 0 && wrapperTextEnd > wrapperTextStart, "wrapper-only text filter is missing");
  const wrapperTextRule = runtime.slice(wrapperTextStart, wrapperTextEnd);
  assert.match(wrapperTextRule, /!this\.isDirectTextEditTarget\?*\.?\(element\)/);
  assert.doesNotMatch(wrapperTextRule, /hasDirectMeaningfulLayoutContent/);

  const directTextStart = runtime.indexOf("\nisDirectTextEditTarget(element)");
  const directTextEnd = runtime.indexOf("\n    },", directTextStart);
  assert.ok(directTextStart >= 0 && directTextEnd > directTextStart, "direct text target filter is missing");
  const directTextRule = runtime.slice(directTextStart, directTextEnd);
  assert.match(directTextRule, /hasDirectMediaOrInteractiveChild/);

  const highConfidenceStart = runtime.indexOf("\nisHighConfidenceLayoutCandidate(element)");
  const highConfidenceEnd = runtime.indexOf("\n    },", highConfidenceStart);
  assert.ok(highConfidenceStart >= 0 && highConfidenceEnd > highConfidenceStart, "high-confidence layout filter is missing");
  const highConfidenceRule = runtime.slice(highConfidenceStart, highConfidenceEnd);
  assert.match(highConfidenceRule, /this\.isDirectlyEditableLayoutElement\(element\)/);
  assert.doesNotMatch(highConfidenceRule, /this\.isIntentionalLayoutGroup\(element\)/);

  const directLayoutStart = runtime.indexOf("\nisDirectlyEditableLayoutElement(element)");
  const directLayoutEnd = runtime.indexOf("\n    },", directLayoutStart);
  assert.ok(directLayoutStart >= 0 && directLayoutEnd > directLayoutStart, "direct layout filter is missing");
  const directLayoutRule = runtime.slice(directLayoutStart, directLayoutEnd);
  assert.match(directLayoutRule, /data-hsm-added/);
  assert.match(directLayoutRule, /data-shape/);
  assert.doesNotMatch(directLayoutRule, /data-card/);
  assert.doesNotMatch(directLayoutRule, /data-panel/);
  assert.match(runtime, /\.box-label \{/);
  assert.match(runtime, /\.box:hover \.box-label,/);
  assert.match(runtime, /\.box\.is-selected \.box-label/);
  const boxCssStart = runtime.indexOf("    .box {\n");
  const boxCssEnd = runtime.indexOf("\n\n    .box-image {", boxCssStart);
  assert.ok(boxCssStart >= 0 && boxCssEnd > boxCssStart, "editor box CSS is missing");
  const boxCss = runtime.slice(boxCssStart, boxCssEnd);
  assert.match(boxCss, /border: 1\.5px dashed transparent/);
  assert.match(boxCss, /background: transparent/);
  assert.match(boxCss, /\.box:hover,\s*\.box\.is-selected \{[\s\S]{0,160}border-color: #1f6fff/);
  const overflowCssStart = runtime.indexOf("    .box.has-overflow {\n");
  const overflowCssEnd = runtime.indexOf("\n    }", overflowCssStart) + "\n    }".length;
  assert.ok(overflowCssStart >= 0 && overflowCssEnd > overflowCssStart, "overflow box CSS is missing");
  const overflowCss = runtime.slice(overflowCssStart, overflowCssEnd);
  assert.doesNotMatch(overflowCss, /border-color: #f59e0b/);
  assert.match(runtime, /\.box\.has-overflow:hover,\s*\.box\.has-overflow\.is-selected \{[\s\S]{0,160}border-color: #f59e0b/);
});

test("font menu includes common Chinese teaching fonts", async () => {
  const runtime = await readFile(
    new URL("../vendor/html-slide-mender/assets/html-slide-mender-runtime.js", import.meta.url),
    "utf8"
  );

  for (const fontName of [
    "宋体",
    "黑体",
    "楷体",
    "正楷",
    "仿宋",
    "微软雅黑",
    "苹方",
    "思源黑体",
    "思源宋体",
    "华文行楷",
    "方正正楷",
    "方正小标宋",
    "霞鹜文楷",
    "阿里巴巴普惠体",
    "鸿蒙黑体"
    ,"华文细黑"
    ,"华文隶书"
    ,"华文新魏"
    ,"华文琥珀"
    ,"华文彩云"
    ,"华文新宋"
    ,"方正书宋"
    ,"方正黑体"
    ,"方正兰亭黑"
    ,"方正舒体"
    ,"方正姚体"
    ,"汉仪旗黑"
    ,"文泉驿正黑"
    ,"更纱黑体"
    ,"得意黑"
    ,"仓耳今楷"
  ]) {
    assert.match(runtime, new RegExp(fontName));
  }
});

test("editor runtime inserts a directly editable text box with undo and export support", async () => {
  const runtime = await readFile(
    new URL("../vendor/html-slide-mender/assets/html-slide-mender-runtime.js", import.meta.url),
    "utf8"
  );

  assert.match(runtime, /data-action="add-text"/);
  assert.match(runtime, /case "add-text":[\s\S]{0,120}this\.addTextBox/);
  assert.match(runtime, /addTextBox\(\)/);
  assert.match(runtime, /createTextBoxElement\(\)/);
  assert.match(runtime, /adoptAddedTextElement\(element\)/);
  assert.match(runtime, /pushElementPresenceHistory\(item/);
  assert.match(runtime, /this\.enterTextEdit\(item\)/);

  const createStart = runtime.indexOf("\n    createTextBoxElement() {");
  const createEnd = runtime.indexOf("\n    },", createStart);
  assert.ok(createStart >= 0 && createEnd > createStart, "text box factory is missing");
  const createRule = runtime.slice(createStart, createEnd);
  assert.match(createRule, /data-hsm-added/);
  assert.match(createRule, /data-editable/);
  assert.match(createRule, /data-layout-editable/);
  assert.match(createRule, /position:\s*"absolute"/);
  assert.match(createRule, /newTextPlaceholder/);

  assert.match(runtime, /kind:\s*"presence"/);
  assert.match(runtime, /state\.kind === "presence"/);
  assert.match(runtime, /serializeAddedElements\?\.\(\s*sourceHtmlForExport\s*\)/);
});

test("source-backed export does not duplicate previously saved added elements", async () => {
  const runtime = await readFile(
    new URL("../vendor/html-slide-mender/assets/html-slide-mender-runtime.js", import.meta.url),
    "utf8"
  );

  const serializeStart = runtime.indexOf("\n    serializeAddedElements(sourceHtml = \"\") {");
  const serializeEnd = runtime.indexOf("\n    },", serializeStart);
  assert.ok(serializeStart >= 0 && serializeEnd > serializeStart, "source-aware added element serializer is missing");
  const serializeRule = runtime.slice(serializeStart, serializeEnd);
  assert.match(serializeRule, /new DOMParser\(\)\.parseFromString/);
  assert.match(serializeRule, /selectorForDraftElement/);
  assert.match(serializeRule, /sourceDocument\.querySelector/);
  assert.match(serializeRule, /sourceElement\.tagName === element\.tagName/);
});

test("editor runtime groups elements without wrapping or breaking the courseware DOM", async () => {
  const runtime = await readFile(
    new URL("../vendor/html-slide-mender/assets/html-slide-mender-runtime.js", import.meta.url),
    "utf8"
  );

  assert.match(runtime, /data-action="group-elements"/);
  assert.match(runtime, /data-action="ungroup-elements"/);
  assert.match(runtime, /case "group-elements":[\s\S]{0,120}this\.groupSelectedElements/);
  assert.match(runtime, /case "ungroup-elements":[\s\S]{0,120}this\.ungroupSelectedElements/);
  assert.match(runtime, /groupSelectedElements\(\)/);
  assert.match(runtime, /ungroupSelectedElements\(\)/);
  assert.match(runtime, /groupIdForItem\(item\)/);
  assert.match(runtime, /selectLogicalGroup\(id/);
  assert.match(runtime, /data-hsm-group-id/);

  const groupStart = runtime.indexOf("\n    groupSelectedElements() {");
  const groupEnd = runtime.indexOf("\n    },", groupStart);
  assert.ok(groupStart >= 0 && groupEnd > groupStart, "group action is missing");
  const groupRule = runtime.slice(groupStart, groupEnd);
  assert.doesNotMatch(groupRule, /appendChild|replaceChildren|insertBefore/);
  assert.match(groupRule, /withLayoutMutation/);

  const captureStart = runtime.indexOf("\n    captureState(item) {");
  const captureEnd = runtime.indexOf("\nrestoreState(item, state) {", captureStart);
  assert.ok(captureStart >= 0 && captureEnd > captureStart, "history capture is missing");
  assert.match(runtime.slice(captureStart, captureEnd), /groupId/);
  assert.match(runtime, /restoreAttr\([^\n]+"data-hsm-group-id"/);
  assert.match(runtime, /groupAttributesForExport/);
});

test("editor runtime distributes three or more selected elements evenly", async () => {
  const runtime = await readFile(
    new URL("../vendor/html-slide-mender/assets/html-slide-mender-runtime.js", import.meta.url),
    "utf8"
  );

  assert.match(runtime, /data-action="layout-distribute-horizontal"/);
  assert.match(runtime, /data-action="layout-distribute-vertical"/);
  assert.match(runtime, /case "layout-distribute-horizontal":[\s\S]{0,140}distributeSelectedLayout\?\.\("horizontal"\)/);
  assert.match(runtime, /case "layout-distribute-vertical":[\s\S]{0,140}distributeSelectedLayout\?\.\("vertical"\)/);
  assert.match(runtime, /distributeSelectedLayout\(axis\)/);

  const distributeStart = runtime.indexOf("\n    distributeSelectedLayout(axis) {");
  const distributeEnd = runtime.indexOf("\n    },", distributeStart);
  assert.ok(distributeStart >= 0 && distributeEnd > distributeStart, "distribution action is missing");
  const distributeRule = runtime.slice(distributeStart, distributeEnd);
  assert.match(distributeRule, /items\.length < 3/);
  assert.match(distributeRule, /withLayoutMutation/);
  assert.match(distributeRule, /getBoundingClientRect/);
  assert.match(distributeRule, /applyLayoutAdjustment/);
});

test("layout mode supports PowerPoint-like marquee multi-selection", async () => {
  const runtime = await readFile(
    new URL("../vendor/html-slide-mender/assets/html-slide-mender-runtime.js", import.meta.url),
    "utf8"
  );

  assert.match(runtime, /\.layout-marquee\s*\{/);
  assert.match(runtime, /layoutModeOn:\s*"[^"]*框选/);
  assert.match(runtime, /startLayoutMarquee\(event\)/);
  assert.match(runtime, /finishLayoutMarquee\(cancelled/);
  assert.match(runtime, /layoutMarqueeHitIds\(rect\)/);
  assert.match(runtime, /expandLogicalGroupIds\(ids\)/);

  const pointerStart = runtime.indexOf("\nhandleDocumentPointerDown(event) {");
  const pointerEnd = runtime.indexOf("\n    },", pointerStart);
  assert.ok(pointerStart >= 0 && pointerEnd > pointerStart, "document pointer handler is missing");
  assert.match(runtime.slice(pointerStart, pointerEnd), /startLayoutMarquee/);

  const finishStart = runtime.indexOf("\n    finishLayoutMarquee(cancelled");
  const finishEnd = runtime.indexOf("\n    },", finishStart);
  assert.ok(finishStart >= 0 && finishEnd > finishStart, "marquee completion logic is missing");
  const finishRule = runtime.slice(finishStart, finishEnd);
  assert.match(finishRule, /additive/);
  assert.match(finishRule, /selectedIds/);
  assert.match(finishRule, /expandLogicalGroupIds/);
});

test("multi-element scaling preserves true group geometry", async () => {
  const runtime = await readFile(
    new URL("../vendor/html-slide-mender/assets/html-slide-mender-runtime.js", import.meta.url),
    "utf8"
  );

  assert.match(runtime, /layoutGroupBounds\(entries\)/);
  const startScale = runtime.indexOf("\nstartLayoutScale(event, item, handle) {");
  const endStartScale = runtime.indexOf("\nhandleLayoutScaleMove(event) {", startScale);
  assert.ok(startScale >= 0 && endStartScale > startScale, "layout scale setup is missing");
  const startScaleRule = runtime.slice(startScale, endStartScale);
  assert.match(startScaleRule, /layoutGroupBounds/);
  assert.match(startScaleRule, /groupBounds\.centerX/);
  assert.match(startScaleRule, /groupBounds\.centerY/);

  const scaleMove = runtime.slice(endStartScale, runtime.indexOf("\nstartLayoutResize(event", endStartScale));
  assert.match(scaleMove, /entry\.startCenterX - drag\.centerX/);
  assert.match(scaleMove, /entry\.startCenterY - drag\.centerY/);
  assert.match(scaleMove, /entry\.adjustment\.x = entry\.originX/);
  assert.match(scaleMove, /entry\.adjustment\.y = entry\.originY/);
  assert.match(scaleMove, /applyLayoutAdjustment/);
});
