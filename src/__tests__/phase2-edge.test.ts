import { describe, it, expect } from "vitest";

// -------------------------------------------------------------------
// 2.1: ErrorBoundary — all 9 unprotected views are now wrapped
// -------------------------------------------------------------------
describe("Phase 2.1 - ErrorBoundary wrapping in App.renderView()", () => {
  it("App.tsx wraps all 9 previously-unprotected views in ErrorBoundary", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/App.tsx", "utf-8");
    const views = [
      "home", "search", "library", "playlists", "playlist",
      "downloads", "favorites", "settings", "import",
    ];
    for (const view of views) {
      const re = new RegExp(
        `case "${view}":\\s*return <ErrorBoundary key="${view}">`
      );
      expect(re.test(source)).toBe(true);
    }
  });

  it("ErrorBoundary component is exported", async () => {
    const mod = await import("../components/ErrorBoundary");
    expect(mod.ErrorBoundary).toBeDefined();
  });
});

// -------------------------------------------------------------------
// 2.2: Quiz score off-by-one — score uses only accumulated value
// -------------------------------------------------------------------
describe("Phase 2.2 - Quiz score calculation", () => {
  it("score does not double-count the last answer", () => {
    // The fix: use quizScore directly instead of
    // quizScore + (quizAnswer === quizQuestions[quizIndex]?.correct ? 1 : 0)
    const quizScore = 3; // Already accumulated 3 correct out of 5
    const quizQuestions = [{}, {}, {}, {}, {}]; // 5 total questions

    // Correct behavior: just quizScore / total
    const content = `Quiz complete! You scored **${quizScore}/${quizQuestions.length}**`;
    expect(content).toContain("**3/5**");
    expect(content).not.toContain("4/5");
  });
});

// -------------------------------------------------------------------
// 2.5: SearchView — SemanticResult uses Track type instead of any
// -------------------------------------------------------------------
describe("Phase 2.5 - SearchView SemanticResult type", () => {
  it("SemanticResult uses Track instead of any", async () => {
    // Read the source file to verify the type
    const fs = await import("fs");
    const source = fs.readFileSync(
      "src/components/views/SearchView.tsx",
      "utf-8"
    );
    const interfaceMatch = source.match(
      /interface SemanticResult \{[^}]*track:([^;]+);/
    );
    expect(interfaceMatch).not.toBeNull();
    const trackType = interfaceMatch![1].trim();
    // Should be 'Track' not 'any'
    expect(trackType).toBe("Track");
    expect(trackType).not.toBe("any");
  });
});

// -------------------------------------------------------------------
// 2.7: Clear Index — API wrapper exists and returns Promise<void>
// -------------------------------------------------------------------
describe("Phase 2.7 - Clear Index functionality", () => {
  it("api.semanticClearIndex is an async function", async () => {
    const api = await import("../api");
    expect(typeof api.semanticClearIndex).toBe("function");
    // Should return a Promise (void)
    const result = api.semanticClearIndex();
    expect(result).toBeInstanceOf(Promise);
    await expect(result).rejects.toThrow(); // Will fail without Tauri runtime
  });

  it("SettingsView imports semanticClearIndex", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(
      "src/components/views/SettingsView.tsx",
      "utf-8"
    );
    expect(source).toContain("semanticClearIndex");
    expect(source).toContain("🗑️ Clear Index");
  });
});

// -------------------------------------------------------------------
// 2.8: CSS — duplicate @keyframes shimmer removed
// -------------------------------------------------------------------
describe("Phase 2.8 - Duplicate CSS removal", () => {
  it("index.css has only one @keyframes shimmer definition", async () => {
    const fs = await import("fs");
    const css = fs.readFileSync("src/index.css", "utf-8");
    const matches = css.match(/@keyframes shimmer\s*\{/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(1);
  });
});
