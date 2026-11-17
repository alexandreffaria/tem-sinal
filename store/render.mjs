// Renders the Play Store images into store/: the feature graphic and the phone screenshots, and
// copies the icon. Usage: node store/render.mjs <folder with the app screens>, the folder
// StoreScreensTest wrote the app screens and the launcher icon into; scripts/store-assets.sh runs
// both. The map screenshots are the public map page served by map/serve.js with the made-up cells
// of store/fixtures.mjs; the background map comes from OpenFreeMap, so this needs the internet.
import { spawn } from "node:child_process";
import { copyFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { launch } from "./chrome.mjs";
import { ZOOMED_IN, cells, writeFixtures } from "./fixtures.mjs";

const h3 = createRequire(import.meta.url)("../map/node_modules/h3-js");
const here = import.meta.dirname;
const screens = process.argv[2];
if (!screens) throw new Error("Usage: node store/render.mjs <folder with the app screens>");

const BLUE = "#2c7bb6";
const PORT = 8766;
const MAP_URL = "alexandreffaria.github.io/tem-sinal";
/**
 * The phone the screens are drawn for: 400 dp wide at 3 px per dp, as in StoreScreensTest, whose
 * screens are 866 dp tall. The map is 816 px tall, the screen less the browser's address bar.
 */
const PHONE = { width: 400, height: 816, scale: 3 };

/** The signal bars of the map page's favicon, white on blue: the app's mark. */
const bars = (fill) => `
  <g fill="${fill}">
    <rect x="1" y="11" width="3" height="4" rx=".5"/><rect x="5" y="8" width="3" height="7" rx=".5"/>
    <rect x="9" y="5" width="3" height="10" rx=".5"/><rect x="13" y="1" width="2.5" height="14" rx=".5"/>
  </g>`;

const FONT = `<link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@500;700;800&display=block" rel="stylesheet">`;

function html(width, height, body, style = "") {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">${FONT}<style>
    * { box-sizing: border-box; }
    html, body { margin: 0; width: ${width}px; height: ${height}px; overflow: hidden; }
    body { font-family: Inter, sans-serif; }
    ${style}</style></head><body>${body}</body></html>`;
}

/** A honeycomb of pointy-top hexagons, as the map draws cells, coloured by the map's labels. */
function honeycomb() {
  const colours = { s: "#7cbbe9", e: "#fdae61", n: "#d6604d" };
  const rows = [" sse", "ssen", " sen"];
  const w = 84, h = 97, gap = 8;
  return rows.flatMap((row, r) => [...row].map((c, i) => c === " " ? "" :
    `<i style="left:${i * (w + gap) - (r % 2) * (w + gap) / 2}px; top:${r * (0.75 * h + gap)}px; background:${colours[c]}"></i>`)).join("");
}

const FEATURE = html(1024, 500, `
  <svg class="ridge" viewBox="0 0 1024 170" preserveAspectRatio="none">
    <path d="M0 110 L150 40 L230 80 L380 0 L520 70 L600 45 L760 110 L870 60 L1024 100 L1024 170 L0 170 Z" fill="#1f5f8f"/>
    <path d="M0 140 L120 105 L300 150 L470 95 L640 140 L820 110 L1024 145 L1024 170 L0 170 Z" fill="#174a70"/>
  </svg>
  <div class="hexes">${honeycomb()}</div>
  <div class="text">
    <h1><svg viewBox="0 0 16 16">${bars("#fff")}</svg>Tem Sinal</h1>
    <p>Grave o sinal na trilha.<br>Veja cada operadora<br>no mapa do site.</p>
  </div>`, `
  body { background: linear-gradient(160deg, #3d93cf, ${BLUE} 60%, #2672a8); color: #fff; position: relative; }
  .ridge { position: absolute; left: 0; bottom: 0; width: 1024px; height: 170px; }
  .hexes { position: absolute; left: 610px; top: 100px; }
  .hexes i { position: absolute; width: 84px; height: 97px; opacity: .92;
    clip-path: polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%); }
  .text { position: absolute; left: 72px; top: 110px; width: 560px; }
  h1 { font-size: 88px; font-weight: 800; margin: 0; letter-spacing: -2px; display: flex; align-items: center; gap: 22px; }
  h1 svg { width: 68px; height: 68px; flex: none; }
  p { font-size: 32px; font-weight: 500; line-height: 1.25; margin: 16px 0 0; max-width: 470px; }`);

/** Status bar icons: signal, battery. */
const STATUS = `<span>10:00</span><span class="icons"><svg viewBox="0 0 16 16">${bars("currentColor")}</svg>
  <svg viewBox="0 0 24 14"><rect x="1" y="1" width="19" height="12" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/>
  <rect x="4" y="4" width="11" height="6" rx="1" fill="currentColor"/><rect x="21" y="5" width="2" height="4" rx="1" fill="currentColor"/></svg></span>`;

/**
 * A 1080 x 1920 screenshot: [caption] over a phone showing [screen]; [dialog] over it with the
 * scrim when given, centred on the screen below the status bar, as the app centres it; in a
 * browser with the map's address when [browser].
 */
function framed(caption, screen, { dialog, browser } = {}) {
  const url = (file) => pathToFileURL(file).href;
  return html(1080, 1920, `
    <h2>${caption}</h2>
    <div class="phone"><div class="glass">
      <div class="status">${STATUS}</div>
      ${browser ? `<div class="bar"><span class="lock">🔒</span>${MAP_URL}</div>` : ""}
      <div class="screen"><img src="${url(screen)}">
        ${dialog ? `<div class="over"><img src="${url(dialog)}"></div>` : ""}</div>
      ${dialog ? `<div class="scrim"></div>` : ""}
    </div></div>`, `
    body { background: linear-gradient(170deg, #3d93cf, ${BLUE} 45%, #1f5f8f); color: #fff; }
    h2 { position: absolute; left: 70px; right: 70px; top: 70px; height: 260px; margin: 0; display: flex;
      align-items: center; justify-content: center; text-align: center; text-wrap: balance;
      font-size: 68px; line-height: 1.15; font-weight: 800; letter-spacing: -1px; }
    .phone { position: absolute; left: 197px; top: 380px; width: 686px; height: 1500px; padding: 18px;
      background: #111; border-radius: 76px; box-shadow: 0 30px 80px rgba(0,0,0,.35); }
    .glass { position: relative; width: 100%; height: 100%; border-radius: 60px; overflow: hidden; background: #f8f8fd;
      display: flex; flex-direction: column; }
    .status { flex: none; height: 56px; padding: 0 44px; display: flex; align-items: center;
      justify-content: space-between; color: #1b1b1f; font-size: 26px; font-weight: 500; }
    .status .icons { display: flex; gap: 12px; align-items: center; }
    .status svg { height: 24px; width: auto; }
    .bar { flex: none; margin: 4px 22px 14px; height: 64px; border-radius: 32px; background: #e9e9ef;
      display: flex; align-items: center; gap: 12px; padding: 0 28px; color: #333; font-size: 26px; }
    .bar .lock { font-size: 20px; filter: grayscale(1); }
    .screen { flex: 1; overflow: hidden; position: relative; }
    .screen > img { width: 100%; display: block; }
    .scrim { position: absolute; inset: 0; z-index: 1; background: rgba(0,0,0,.4); }
    .over { position: absolute; inset: 0; z-index: 2; display: flex; align-items: center; justify-content: center; }
    .over img { width: 88%; }`);
}

/** Renders [page] at [width] x [height] and writes it to store/[name]. */
async function shoot(chrome, work, name, width, height, page) {
  const file = join(work, `${name}.html`);
  await writeFile(file, page);
  await chrome.viewport(width, height, 1);
  await chrome.open(pathToFileURL(file).href);
  await chrome.evaluate("document.fonts.ready.then(() => Promise.all([...document.images].map((i) => i.decode())))");
  await writeFile(join(here, name), await chrome.png());
}

/** Opens the map at [hash] on the phone and waits until its cells and background have drawn. */
async function openMap(chrome, view, hash) {
  await chrome.viewport(PHONE.width, PHONE.height, PHONE.scale);
  await chrome.open(`http://localhost:${PORT}/?${view}#${hash}`);
  await chrome.waitFor(`document.getElementById("status").textContent === "" && !document.getElementById("carrier").disabled`, 60_000);
  await sleep(5000);
}

async function main() {
  const work = await mkdtemp(join(tmpdir(), "store-"));
  await writeFixtures(join(work, "fixtures"));
  const server = spawn(process.execPath, [join(here, "../map/serve.js")], {
    env: { ...process.env, PORT: String(PORT), FIXTURES: join(work, "fixtures") }, stdio: "ignore",
  });
  let chrome;
  try {
    chrome = await launch();
    await sleep(500);
    // The popup opens above the cell clicked, so that cell sits low enough for it to clear the
    // legend: the view is centred [POPUP_DROP] px above a cell in the middle of the first trail.
    const trail = cells().filter((cell) => h3.greatCircleDistance(h3.cellToLatLng(cell.h3), ZOOMED_IN.start, "km") < 4);
    const [lat, lon] = h3.cellToLatLng(trail[Math.floor(trail.length * 0.55)].h3);
    const POPUP_DROP = 250;
    const popupZoom = 15.4;
    const degreesPerPx = (360 / (512 * 2 ** popupZoom)) * Math.cos((lat * Math.PI) / 180);
    const vivo = `document.getElementById("carrier").value = "72406";
      document.getElementById("carrier").dispatchEvent(new Event("change"))`;
    await openMap(chrome, "map-in", `14.3/${lat}/${lon}`);
    await chrome.evaluate(vivo);
    await sleep(1000);
    await writeFile(join(work, "map-in.png"), await chrome.png());
    await openMap(chrome, "map-out", "9.2/-22.94/-44.17");
    await writeFile(join(work, "map-out.png"), await chrome.png());
    await openMap(chrome, "map-popup", `${popupZoom}/${lat + POPUP_DROP * degreesPerPx}/${lon}`);
    await chrome.click(PHONE.width / 2, PHONE.height / 2 + POPUP_DROP);
    await chrome.waitFor(`document.querySelector(".maplibregl-popup")`);
    await sleep(500);
    await writeFile(join(work, "map-popup.png"), await chrome.png());

    await copyFile(join(screens, "icon.png"), join(here, "icon-512.png"));
    await shoot(chrome, work, "feature-1024x500.png", 1024, 500, FEATURE);
    const app = (name) => join(screens, `${name}.png`);
    const map = (name) => join(work, `${name}.png`);
    const phones = [
      framed("Grave o sinal na trilha, mesmo sem internet", app("logging")),
      framed("No mapa do site, veja onde cada operadora pega", map("map-in"), { browser: true }),
      framed("Compare as operadoras em cada trecho", map("map-popup"), { browser: true }),
      framed("Olhe a região toda antes de sair", map("map-out"), { browser: true }),
      framed("Apague suas gravações quando quiser", app("recordings"), { dialog: app("recordings-dialog") }),
      framed("O app lembra: comece a gravar longe de casa", app("first-log"), { dialog: app("first-log-dialog") }),
    ];
    for (const [i, page] of phones.entries()) await shoot(chrome, work, `phone-${i + 1}.png`, 1080, 1920, page);
  } finally {
    await chrome?.close();
    server.kill();
    await rm(work, { recursive: true, force: true });
  }
}

await main();
