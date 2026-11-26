/*
 * Copies the Swarm films already on Vercel Blob (lib/swarm-demo-video.json)
 * to Mux and records each one's playback ID next to its MP4, so /swarm
 * streams them adaptively (HLS) instead of as one large file. Mux fetches
 * each MP4 from its Blob URL itself:
 *
 *   MUX_TOKEN_ID=... MUX_TOKEN_SECRET=... npm run mux-swarm-video [-- --all]
 *
 * Only cuts without a playbackId are copied; --all copies every cut again.
 * Commit lib/swarm-demo-video.json and deploy to publish.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const manifest = path.join(here, "..", "lib", "swarm-demo-video.json");

const { MUX_TOKEN_ID, MUX_TOKEN_SECRET } = process.env;
if (!MUX_TOKEN_ID || !MUX_TOKEN_SECRET) {
  console.error("Set MUX_TOKEN_ID and MUX_TOKEN_SECRET (Mux dashboard → Settings → Access Tokens).");
  process.exit(1);
}
const all = process.argv.includes("--all");
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

const current = JSON.parse(readFileSync(manifest, "utf8"));
const cuts = [
  ["full", current.full],
  ["short", current.short],
].filter(([, cut]) => cut && (all || !cut.playbackId));
if (!cuts.length) {
  console.log("Every cut already has a playbackId. Pass --all to copy them again.");
  process.exit(0);
}

const started = [];
for (const [name, cut] of cuts) {
  const asset = await mux("POST", "assets", {
    inputs: [{ url: cut.mp4 }],
    playback_policies: ["public"],
    // Terminal and screen text stays sharp with the higher-quality encode.
    video_quality: "plus",
    max_resolution_tier: "1080p",
    passthrough: `rallypoint-swarm ${name}`,
  });
  console.log(`${name}: asset ${asset.id}`);
  started.push([name, cut, asset.id]);
}
for (const [name, cut, id] of started) {
  for (;;) {
    const asset = await mux("GET", `assets/${id}`);
    if (asset.status === "errored") throw new Error(`${name}: Mux could not encode it: ${JSON.stringify(asset.errors)}`);
    if (asset.status === "ready") {
      cut.playbackId = asset.playback_ids.find((p) => p.policy === "public").id;
      console.log(`${name}: ready, playback ${cut.playbackId}`);
      break;
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
}
writeFileSync(manifest, JSON.stringify(current, null, 2) + "\n");
console.log(`Wrote ${path.relative(process.cwd(), manifest)}. Commit it and deploy.`);
