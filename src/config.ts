import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { DEFAULT_CONFIG, type ThinkerConfig } from "./types.js";

export function loadConfig(): ThinkerConfig {
  const configPath = path.join(os.homedir(), ".thinker", "config.json");

  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    return {
      db_path: parsed.db_path ?? DEFAULT_CONFIG.db_path,
      defaults: {
        query_token_budget:
          parsed.defaults?.query_token_budget ??
          DEFAULT_CONFIG.defaults.query_token_budget,
        context_token_budget:
          parsed.defaults?.context_token_budget ??
          DEFAULT_CONFIG.defaults.context_token_budget,
        max_content_length:
          parsed.defaults?.max_content_length ??
          DEFAULT_CONFIG.defaults.max_content_length,
      },
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function resolveDbPath(config: ThinkerConfig): string {
  const dbPath = config.db_path;
  if (dbPath.startsWith("~")) {
    return path.join(os.homedir(), dbPath.slice(1));
  }
  return dbPath;
}
