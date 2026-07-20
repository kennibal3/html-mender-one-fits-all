import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const libraryDirectory = path.join(testDirectory, 'fixtures', 'deep-content-v1');
const manifestPath = path.join(libraryDirectory, 'manifest.json');

const requiredCoverage = new Set([
  'modal',
  'nested-modal',
  'dynamic-dom',
  'same-origin-child-page',
  'external-iframe-negative',
  'runtime-iframe-negative',
  'original-script-preservation',
]);

test('deep content sample library contains 5–8 redacted representative fixtures', () => {
  assert.ok(existsSync(manifestPath), 'sample library manifest must exist');

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.version, 1);
  assert.ok(Array.isArray(manifest.samples));
  assert.ok(manifest.samples.length >= 5 && manifest.samples.length <= 8);

  const ids = new Set();
  for (const sample of manifest.samples) {
    assert.match(sample.id, /^[a-z0-9-]+$/);
    assert.ok(!ids.has(sample.id), `duplicate sample id: ${sample.id}`);
    ids.add(sample.id);
    assert.match(sample.sourceRef, /^G(?:1|2|3|4|7|8|9|10|11|12)-\d+[a-z]?$/);
    assert.equal(sample.redacted, true);
    assert.ok(Array.isArray(sample.coverage) && sample.coverage.length > 0);
    assert.ok(Array.isArray(sample.outOfScope) && sample.outOfScope.length > 0);

    const entryPath = path.join(libraryDirectory, sample.entry);
    assert.ok(existsSync(entryPath), `missing fixture entry: ${sample.entry}`);
    const html = readFileSync(entryPath, 'utf8');
    assert.match(html, /<!doctype html>/i);
    assert.match(html, new RegExp(`data-sample-id=["']${sample.id}["']`));
    assert.doesNotMatch(html, /Authorization\s*:|Bearer\s+|\/api\/ai-content\/generate/i);
  }

  const actualCoverage = new Set(manifest.samples.flatMap((sample) => sample.coverage));
  for (const category of requiredCoverage) {
    assert.ok(actualCoverage.has(category), `missing required coverage: ${category}`);
  }
});

test('same-origin child-page sample includes working and intentionally broken navigation', () => {
  assert.ok(existsSync(manifestPath), 'sample library manifest must exist');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const sample = manifest.samples.find(({ coverage }) => coverage.includes('same-origin-child-page'));
  assert.ok(sample, 'same-origin child-page sample must be registered');

  const entryPath = path.join(libraryDirectory, sample.entry);
  const html = readFileSync(entryPath, 'utf8');
  const workingTarget = html.match(/data-working-child=["']([^"']+)["']/)?.[1];
  const brokenTarget = html.match(/data-broken-child=["']([^"']+)["']/)?.[1];
  assert.ok(workingTarget, 'working child-page target must be declared');
  assert.ok(brokenTarget, 'broken child-page target must be declared');
  assert.ok(existsSync(path.join(path.dirname(entryPath), workingTarget)));
  assert.ok(!existsSync(path.join(path.dirname(entryPath), brokenTarget)));
});

test('iframe negative samples use inert placeholders instead of real external services', () => {
  assert.ok(existsSync(manifestPath), 'sample library manifest must exist');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const iframeSamples = manifest.samples.filter(({ coverage }) =>
    coverage.some((category) => category.endsWith('iframe-negative')),
  );
  assert.ok(iframeSamples.length >= 2);

  for (const sample of iframeSamples) {
    const html = readFileSync(path.join(libraryDirectory, sample.entry), 'utf8');
    assert.doesNotMatch(html, /tensorflow|openai|deepseek|doubao|aliyun|baidu/i);
    assert.ok(
      html.includes('https://example.invalid/') || html.includes('srcdoc'),
      `${sample.id} must use example.invalid or srcdoc`,
    );
  }
});
