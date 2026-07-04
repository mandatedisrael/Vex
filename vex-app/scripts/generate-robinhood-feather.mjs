/**
 * One-shot asset generator: rasterize the Robinhood feather glyph into a
 * white-on-transparent PNG that `VexSigil` can SAMPLE (it reads pixel alpha on
 * a 220px grid to seed the particle constellation, so the source only needs a
 * clean alpha silhouette — the particle colors come from the sigil `palette`
 * prop, not the image).
 *
 * Source:  src/renderer/public/logo/robinhood.svg  (white feather, transparent)
 * Output:  src/renderer/public/logo/robinhood-feather.png  (500x500, matches
 *          logo_clean.png ergonomics — square, alpha silhouette centered)
 *
 * NOT part of any build step. Committed PNG is the shipped asset; re-run this
 * only when the source feather changes:
 *   node scripts/generate-robinhood-feather.mjs
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const logoDir = resolve(here, "../src/renderer/public/logo");
const sourceSvg = resolve(logoDir, "robinhood.svg");
const outputPng = resolve(logoDir, "robinhood-feather.png");

/** Square canvas — mirrors logo_clean.png (500x500) so VexSigil's cover-fit
 * and 220px sampler behave identically for both marks. */
const CANVAS = 500;
/** Feather height inside the canvas; the rest is transparent padding so the
 * silhouette sits centered with breathing room (like the monogram's margin). */
const FEATHER_HEIGHT = 430;

async function main() {
  const svg = readFileSync(sourceSvg);
  const feather = await sharp(svg, { density: 400 })
    .resize({ height: FEATHER_HEIGHT })
    .png()
    .toBuffer();

  await sharp({
    create: {
      width: CANVAS,
      height: CANVAS,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: feather, gravity: "center" }])
    .png()
    .toFile(outputPng);

  const meta = await sharp(outputPng).metadata();
  console.log(`wrote ${outputPng} (${meta.width}x${meta.height}, ${meta.channels}ch)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
