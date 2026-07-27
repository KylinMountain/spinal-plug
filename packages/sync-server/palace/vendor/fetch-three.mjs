#!/usr/bin/env node
/**
 * Vendors the pinned three.js module build next to this script so the palace
 * runs without any CDN dependency. Usage: node palace/vendor/fetch-three.mjs
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = "0.170.0";
const CANDIDATES = [
  `https://cdn.jsdelivr.net/npm/three@${VERSION}/build/three.module.min.js`,
  `https://unpkg.com/three@${VERSION}/build/three.module.min.js`,
  `https://cdn.jsdelivr.net/npm/three@${VERSION}/build/three.module.js`
];

const target = join(dirname(fileURLToPath(import.meta.url)), "three.module.js");

for (const url of CANDIDATES) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`skip ${url}: HTTP ${response.status}`);
      continue;
    }
    const content = await response.text();
    if (content.length < 100_000 || content.trimStart().startsWith("<")) {
      console.warn(`skip ${url}: payload does not look like the three.js build`);
      continue;
    }
    writeFileSync(target, content);
    console.log(`vendored three@${VERSION} (${content.length} bytes) from ${url}`);
    process.exit(0);
  } catch (error) {
    console.warn(`skip ${url}: ${error instanceof Error ? error.message : error}`);
  }
}
console.error("Could not vendor three.js from any candidate URL.");
process.exit(1);
