#!/usr/bin/env node
"use strict";

// PostToolUse (Edit|Write) — after editing src/**/*.ts(x), runs
// `npx tsc --noEmit` and surfaces failures as a warning. Non-blocking:
// implements .claude/skills/quality-gate/SKILL.md Gate A's first check eagerly, without gating
// the tool call on it.

const { execSync } = require("child_process");

function isTargetSource(filePath) {
  if (!filePath) return false;
  const norm = filePath.replace(/\\/g, "/");
  return /\/src\/.*\.tsx?$/i.test(norm);
}

let raw = "";
process.stdin.on("data", (chunk) => (raw += chunk));
process.stdin.on("end", () => {
  let input;
  try {
    input = JSON.parse(raw || "{}");
  } catch {
    process.exit(0);
  }

  const toolInput = input.tool_input || {};
  const filePath = toolInput.file_path || (input.tool_response && input.tool_response.filePath);

  if (!isTargetSource(filePath)) process.exit(0);

  const cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  let output = "";
  let failed = false;
  try {
    execSync("npx tsc --noEmit", { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    failed = true;
    output = (err.stdout || "") + (err.stderr || "");
  }

  if (!failed) process.exit(0);

  const trimmed = output.split(/\r?\n/).filter(Boolean).slice(0, 25).join("\n");
  const msg = `[quality-gate] npx tsc --noEmit reported errors after editing ${filePath}:\n${trimmed}`;

  process.stdout.write(
    JSON.stringify({
      systemMessage: "⚠️ TypeScript errors — see details",
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: msg,
      },
    })
  );
  process.exit(0);
});
