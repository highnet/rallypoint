import type { Metadata } from "next";
import Link from "next/link";

import { Empty, Gate, GithubProblem, PageHead, Section } from "../_components/states";
import { getSkills, getSwarmContext } from "../_lib/queries";

export const metadata: Metadata = { title: "Skills" };
export const dynamic = "force-dynamic";

export default async function SkillsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const selected = typeof params.file === "string" ? params.file : undefined;
  const context = await getSwarmContext();
  if (context.state !== "ok") return <Gate context={context} />;
  const { repo, folders, file } = await getSkills(selected);
  // One banner for the whole page: the three folders fail for the same reason.
  const firstError = folders.find((folder) => folder.error)?.error ?? null;

  return (
    <>
      <PageHead
        title="Skills"
        lede="The role prompts, skills and playbooks the swarm works from, read from the repository. The improver tunes these; the referee, review and merge rules stay frozen."
      />
      {firstError ? (
        <GithubProblem failure={firstError}>
          <p className="rp-soft">These files are read from the repository, so nothing below can be listed until then.</p>
        </GithubProblem>
      ) : null}
      {!repo ? null : (
        <>
          {folders.map((folder) => (
            <Section key={folder.path} lede={<code>{folder.path}/</code>} title={folder.label}>
              {folder.error ? (
                <p className="rp-soft">Not read: GitHub refused the request (see above). This is not an empty folder.</p>
              ) : folder.entries.length === 0 ? (
                <Empty>No files here yet.</Empty>
              ) : (
                <ul className="rp-list rp-files">
                  {folder.entries.map((entry) => (
                    <li key={entry.path}>
                      <Link
                        aria-current={file?.path === entry.path ? "true" : undefined}
                        className="rp-mono"
                        href={`/swarm/skills?file=${encodeURIComponent(entry.path)}#file`}
                      >
                        {entry.name}
                      </Link>{" "}
                      <a className="rp-soft" href={entry.url} rel="noreferrer" target="_blank">
                        on GitHub
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          ))}
          {file ? (
            <Section id="file" title={file.path}>
              {file.error ? <GithubProblem failure={file.error} /> : <pre className="rp-file">{file.text}</pre>}
            </Section>
          ) : null}
        </>
      )}
    </>
  );
}
