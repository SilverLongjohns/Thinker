const { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } = require("fs");
const { join } = require("path");
const { homedir } = require("os");

const claudeDir = join(homedir(), ".claude");
const hooksDir = join(claudeDir, "hooks");
const settingsPath = join(claudeDir, "settings.json");

const hooks = [
  { file: "require-memory-context.cjs", event: "PreToolUse", matcher: "Edit|Write|NotebookEdit" },
  { file: "bootstrap-thinker.cjs", event: "UserPromptSubmit" },
];

mkdirSync(hooksDir, { recursive: true });

for (const hook of hooks) {
  const src = join(__dirname, hook.file);
  const dest = join(hooksDir, hook.file);
  copyFileSync(src, dest);
  console.log("Copied " + hook.file + " to " + dest);
}

let settings = {};
if (existsSync(settingsPath)) {
  try {
    settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
  } catch {
    console.error("Could not parse existing " + settingsPath + " — aborting.");
    process.exit(1);
  }
}

if (!settings.hooks) settings.hooks = {};

for (const hook of hooks) {
  const dest = join(hooksDir, hook.file);
  const entry = {
    hooks: [{ type: "command", command: "node " + dest, timeout: 5 }],
  };
  if (hook.matcher) entry.matcher = hook.matcher;

  if (!settings.hooks[hook.event]) settings.hooks[hook.event] = [];

  const existingIdx = settings.hooks[hook.event].findIndex(
    (e) => e.hooks?.some((h) => h.command?.includes(hook.file))
  );

  if (existingIdx >= 0) {
    settings.hooks[hook.event][existingIdx] = entry;
  } else {
    settings.hooks[hook.event].push(entry);
  }
}

writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
console.log("\nUpdated " + settingsPath);
console.log("\nDone. Restart Claude Code for hooks to take effect.");
console.log("Hooks only activate in projects where thinker is connected.");
