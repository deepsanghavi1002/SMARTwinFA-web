import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const css = read("app/responsive.css");
const page = read("app/page.tsx");
const layout = read("app/layout.tsx");

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(`http://localhost${path}`, { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("the page declares a mobile viewport that is device-width and keeps zoom on", async () => {
  const html = await (await render()).text();
  const meta = html.match(/<meta name="viewport" content="([^"]*)"/)?.[1] ?? "";
  assert.match(meta, /width=device-width/);
  assert.match(meta, /initial-scale=1/);
  assert.doesNotMatch(meta, /maximum-scale|user-scalable=no/, "pinch-zoom stays available for reading wide reports");
});

test("the responsive layer loads after every other stylesheet", () => {
  const imports = [...layout.matchAll(/import "\.\/([\w.-]+\.css)"/g)].map((match) => match[1]);
  assert.equal(imports.at(-1), "responsive.css");
  assert.ok(imports.indexOf("modern-ui.css") < imports.indexOf("responsive.css"));
});

test("the menu is an off-canvas drawer on small screens and the sidebar is left alone above them", () => {
  const phone = css.slice(css.indexOf("@media (max-width: 780px)"));
  assert.match(phone, /\.menu-bar \{[^}]*position: fixed[^}]*transform: translateX\(-102%\)/s);
  assert.match(phone, /\.menu-bar\.nav-open \{[^}]*transform: none/s);
  assert.match(phone, /\.nav-scrim \{/);
  // Nothing in the stylesheet reaches the desktop menu: the drawer's rules all sit inside a max-width media query.
  const before = css.slice(0, css.indexOf("@media (max-width: 780px)"));
  assert.doesNotMatch(before, /\.menu-bar \{|\.menu-root/);
  assert.match(before, /\.nav-toggle, \.nav-close, \.nav-scrim, \.bottom-nav[^{]*\{ display: none; \}/);
});

test("the drawer opens from the title bar and the bottom bar and closes the ways drawers do", () => {
  assert.match(page, /className="nav-toggle"[^>]*aria-expanded=\{navOpen\}[^>]*aria-controls="app-nav"/);
  assert.match(page, /id="app-nav"/);
  assert.match(page, /className="nav-scrim"/);
  assert.match(page, /event\.key !== "Escape"/);
  // Choosing a screen and going home both run closeMenus, which closes the drawer.
  assert.match(page, /const closeMenus = \(\) => \{[^}]*setNavOpen\(false\)/);
  // The rest of the window is inert while the drawer is open, so focus stays in it.
  assert.match(page, /<header className="title-bar" inert=\{navOpen\}/);
  assert.match(page, /<section inert=\{navOpen\} className=\{`work-area/);
  // Widening the window past the breakpoint closes it.
  assert.match(page, /matchMedia\("\(min-width: 781px\)"\)/);
  assert.match(page, /className="bottom-nav"/);
});

test("touch: 44px targets, no zoom-on-focus font sizes, safe areas, dynamic viewport height", () => {
  const touch = css.slice(css.indexOf("@media (pointer: coarse)"));
  assert.match(touch, /min-height: 44px/);
  assert.match(touch, /font-size: 16px/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /env\(safe-area-inset-left\)/);
  assert.match(css, /height: 100vh; height: 100dvh/);
  assert.match(layout, /viewportFit: "cover"/);
  assert.match(layout, /interactiveWidget: "resizes-content"/);
  for (const [, selector] of css.matchAll(/^\s+(html:not\(#r\)[^{]*)\{/gm)) assert.ok(selector.trim().length > 0);
});

test("reports pin their final total and put the Selection / Output tabs above the report on phones", () => {
  assert.match(css, /\.rp-total-pinned \{ display: none; \}/);
  assert.match(css, /\.rp-out-scroll \.rp-total-pinned \{[^}]*position: sticky/);
  assert.match(css, /\.rp-body \{ flex-direction: column-reverse; \}/);
  assert.match(read("features/report/OutputGrid.tsx"), /rp-total-pinned/);
});
