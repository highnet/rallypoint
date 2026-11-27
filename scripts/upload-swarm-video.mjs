/*
 * Uploads a narrated Swarm film straight to Mux (direct upload) and records
 * its playback ID in lib/swarm-demo-video.json, which /swarm reads
 * (components/swarm-demo-video.tsx). Mux streams it adaptively (HLS) and
 * serves the poster from its own thumbnail endpoint, so nothing else hosts it.
 *
 *   MUX_TOKEN_ID=... MUX_TOKEN_SECRET=... npm run upload-swarm-video -- --short rallypoint-swarm-90s-16x9.mp4
 *   MUX_TOKEN_ID=... MUX_TOKEN_SECRET=... npm run upload-swarm-video -- --full rallypoint-swarm-full-run.mp4
 *
 * Optional: --poster-time <seconds> picks the thumbnail frame (default 3).
 * The token comes from the Mux dashboard (Settings → Access Tokens, with Mux
 * Video read and write). Commit lib/swarm-demo-video.json and deploy.
 */
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const manifest = path.join(here, "..", "lib", "swarm-demo-video.json");

const { MUX_TOKEN_ID, MUX_TOKEN_SECRET } = process.env;
if (!MUX_TOKEN_ID || !MUX_TOKEN_SECRET) {
  console.error("Set MUX_TOKEN_ID and MUX_TOKEN_SECRET (Mux dashboard → Settings → Access Tokens).");
  process.exit(1);
}

const args = process.argv.slice(2);
const value = (flag) => {
  const at = args.indexOf(flag);
  return at > -1 ? args[at + 1] : null;
};
const which = value("--full") ? "full" : value("--short") ? "short" : null;
const film = value("--full") ?? value("--short");
const posterTime = Number(value("--poster-time") ?? 3);
if (!which || !film || !existsSync(film)) {
  console.error("Pass --full <film.mp4> or --short <film.mp4>.");
  process.exit(1);
}

const auth = `Basic ${Buffer.from(`${MUX_TOKEN_ID}:${MUX_TOKEN_SECRET}`).toString("base64")}`;
const mux = async (method, route, body) => {
  const res = await fetch(`https://api.mux.com/video/v1/${route}`, {
    method,
    headers: { authorization: auth, "content-type": "application/json" },
    body: body && JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Mux ${method} ${route}: ${res.status} ${JSON.stringify(json)}`);
  return json.data;
};
const wait = () => new Promise((r) => setTimeout(r, 5000));

// 1. A direct-upload URL, 2. PUT the file to it, 3. wait for the asset.
const upload = await mux("POST", "uploads", {
  cors_origin: "*",
  new_asset_settings: {
    playback_policies: ["public"],
    // Terminal and screen text stays sharp with the higher-quality encode.
    video_quality: "plus",
    max_resolution_tier: "1080p",
    passthrough: `rallypoint-swarm ${which}`,
  },
});
console.log(`${which}: uploading ${path.basename(film)} (${(statSync(film).size / 1e6).toFixed(1)} MB)`);
const put = await fetch(upload.url, { method: "PUT", headers: { "content-type": "video/mp4" }, body: readFileSync(film) });
if (!put.ok) throw new Error(`Upload failed: ${put.status} ${await put.text()}`);

let assetId = null;
while (!assetId) {
  const u = await mux("GET", `uploads/${upload.id}`);
  if (u.status === "errored" || u.status === "cancelled") throw new Error(`Upload ${u.status}: ${JSON.stringify(u.error)}`);
  assetId = u.asset_id;
  if (!assetId) await wait();
}
let playbackId = null;
while (!playbackId) {
  const asset = await mux("GET", `assets/${assetId}`);
  if (asset.status === "errored") throw new Error(`Mux could not encode it: ${JSON.stringify(asset.errors)}`);
  if (asset.status === "ready") playbackId = asset.playback_ids.find((p) => p.policy === "public").id;
  else await wait();
}

const current = JSON.parse(readFileSync(manifest, "utf8"));
current[which] = {
  playbackId,
  poster: `https://image.mux.com/${playbackId}/thumbnail.png?time=${posterTime}&width=1920`,
};
writeFileSync(manifest, JSON.stringify(current, null, 2) + "\n");
console.log(`${which}: ready, playback ${playbackId}. Wrote ${path.relative(process.cwd(), manifest)}. Commit it and deploy.`);
