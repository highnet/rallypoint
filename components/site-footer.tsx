import Link from "next/link";

import { SignalFlag } from "@/components/signal-flag";
import { Wordmark } from "@/components/wordmark";
import { agents } from "@/lib/agents";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="footer-inner">
        <div className="footer-brand">
          <Wordmark />
          <p>GitHub is the only coordinator. MIT-licensed, agent-agnostic, nothing calls home.</p>
        </div>
        <nav aria-label="Role contracts" className="footer-roles">
          <p className="footer-heading">Role contracts</p>
          <ul>
            {agents.map((agent) => (
              <li key={agent.slug}>
                <Link href={`/agents/${agent.slug}`}>
                  <SignalFlag className="footer-flag" signal={agent.slug} />
                  {agent.name}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <nav aria-label="Footer" className="footer-links">
          <p className="footer-heading">Rallypoint</p>
          <ul>
            <li>
              <Link href="/docs">Documentation</Link>
            </li>
            <li>
              <Link href="/#install">Install</Link>
            </li>
            <li>
              <a href="https://www.npmjs.com/package/rallypoint">npm package</a>
            </li>
          </ul>
        </nav>
      </div>
    </footer>
  );
}
