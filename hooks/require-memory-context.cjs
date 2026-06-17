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

// Thinker is configured — check if memory_context was called
const transcript = input.transcript_path;
if (!transcript) {
  process.stderr.write(
    "Call memory_context from the thinker MCP server before making changes."
  );
  process.exit(2);
}

let content;
try {
  content = fs.readFileSync(transcript, "utf-8");
} catch {
  process.stderr.write(
    "Call memory_context from the thinker MCP server before making changes."
  );
  process.exit(2);
}

if (content.includes("memory_context")) {
  process.exit(0);
}

process.stderr.write(
  "Call memory_context from the thinker MCP server before making changes. " +
  "This loads session context from previous work."
);
process.exit(2);
