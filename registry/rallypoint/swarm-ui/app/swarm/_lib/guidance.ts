/**
 * What every setup or error banner says: what is wrong, the exact steps to
 * fix it, and when the fix takes effect. Pure and server-side: messages are
 * composed from HTTP status codes and whether an env var is *present*, never
 * from its value, so no part of a token can reach the page.
 *
 * Text markup, rendered by `<Fix>` in `_components/states.tsx`:
 * `code` becomes <code>, [label](https://…) becomes a link. Links point only
 * at fixed public documentation.
 *
 * This module has no imports so the swarm test script can load it directly.
 */

export type Guidance = {
  /** The banner heading. */
  title: string;
  /** What is wrong, in plain words. */
  problem: string;
  /** The exact steps, in order. */
  steps: string[];
  /** When the fix takes effect. */
  after: string;
  /** Raw detail from the failing service, shown small (never a secret). */
  detail?: string;
};

export const GITHUB_REPO_VAR = "RALLYPOINT_GITHUB_REPO";
export const GITHUB_TOKEN_VAR = "RALLYPOINT_GITHUB_TOKEN";
export const SUPABASE_URL_VAR = "NEXT_PUBLIC_RALLYPOINT_SUPABASE_URL";
export const SUPABASE_KEY_VAR = "NEXT_PUBLIC_RALLYPOINT_SUPABASE_KEY";

const TOKEN_DOCS =
  "https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens";
const VERCEL_ENV_DOCS = "https://vercel.com/docs/environment-variables";
const SUPABASE_REDIRECT_DOCS = "https://supabase.com/docs/guides/auth/redirect-urls";

export const AFTER_REDEPLOY =
  "Server environment variables are read when the app is built or started, so the change applies after a redeploy (on Vercel: Deployments → ⋯ → Redeploy) or a restart of the local server.";

/** "Set NAME on the server", for Vercel and for local development. */
function setVarStep(name: string, sensitive: boolean): string {
  return `Set \`${name}\` where the app runs: on Vercel, Project → Settings → Environment Variables, environment Production${
    sensitive ? ", marked Sensitive" : ""
  } ([how](${VERCEL_ENV_DOCS})); locally, in \`.env.local\`.`;
}

const REDEPLOY_STEP = "Redeploy, or restart the local server.";

/** Creating a least-privilege token for one repository. */
function newTokenSteps(repo: string): string[] {
  const owner = repo.split("/")[0] ?? repo;
  return [
    `Create a fine-grained personal access token at [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new) ([guide](${TOKEN_DOCS})). Name it \`rallypoint-swarm-ui\`, set Resource owner to \`${owner}\`, and under Repository access choose Only select repositories → \`${repo}\`.`,
    "Under Repository permissions set **Contents**, **Issues** and **Pull requests** to Read-only. Metadata is added automatically. Generate the token and copy it.",
    setVarStep(GITHUB_TOKEN_VAR, true),
    REDEPLOY_STEP,
  ];
}

export type GithubFailureInput = {
  /** HTTP status, or 0 when GitHub could not be reached. */
  status: number;
  /** `owner/name` that was requested. */
  repo: string;
  /** The configured token, used only to know whether one is set. */
  token: string | null | undefined;
  /** The `x-ratelimit-remaining` response header, when present. */
  rateLimitRemaining?: string | null;
  /** What was being read: issues and PRs, or repository files. */
  resource?: "issues" | "contents";
  /** The token can see the repository but GitHub refused its files. */
  contentsDenied?: boolean;
  /** Error text when the request never got a response. */
  networkMessage?: string;
  /** True when RALLYPOINT_GITHUB_API_URL points at GitHub Enterprise. */
  enterprise?: boolean;
};

/** No `RALLYPOINT_GITHUB_REPO`, or one that is not `owner/name`. */
export function githubNoRepoGuidance(present: boolean): Guidance {
  return {
    title: "GitHub is not connected",
    problem: present
      ? `\`${GITHUB_REPO_VAR}\` is set, but not in the form \`owner/name\`, so the dashboard does not know which repository to read issues, pull requests and skills from.`
      : `\`${GITHUB_REPO_VAR}\` is not set, so the dashboard does not know which repository to read issues, pull requests and skills from.`,
    steps: [
      `Use the repository as it appears in its URL, e.g. \`acme/app\` for github.com/acme/app.`,
      setVarStep(GITHUB_REPO_VAR, false),
      `If the repository is private, also set \`${GITHUB_TOKEN_VAR}\` (a read-only fine-grained token for that one repository).`,
      REDEPLOY_STEP,
    ],
    after: AFTER_REDEPLOY,
  };
}

/** Maps a failed GitHub read to what the operator should do about it. */
export function githubFailureGuidance(input: GithubFailureInput): Guidance {
  // Only presence is kept; the value is dropped here and never used again.
  const hasToken = Boolean(input.token?.trim());
  const { status, repo } = input;
  const files = input.resource === "contents";
  const what = files ? "the repository's files" : "issues and pull requests";

  if (status === 0) {
    return {
      title: "GitHub could not be reached",
      problem: `The request for \`${repo}\` never got an answer from GitHub${
        input.enterprise ? " Enterprise" : ""
      }. This is usually a network problem or a wrong API address, not a setting on the repository.`,
      steps: [
        input.enterprise
          ? "Check that `RALLYPOINT_GITHUB_API_URL` is your server's API address, e.g. `https://ghe.example.com/api/v3`, and that the app's host can reach it."
          : "Leave `RALLYPOINT_GITHUB_API_URL` unset to use github.com, or set it to your GitHub Enterprise API address.",
        "Reload the page in a minute; GitHub reads are retried on every request.",
      ],
      after: "A changed `RALLYPOINT_GITHUB_API_URL` applies after a redeploy or restart. A network blip clears by itself.",
      detail: input.networkMessage,
    };
  }

  if (status === 401) {
    return {
      title: "GitHub rejected the token",
      problem: `GitHub answered 401 for \`${repo}\`: the token in \`${GITHUB_TOKEN_VAR}\` is invalid, expired or revoked.`,
      steps: [
        `Check its expiry at [github.com/settings/personal-access-tokens](https://github.com/settings/personal-access-tokens). An expired token can be regenerated there; otherwise create a new one as below.`,
        ...newTokenSteps(repo),
      ],
      after: AFTER_REDEPLOY,
    };
  }

  const rateLimited =
    status === 429 || (status === 403 && input.rateLimitRemaining?.trim() === "0");
  if (rateLimited) {
    if (!hasToken) {
      return {
        title: "GitHub's rate limit is used up",
        problem: `Without a token GitHub allows 60 requests an hour from one address, shared with everything else on that host, and they are used up (HTTP ${status}).`,
        steps: newTokenSteps(repo),
        after: `${AFTER_REDEPLOY} Without a token the limit also resets by itself within the hour.`,
      };
    }
    return {
      title: "GitHub's rate limit is used up",
      problem: `The token's request allowance is used up (HTTP ${status}). The token itself is fine.`,
      steps: [
        "Wait: the limit resets within the hour, and the dashboard caches GitHub reads for two minutes.",
        "If other tools share this token, give the dashboard its own token as below.",
        ...newTokenSteps(repo),
      ],
      after: "Waiting needs no redeploy. A new token applies after a redeploy or restart.",
    };
  }

  if (status === 403 || (status === 404 && input.contentsDenied)) {
    if (!hasToken) {
      return {
        title: "GitHub refused the request",
        problem: `GitHub answered ${status} for \`${repo}\` without a token. The repository may restrict anonymous access.`,
        steps: newTokenSteps(repo),
        after: AFTER_REDEPLOY,
      };
    }
    const perm = files ? "Contents" : "Issues and Pull requests";
    return {
      title: "The token is missing a permission",
      problem: `The token can see \`${repo}\` but is not allowed to read ${what}: it needs read-only **${perm}** permission${
        files ? " (a token with only Issues and Pull requests reads the board but not the skills)" : ""
      }.`,
      steps: [
        `Open the token at [github.com/settings/personal-access-tokens](https://github.com/settings/personal-access-tokens) and choose Edit.`,
        `Under Repository permissions set **Contents**, **Issues** and **Pull requests** to Read-only, and check that Repository access includes \`${repo}\`. Save.`,
        `If \`${repo.split("/")[0]}\` is an organisation, an owner may have to approve the change under the organisation's Settings → Personal access tokens → Pending requests.`,
      ],
      after:
        "Editing a token's permissions keeps its value, so no redeploy is needed: reload in two minutes, once the cached read expires. If you created a new token instead, set it and redeploy.",
    };
  }

  if (status === 404) {
    if (!hasToken) {
      return {
        title: "GitHub cannot find the repository",
        problem: `GitHub answered 404 for \`${repo}\`. Without a token GitHub says 404 for a private repository too, so either the repository is private or the name is wrong.`,
        steps: [
          `Check that \`${GITHUB_REPO_VAR}\` is exactly \`owner/name\` as in the repository's URL.`,
          "If it is private, give the dashboard a read-only token:",
          ...newTokenSteps(repo),
        ],
        after: AFTER_REDEPLOY,
      };
    }
    return {
      title: "The token cannot see the repository",
      problem: `GitHub answered 404 for \`${repo}\` with a token set: the token has no access to this repository, or the name is wrong.`,
      steps: [
        `Check that \`${GITHUB_REPO_VAR}\` is exactly \`owner/name\` as in the repository's URL.`,
        `Open the token at [github.com/settings/personal-access-tokens](https://github.com/settings/personal-access-tokens), choose Edit, and add \`${repo}\` under Repository access. Its Resource owner must be \`${repo.split("/")[0]}\`; if it is not, create a new token instead:`,
        ...newTokenSteps(repo),
      ],
      after:
        "Adding the repository to an existing token needs no redeploy. A corrected repository name or a new token applies after a redeploy or restart.",
    };
  }

  return {
    title: "GitHub could not be read",
    problem: `GitHub answered ${status} for \`${repo}\`. That is usually a temporary problem on GitHub's side.`,
    steps: [
      "Reload in a few minutes. [githubstatus.com](https://www.githubstatus.com) shows ongoing incidents.",
    ],
    after: "Nothing to redeploy: it clears when GitHub answers again.",
  };
}

/* ───────────────────────── Supabase memory ───────────────────────── */

export function supabaseMissingGuidance(missing: string[]): Guidance {
  return {
    title: "Memory is not connected yet",
    problem: `The dashboard reads the swarm's memory from your own Supabase project, and ${missing
      .map((name) => `\`${name}\``)
      .join(" and ")} ${missing.length === 1 ? "is" : "are"} not set.`,
    steps: [
      "In the [Supabase dashboard](https://supabase.com/dashboard), open the project and choose Connect (or Project Settings → API Keys). Copy the project URL, `https://<project-ref>.supabase.co`, and the publishable (anon) key. Never use the service-role key here.",
      `Set \`${SUPABASE_URL_VAR}\` and \`${SUPABASE_KEY_VAR}\` where the app runs: on Vercel, Project → Settings → Environment Variables, environment Production ([how](${VERCEL_ENV_DOCS})); locally, in \`.env.local\`. Both are safe to expose; RLS keeps the key read-only.`,
      "If you have not yet: paste `.rallypoint/swarm/schema.sql` into the project's SQL Editor and run it, then run `npx rallypoint swarm init`.",
      REDEPLOY_STEP,
    ],
    after: AFTER_REDEPLOY,
  };
}

export function supabaseNoSchemaGuidance(detail: string): Guidance {
  return {
    title: "Connected, but the swarm schema is missing",
    problem: "Supabase answered, but the `swarm_*` tables are not in this project.",
    steps: [
      "In the [Supabase dashboard](https://supabase.com/dashboard), open the project's SQL Editor.",
      "Paste the whole of `.rallypoint/swarm/schema.sql` and choose Run. It is safe to re-run.",
      "Run `npx rallypoint swarm init` to store the goal and visibility.",
    ],
    after: "No redeploy needed: reload once the SQL has run.",
    detail,
  };
}

export function supabaseUnreachableGuidance(detail: string): Guidance {
  return {
    title: "Supabase could not be reached",
    problem: "The dashboard has a Supabase URL and key, but the project did not answer usefully.",
    steps: [
      `Check that \`${SUPABASE_URL_VAR}\` is the project URL, \`https://<project-ref>.supabase.co\`, from Connect in the Supabase dashboard.`,
      `Check that \`${SUPABASE_KEY_VAR}\` is that project's publishable (anon) key.`,
      "If the project is paused (free projects pause after a week idle), restore it from its dashboard page.",
      REDEPLOY_STEP,
    ],
    after: `${AFTER_REDEPLOY} A restored project needs only a reload.`,
    detail,
  };
}

/* ───────────────────────── Private mode ───────────────────────── */

const ADD_USER_STEP =
  "In the [Supabase dashboard](https://supabase.com/dashboard), open Authentication → Users → Add user, and create the reader (with a password) or send an invitation.";
const ALLOWLIST_STEP =
  "If `public.swarm_readers` has any rows, only the emails in it may read. Add the reader in the SQL Editor: `insert into public.swarm_readers (email) values ('reader@example.com');` An empty table lets every signed-in user read.";
const REDIRECT_STEP = `For magic links, add \`https://<your-host>/swarm/sign-in\` under Authentication → URL Configuration → Redirect URLs ([guide](${SUPABASE_REDIRECT_DOCS})).`;

export function privateGuidance(): Guidance {
  return {
    title: "This swarm is private",
    problem: "Its memory is visible to signed-in readers only, and you are not signed in.",
    steps: [
      "If you have an account, sign in below.",
      `To give someone access: ${ADD_USER_STEP.replace(/^In/, "in")}`,
      ALLOWLIST_STEP,
      REDIRECT_STEP,
      "If you expected a public swarm, run `npx rallypoint swarm init`: until it stores `visibility`, an empty settings read looks private.",
    ],
    after: "These are Supabase settings, so no redeploy is needed: they apply at the next sign-in.",
  };
}

export function expiredGuidance(): Guidance {
  return {
    title: "Your session expired",
    problem: "Supabase no longer accepts your sign-in, so the swarm's memory is hidden again.",
    steps: ["Sign in again below."],
    after: "It applies at once.",
  };
}

export function notAllowedGuidance(): Guidance {
  return {
    title: "Signed in, but nothing is readable",
    problem:
      "You are signed in, yet the swarm's memory returned nothing for your account. Either your email is not on the `swarm_readers` allowlist, or `npx rallypoint swarm init` has not stored the swarm's settings yet.",
    steps: [
      ALLOWLIST_STEP.replace("Add the reader", "Ask an operator to add your email"),
      "If the swarm was never initialised, run `npx rallypoint swarm init`.",
      "Sign out and sign in again.",
    ],
    after: "No redeploy needed: it applies at the next sign-in.",
  };
}

/** Supabase Auth refused a sign-in; `detail` is its own message. */
export function signInGuidance(detail: string): Guidance {
  return {
    title: "Could not sign in",
    problem: "Supabase Auth did not accept the sign-in.",
    steps: [
      "Check the email and password. Magic links are sent only to existing users.",
      `If you have no account yet, ask an operator to add you: ${ADD_USER_STEP.replace(/^In/, "in")}`,
      "If Supabase says the email is not confirmed, open the invitation email first, or have an operator confirm the user under Authentication → Users.",
      REDIRECT_STEP,
    ],
    after: "These are Supabase settings, so no redeploy is needed.",
    detail,
  };
}
