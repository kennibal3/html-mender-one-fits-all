import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("writeJsonAtomic replaces task metadata without leaving a temporary file", async () => {
  const { writeJsonAtomic } = await import("../src/task-store.js").catch(() => ({}));
  assert.equal(typeof writeJsonAtomic, "function", "atomic task metadata writer is not implemented");
  const temp = await mkdtemp(join(tmpdir(), "html-mender-task-store-"));
  const target = join(temp, "meta.json");
  try {
    await writeJsonAtomic(target, { name: "第一次" });
    await writeJsonAtomic(target, { name: "第二次", pageCount: 3 });
    assert.deepEqual(JSON.parse(await readFile(target, "utf8")), { name: "第二次", pageCount: 3 });
    await assert.rejects(access(`${target}.tmp`, constants.F_OK));
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
