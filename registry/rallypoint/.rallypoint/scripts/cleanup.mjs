#!/usr/bin/env node

// Releases the reservation for a closed issue. The refusal to release one for an
// open issue lives in `lib/cleanup.mjs`; this file supplies argv, the parsed
// config, and a transport.

import process from "node:process";

import { cleanup } from "./lib/cleanup.mjs";
import { loadConfig, resolveTransport } from "./lib/gh.mjs";

process.exit(
  cleanup({ argv: process.argv.slice(2), config: loadConfig(), gh: resolveTransport() }),
);
