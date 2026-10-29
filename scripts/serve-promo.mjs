import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { assertDestination } from "./promo-manifest.mjs";
await import("./build-promo.mjs");
const mime = {
  html: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  png: "image/png",
  svg: "image/svg+xml",
};
createServer(async (req, res) => {
  try {
    let path = new URL(req.url, "http://127.0.0.1:5175").pathname;
    if (path === "/places" || path === "/places/sv") {
      res.writeHead(302, { Location: path + "/" }).end();
      return;
    }
    if (path.endsWith("/")) path += "index.html";
    assertDestination(path.slice(1));
    const bytes = await readFile(".artifacts/promo/" + path.slice("/places/".length));
    res
      .writeHead(200, {
        "Content-Type": mime[path.split(".").at(-1)] ?? "application/octet-stream",
        "Cache-Control": "no-store",
      })
      .end(bytes);
  } catch {
    res.writeHead(404).end("Not found");
  }
}).listen(5175, "127.0.0.1", () => console.log("Promo preview: http://127.0.0.1:5175/places/"));
