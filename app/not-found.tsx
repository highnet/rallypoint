import Link from "next/link";

import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main className="not-found" id="main">
        <p className="not-found-code">
          <code>404</code>
        </p>
        <h1>No page at this address.</h1>
        <p className="lede">
          The link may be out of date. The loop, every role contract, and the docs are one step away.
        </p>
        <p className="not-found-links">
          <Link className="btn btn-primary" href="/">
            Back to the loop
          </Link>
          <Link className="text-link" href="/docs">
            Read the docs
          </Link>
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
