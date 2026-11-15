// Serves the page on http://localhost:8080 (or $PORT), with the tiles in fixtures/tiles at the
// path the page fetches them from, so the page can be tried with made-up cells. A tile with no
// fixture is a 404, as a tile with no published cells is in the bucket.
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join } from "node:path";

const here = import.meta.dirname;
const TILES = "/v0/b/cellsignalmapper-a9da1.firebasestorage.app/o/";
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".json": "application/json" };

function fileFor(pathname) {
  if (pathname.startsWith(TILES)) {
    const tile = /^tiles\/([0-9a-f]+)\.json$/.exec(decodeURIComponent(pathname.slice(TILES.length)));
    return tile && join(here, "fixtures", "tiles", `${tile[1]}.json`);
  }
  const name = pathname === "/" ? "index.html" : pathname.slice(1);
  return /^[\w-]+\.(html|js)$/.test(name) ? join(here, "public", name) : null;
}

const port = Number(process.env.PORT ?? 8080);
createServer(async (request, response) => {
  const file = fileFor(new URL(request.url, "http://localhost").pathname);
  try {
    const body = await readFile(file);
    response.writeHead(200, { "Content-Type": TYPES[extname(file)] });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end();
  }
}).listen(port, "127.0.0.1", () => console.log(`http://localhost:${port}/#13/-22.9/-44.1`));
