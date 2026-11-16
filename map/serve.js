// Serves the page on http://localhost:8080 (or $PORT), with the tiles in fixtures/tiles and the
// overview in fixtures/overview (or in $FIXTURES) at the paths the page fetches them from, so the
// page can be tried with made-up cells. A file with no fixture is a 404, as one not published is in
// the bucket.
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join } from "node:path";

const here = import.meta.dirname;
const fixtures = process.env.FIXTURES ?? join(here, "fixtures");
const PUBLIC = "/v0/b/cellsignalmapper-a9da1.firebasestorage.app/o/";
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".json": "application/json" };

function fileFor(pathname) {
  if (pathname.startsWith(PUBLIC)) {
    const file = /^(tiles\/[0-9a-f]+|overview\/[0-9]+)\.json$/.exec(decodeURIComponent(pathname.slice(PUBLIC.length)));
    return file && join(fixtures, `${file[1]}.json`);
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
