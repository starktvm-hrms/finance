// Minimal reference backend for Agency Finance (no dependencies).
// Stores the whole dataset as one JSON file. Good for a single team / VPS.
//
//   API_TOKEN=change-me PORT=8787 node server/index.mjs
//
// Then build the app with:
//   VITE_API_URL=https://yoursite.com/api/finance VITE_API_TOKEN=change-me npm run build
//
// NOTE: VITE_API_TOKEN ends up in the browser bundle, so only use this behind
// your own login (e.g. an admin area of your website) — see README.
import { createServer } from "node:http";
import { readFile, writeFile, rename } from "node:fs/promises";

const PORT = Number(process.env.PORT || 8787);
const FILE = process.env.DATA_FILE || new URL("./data.json", import.meta.url).pathname;
const TOKEN = process.env.API_TOKEN || "";
const ORIGIN = process.env.ALLOWED_ORIGIN || "*";
const MAX_BYTES = 10 * 1024 * 1024;

const send = (res, status, body) => {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": ORIGIN,
    "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  });
  res.end(body === undefined ? "" : JSON.stringify(body));
};

createServer(async (req, res) => {
  if (req.method === "OPTIONS") return send(res, 204);
  if (TOKEN && req.headers.authorization !== `Bearer ${TOKEN}`) return send(res, 401, { error: "unauthorized" });

  if (req.method === "GET") {
    try {
      return send(res, 200, JSON.parse(await readFile(FILE, "utf8")));
    } catch {
      return send(res, 404, { error: "no data yet" });
    }
  }

  if (req.method === "PUT") {
    let size = 0;
    const chunks = [];
    for await (const c of req) {
      size += c.length;
      if (size > MAX_BYTES) return send(res, 413, { error: "too large" });
      chunks.push(c);
    }
    try {
      const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!data || !Array.isArray(data.invoices) || !data.settings) throw new Error("invalid shape");
      await writeFile(FILE + ".tmp", JSON.stringify(data));
      await rename(FILE + ".tmp", FILE);
      return send(res, 204);
    } catch (e) {
      return send(res, 400, { error: String(e.message || e) });
    }
  }

  send(res, 405, { error: "method not allowed" });
}).listen(PORT, () => console.log(`Agency Finance API on http://localhost:${PORT}`));
