#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = resolve(root, "registry/rallypoint");
const manifest = JSON.parse(
  await readFile(resolve(root, "registry/manifest.json"), "utf8"),
);

const builtItems = [];

for (const item of manifest.items) {
  const files = await Promise.all(
    item.files.map(async (file) => {
      const content = await readFile(resolve(sourceRoot, file.source), "utf8");
      return {
        path: file.target,
        executable: file.executable === true,
        sha256: createHash("sha256").update(content).digest("hex"),
        content,
      };
    }),
  );

  builtItems.push({
    schemaVersion: manifest.schemaVersion,
    name: item.name,
    version: item.version,
    description: item.description,
    files,
  });
}

const index = {
  schemaVersion: manifest.schemaVersion,
  name: manifest.name,
  items: builtItems.map(({ name, version, description, files }) => ({
    name,
    version,
    description,
    fileCount: files.length,
  })),
};

const targets = [
  resolve(root, "public/registry"),
  resolve(root, "packages/cli/registry"),
];

for (const target of targets) {
  await mkdir(target, { recursive: true });
  await writeFile(
    resolve(target, "index.json"),
    `${JSON.stringify(index, null, 2)}\n`,
  );
  for (const item of builtItems) {
    await writeFile(
      resolve(target, `${item.name}.json`),
      `${JSON.stringify(item, null, 2)}\n`,
    );
  }
}

console.log(
  `Built ${builtItems.length} Rallypoint registry item (${builtItems[0].files.length} files).`,
);
