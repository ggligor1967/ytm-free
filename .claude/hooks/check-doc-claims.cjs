#!/usr/bin/env node
"use strict";

// PreToolUse (Edit|Write) — warns, never blocks, when a docs/**/*.md or
// README.md edit introduces unproven success-claim language.
// Enforces AGENT_BRIEF.md hard rule #1: no "production-ready"/"all tests
// pass"/"done" claims without pasted command output from this session.

const PATTERNS = [
  { re: /production[- ]ready/i, label: "production-ready" },
  { re: /all tests pass/i, label: "all tests pass" },
  { re: /fully implemented/i, label: "fully implemented" },
  { re: /completely done/i, label: "completely done" },
  { re: /✅/, label: "✅ next to a status claim" },
];

function isTargetDoc(filePath) {
  if (!filePath) return false;
  const norm = filePath.replace(/\\/g, "/");
  if (/\/docs\/.*\.md$/i.test(norm)) return true;
  if (/(^|\/)readme\.md$/i.test(norm)) return true;
  return false;
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

  const toolName = input.tool_name;
  const toolInput = input.tool_input || {};
  const filePath = toolInput.file_path;

  if (!isTargetDoc(filePath)) process.exit(0);

  let text = "";
  if (toolName === "Write") text = toolInput.content || "";
  else if (toolName === "Edit") text = toolInput.new_string || "";
  else process.exit(0);

  const hits = PATTERNS.filter((p) => p.re.test(text)).map((p) => p.label);
  if (hits.length === 0) process.exit(0);

  const msg =
    `[quality-gate] ${filePath} adds success-claim language (${hits.join(", ")}) without pasted proof. ` +
    `AGENT_BRIEF.md hard rule #1: never claim "production-ready"/"all tests pass"/"done" without command output from this session. ` +
    `Status claims belong in PROJECT_STATE.md, dated, with evidence.`;

  process.stdout.write(
    JSON.stringify({
      systemMessage: "⚠️ " + msg,
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        additionalContext: msg,
      },
    })
  );
  process.exit(0);
});
