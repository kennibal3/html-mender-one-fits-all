import assert from "node:assert/strict";
import test from "node:test";

async function loadContentDetector() {
  return import("../src/core.js").catch(() => ({}));
}

test("isHtmlContent recognizes complete HTML regardless of file extension", async () => {
  const { isHtmlContent } = await loadContentDetector();
  assert.equal(typeof isHtmlContent, "function", "HTML content detector is not implemented");

  assert.equal(isHtmlContent("\uFEFF  <!doctype html><html><body>课件</body></html>"), true);
  assert.equal(isHtmlContent("<HTML><HEAD><title>Lesson</title></HEAD></HTML>"), true);
  assert.equal(isHtmlContent("<body><main>Fragment</main></body>"), true);
});

test("isHtmlContent rejects non-HTML code and unrelated documents", async () => {
  const { isHtmlContent } = await loadContentDetector();
  assert.equal(typeof isHtmlContent, "function", "HTML content detector is not implemented");

  assert.equal(isHtmlContent("body { color: red; }"), false);
  assert.equal(isHtmlContent("const html = '<html></html>';"), false);
  assert.equal(isHtmlContent("<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>"), false);
  assert.equal(isHtmlContent("这是一份普通文本"), false);
});

test("packaged injector path points to the unpacked ASAR directory", async () => {
  const { resolveEditorInjectorPath, resolveEditorWorkingDirectory } = await loadContentDetector();
  assert.equal(typeof resolveEditorInjectorPath, "function", "packaged injector path resolver is not implemented");
  assert.equal(typeof resolveEditorWorkingDirectory, "function", "packaged editor working directory resolver is not implemented");
  assert.equal(
    resolveEditorInjectorPath("/Applications/HTML Mender.app/Contents/Resources/app.asar"),
    "/Applications/HTML Mender.app/Contents/Resources/app.asar.unpacked/vendor/html-slide-mender/scripts/inject-html-editor.mjs"
  );
  assert.equal(
    resolveEditorWorkingDirectory("/Applications/HTML Mender.app/Contents/Resources/app.asar"),
    "/Applications/HTML Mender.app/Contents/Resources/app.asar.unpacked/vendor/html-slide-mender/scripts"
  );
});
