"use server";

import { ensureReaderSession } from "./session";

/** Returns only the result of renewal. Access and refresh tokens stay server-side. */
export async function renewReaderSession() {
  return (await ensureReaderSession(true)).status;
}
