/*
 * Uploads the narrated Swarm films to Vercel Blob and records their URLs in
 * lib/swarm-demo-video.json, which /swarm reads (components/swarm-demo-video.tsx).
 * The same pattern as variantly's homepage film.
 *
 *   BLOB_READ_WRITE_TOKEN=... npm run upload-swarm-video -- --full <film.mp4> [--poster <png>]
 *   BLOB_READ_WRITE_TOKEN=... npm run upload-swarm-video -- --short <film.mp4> [--poster <png>]
 *
 * Every upload gets a fresh URL (random suffix), so a re-cut film is never
 * hidden behind a cached old one. A replaced film loses its Mux playbackId,
 * so the page plays the new MP4 until `npm run mux-swarm-video` streams it
 * from Mux again. Commit lib/swarm-demo-video.json and deploy to publish.
 */
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { put } from "@vercel/blob";

const here = path.dirname(fileURLToPath(import.meta.url));
const manifest = path.join(here, "..", "lib", "swarm-demo-video.json");

if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.error("Set BLOB_READ_WRITE_TOKEN (Vercel dashboard → Storage → your Blob store).");
  process.exit(1);
}

const args = process.argv.slice(2);
const value = (flag) => {
  const at = args.indexOf(flag);
  return at > -1 ? args[at + 1] : null;
};
const which = value("--full") ? "full" : value("--short") ? "short" : null;
const film = value("--full") ?? value("--short");
const poster = value("--poster");
if (!which || !film || !existsSync(film)) {
  console.error("Pass --full <film.mp4> or --short <film.mp4> (and optionally --poster <png>).");
  process.exit(1);
}

const upload = async (file, name, contentType) => {
  console.log(`  ${path.basename(file)} (${(statSync(file).size / 1e6).toFixed(1)} MB)`);
  const blob = await put(`swarm/${name}`, readFileSync(file), {
    access: "public",
    addRandomSuffix: true,
    contentType,
    // Each URL is unique, so browsers and the CDN may keep it for a year.
    cacheControlMaxAge: 60 * 60 * 24 * 365,
    multipart: true,
  });
  return blob.url;
};

const base = which === "full" ? "rallypoint-swarm-full-run" : "rallypoint-swarm-90s";
const current = JSON.parse(readFileSync(manifest, "utf8"));
current[which] = {
  mp4: await upload(film, `${base}.mp4`, "video/mp4"),
  poster: poster && existsSync(poster) ? await upload(poster, `${base}-poster.png`, "image/png") : null,
};
writeFileSync(manifest, JSON.stringify(current, null, 2) + "\n");
console.log(`Wrote ${path.relative(process.cwd(), manifest)}. Commit it and deploy.`);
