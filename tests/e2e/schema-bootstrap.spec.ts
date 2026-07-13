import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

describe("canonical schema bootstrap", () => {
  it("starts the isolated Tauri app and renders the primary DOM", async () => {
    const evidenceRoot = process.env.EVIDENCE_ROOT;
    assert.ok(evidenceRoot, "EVIDENCE_ROOT must be set");
    await mkdir(evidenceRoot, { recursive: true });

    await browser.waitUntil(
      async () => browser.execute(() => document.readyState === "complete" && Boolean(document.querySelector("#root"))),
      { timeout: 30_000, timeoutMsg: "Primary DOM did not become ready" },
    );

    const root = await $("#root");
    await root.waitForDisplayed({ timeout: 30_000 });
    const bodyText = await $("body").getText();
    assert.ok(bodyText.length > 0, "Expected a non-empty application DOM");

    await writeFile(path.join(evidenceRoot, "schema-bootstrap-dom.html"), await browser.getPageSource(), "utf8");
    await writeFile(
      path.join(evidenceRoot, "schema-bootstrap-readiness.json"),
      `${JSON.stringify({ timestamp: new Date().toISOString(), readyState: "complete", rootDisplayed: true }, null, 2)}\n`,
      "utf8",
    );
  });
});
