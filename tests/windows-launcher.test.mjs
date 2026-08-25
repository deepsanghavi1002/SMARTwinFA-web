import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const root = new URL("../", import.meta.url);
const read = (name) => readFile(new URL(`distribution/windows-launcher/${name}`, root), "utf8");

test("Windows launcher installs a desktop shortcut for the Pi-hosted app without database setup", async () => {
  const [run, install, uninstall, guide] = await Promise.all([
    read("Run-SMARTwinFA.cmd"), read("Install-SMARTwinFA.cmd"), read("Uninstall-SMARTwinFA.cmd"), read("README.md"),
  ]);

  assert.match(run, /APP_URL=http:\/\/pinas\.local:4173\//);
  assert.match(run, /--app="%APP_URL%"/);
  assert.match(install, /Run-SMARTwinFA\.cmd/);
  assert.match(install, /Desktop\\SMARTwinFA\.lnk/);
  assert.match(uninstall, /The Pi-hosted application and its data were not changed/);
  assert.match(guide, /does \*\*not\*\* install PostgreSQL/i);
});
