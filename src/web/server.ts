import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, resolveDbPath } from "../config.js";
import { openDatabase, closeDatabase } from "../db.js";
import { getMemories, getStats } from "./routes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function jsonResponse(res: http.ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function startServer(port: number): void {
  const config = loadConfig();
  const dbPath = resolveDbPath(config);
  const db = openDatabase(dbPath);

  const htmlPath = path.resolve(__dirname, "..", "..", "src", "web", "index.html");
  const html = fs.readFileSync(htmlPath, "utf-8");

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);

    if (url.pathname === "/" || url.pathname === "/index.html") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(html);
      return;
    }

    if (url.pathname === "/api/memories") {
      try {
        jsonResponse(res, 200, getMemories(db, url.searchParams));
      } catch (err) {
        jsonResponse(res, 500, { error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }

    if (url.pathname === "/api/stats") {
      try {
        jsonResponse(res, 200, getStats(db));
      } catch (err) {
        jsonResponse(res, 500, { error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }

    jsonResponse(res, 404, { error: "Not found" });
  });

  process.on("SIGINT", () => {
    closeDatabase(db);
    server.close();
    process.exit(0);
  });

  server.listen(port, () => {
    console.log(`Thinker web UI running at http://localhost:${port}`);
  });
}

startServer(parseInt(process.env.PORT ?? "3000", 10));
