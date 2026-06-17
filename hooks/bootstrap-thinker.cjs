const fs = require("fs");
const path = require("path");

let input;
try {
  input = JSON.parse(fs.readFileSync(0, "utf-8"));
} catch {
  process.exit(0);
}

const cwd = input.cwd;
if (!cwd) process.exit(0);

const mcpPath = path.join(cwd, ".mcp.json");
try {
  const mcp = JSON.parse(fs.readFileSync(mcpPath, "utf-8"));
  if (!mcp.mcpServers?.thinker) process.exit(0);
} catch {
  process.exit(0);
}

// Thinker is configured — check if memory_context was already called
const transcript = input.transcript_path;
if (transcript) {
  try {
    const content = fs.readFileSync(transcript, "utf-8");
    if (content.includes("memory_context")) process.exit(0);
  } catch {
    // Transcript doesn't exist yet on first prompt — inject anyway
  }
}

const output = {
  hookSpecificOutput: {
    hookEventName: "UserPromptSubmit",
    additionalContext:
      "Thinker MCP is connected. Call memory_context NOW before doing any work. " +
      "Then call memory_query with keywords relevant to the user's request. " +
      "Thinker gives you persistent memory across sessions — use it.",
  },
};

process.stdout.write(JSON.stringify(output));
process.exit(0);
