// A headless Chrome driven over the DevTools protocol with Node's own WebSocket, so rendering the
// store images needs no npm package. CHROME names the browser; google-chrome-stable by default.
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

/** Starts Chrome and returns a page to drive; close() ends Chrome and deletes its profile. */
export async function launch() {
  const profile = await mkdtemp(join(tmpdir(), "store-chrome-"));
  const chrome = spawn(process.env.CHROME ?? "google-chrome-stable", [
    "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`,
    "--no-first-run", "--no-default-browser-check", "--hide-scrollbars", "--font-render-hinting=none",
    "about:blank",
  ], { stdio: "ignore" });
  let port;
  for (let i = 0; i < 100 && !port; i++) {
    await sleep(100);
    port = await readFile(join(profile, "DevToolsActivePort"), "utf8").then((s) => s.split("\n")[0], () => null);
  }
  if (!port) throw new Error("Chrome didn't start");
  const [target] = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).filter((t) => t.type === "page");
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let next = 0;
  const waiting = new Map();
  const listeners = new Set();
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.id !== undefined) {
      const { resolve, reject } = waiting.get(message.id);
      waiting.delete(message.id);
      if (message.error) reject(new Error(`${message.error.message}`));
      else resolve(message.result);
    } else {
      for (const listener of listeners) listener(message);
    }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = next++;
    waiting.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  await send("Page.enable");
  await send("Runtime.enable");

  const page = {
    send,
    /** Sets the viewport to [width] x [height] CSS pixels at [scale] device pixels each. */
    viewport: (width, height, scale = 1) =>
      send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: scale, mobile: scale > 1 }),
    /** Opens [url] and waits for its load event. */
    async open(url) {
      const loaded = new Promise((resolve) => {
        const listener = (message) => {
          if (message.method === "Page.loadEventFired") { listeners.delete(listener); resolve(); }
        };
        listeners.add(listener);
      });
      await send("Page.navigate", { url });
      await loaded;
    },
    /** The value of [expression], awaited when it is a promise. */
    async evaluate(expression) {
      const { result, exceptionDetails } = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
      return result.value;
    },
    /** Waits until [expression] is true, for at most [ms]. */
    async waitFor(expression, ms = 30_000) {
      for (const end = Date.now() + ms; Date.now() < end; await sleep(200)) if (await page.evaluate(expression)) return;
      throw new Error(`Timed out waiting for ${expression}`);
    },
    /** Clicks at ([x], [y]) in CSS pixels. */
    async click(x, y) {
      for (const type of ["mousePressed", "mouseReleased"]) {
        await send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
      }
    },
    /** A PNG of the viewport. */
    async png() {
      const { data } = await send("Page.captureScreenshot", { format: "png" });
      return Buffer.from(data, "base64");
    },
    async close() {
      socket.close();
      chrome.kill();
      await new Promise((resolve) => chrome.once("exit", resolve));
      await rm(profile, { recursive: true, force: true });
    },
  };
  return page;
}
