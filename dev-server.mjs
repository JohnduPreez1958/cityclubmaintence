// Local test server: `npm run dev` then open http://localhost:8888
// Stores data in the .data folder instead of Netlify Blobs.
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { handle } from "./lib/api.mjs";

const root = path.resolve("public");
const dataDir = path.resolve(".data");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };

function fileStore(name) {
  const dir = path.join(dataDir, name);
  const f = (k) => path.join(dir, k.replace(/[^a-z0-9]/gi, ""));
  return {
    getJSON: async (k) => JSON.parse(await fs.readFile(f(k), "utf8").catch(() => "null")),
    setJSON: async (k, v) => { await fs.mkdir(dir, { recursive: true }); await fs.writeFile(f(k), JSON.stringify(v)); },
    delete: async (k) => { await fs.rm(f(k), { force: true }); },
    listKeys: async () => (await fs.readdir(dir).catch(() => [])).filter((n) => !n.endsWith(".ct")),
    setBinary: async (k, buf, ct) => { await fs.mkdir(dir, { recursive: true }); await fs.writeFile(f(k), buf); await fs.writeFile(f(k) + ".ct", ct); },
    getBinary: async (k) => {
      try { return { data: await fs.readFile(f(k)), contentType: await fs.readFile(f(k) + ".ct", "utf8") }; } catch { return null; }
    },
  };
}
const stores = { jobs: fileStore("jobs"), photos: fileStore("photos"), settings: fileStore("settings"), recurring: fileStore("recurring"), env: process.env };

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname.startsWith("/api/")) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const r = await handle(new Request(url, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : body }), stores);
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
    return;
  }
  let p = path.join(root, url.pathname === "/" ? "index.html" : url.pathname);
  if (!p.startsWith(root)) { res.writeHead(403); return res.end(); }
  try {
    const data = await fs.readFile(p);
    res.writeHead(200, { "content-type": types[path.extname(p)] || "application/octet-stream" });
    res.end(data);
  } catch { res.writeHead(404); res.end("Not found"); }
}).listen(process.env.PORT || 8888, () => console.log("Running on http://localhost:" + (process.env.PORT || 8888)));
