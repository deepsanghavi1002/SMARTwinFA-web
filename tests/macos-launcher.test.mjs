import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const root = new URL("../", import.meta.url);
const read = (name) => readFile(new URL(`distribution/macos-launcher/${name}`, root), "utf8");

test("macOS launcher opens the public SMARTwinFA site without a local database", async () => {
  const [plist, launch, install, uninstall, guide] = await Promise.all([
    read("SMARTwinFA.app/Contents/Info.plist"), read("SMARTwinFA.app/Contents/MacOS/SMARTwinFA"), read("Install-SMARTwinFA.command"), read("Uninstall-SMARTwinFA.command"), read("README.md"),
  ]);

  assert.match(plist, /<string>APPL<\/string>/);
  assert.match(launch, /https:\/\/smart-winfa\.deepsanghavi\.org\//);
  assert.match(launch, /--app="\$APP_URL"/);
  assert.match(install, /APPLICATIONS_DIR="\$HOME\/Applications"/);
  assert.match(install, /APP_PATH="\$APPLICATIONS_DIR\/SMARTwinFA\.app"/);
  assert.match(uninstall, /hosted application and its data were not changed/);
  assert.match(guide, /does \*\*not\*\* install PostgreSQL/i);
});
