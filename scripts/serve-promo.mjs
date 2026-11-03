import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { assertDestination } from "./promo-manifest.mjs";
import { promoIdentityPath } from "./preview-config.mjs";

await import("./build-promo.mjs");
const mime = {
  html: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  png: "image/png",
  webp: "image/webp",
  svg: "image/svg+xml",
};
createServer(async (req, res) => {
  try {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { Allow: "GET, HEAD" }).end();

      return;
    }
    const url = new URL(req.url, "http://127.0.0.1:5175");
    let path = url.pathname;
    if (path === promoIdentityPath) {
      res
        .writeHead(200, { "Content-Type": "text/plain", "Cache-Control": "no-store" })
        .end("voltura-places-promo");

      return;
    }
    if (path === "/places" || path === "/places/sv") {
      res.writeHead(302, { Location: path + "/" + url.search }).end();

      return;
    }
    if (path.endsWith("/")) {
      path += "index.html";
    }
    assertDestination(path.slice(1));
    const file = ".artifacts/promo/" + path.slice("/places/".length);
    const bytes = req.method === "GET" ? await readFile(file) : null;
    const length = bytes?.length ?? (await stat(file)).size;
    res
      .writeHead(200, {
        "Content-Type": mime[path.split(".").at(-1)] ?? "application/octet-stream",
        "Cache-Control": "no-store",
        "Content-Length": length,
      })
      .end(bytes);
  } catch {
    res.writeHead(404).end("Not found");
  }
}).listen(5175, "127.0.0.1", () => console.log("Promo preview: http://127.0.0.1:5175/places/"));
