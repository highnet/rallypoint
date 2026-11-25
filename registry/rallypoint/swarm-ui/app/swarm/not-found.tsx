import Link from "next/link";

export default function SwarmNotFound() {
  return (
    <div className="rp-panel" role="status">
      <h2>Not found</h2>
      <p>There is nothing recorded under that address.</p>
      <p>
        <Link href="/swarm">Back to progress</Link>
      </p>
    </div>
  );
}
