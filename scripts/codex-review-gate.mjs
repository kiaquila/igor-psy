import { readFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { acceptsCommentEvent, evaluateReview, FULL_SHA, requestedHead } from "./codex-review-policy.mjs";

const env = process.env;
const event = JSON.parse(await readFile(env.GITHUB_EVENT_PATH, "utf8"));
const prNumber = event.pull_request?.number ?? event.issue?.number ?? Number(event.inputs?.pr_number);
if (!Number.isSafeInteger(prNumber) || prNumber < 1) process.exit(0);
if (env.GITHUB_EVENT_NAME === "issue_comment" &&
    (!event.issue?.pull_request || !acceptsCommentEvent(event.comment))) process.exit(0);

const repository = env.GITHUB_REPOSITORY;
const repoPath = `/repos/${repository}`;
const prPath = `${repoPath}/pulls/${prNumber}`;
const detailsUrl = `${env.GITHUB_SERVER_URL}/${repository}/actions/runs/${env.GITHUB_RUN_ID}`;

async function api(path, body, method = body ? "POST" : "GET") {
  const response = await fetch(path === "/graphql" ? env.GITHUB_GRAPHQL_URL : env.GITHUB_API_URL + path, {
    method,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`GitHub ${method} ${path} returned ${response.status}`);
  return response.json();
}

async function list(path) {
  const items = [];
  for (let page = 1; ; page += 1) {
    const batch = await api(`${path}?per_page=100&page=${page}`);
    if (!Array.isArray(batch)) throw new Error(`Expected a paginated list at ${path}`);
    items.push(...batch);
    if (batch.length < 100) return items;
  }
}

async function listThreads() {
  const [owner, name] = repository.split("/");
  const threads = [];
  let cursor = null;
  do {
    const result = await api("/graphql", {
      query: `query($owner: String!, $name: String!, $number: Int!, $cursor: String) {
        repository(owner: $owner, name: $name) { pullRequest(number: $number) {
          reviewThreads(first: 100, after: $cursor) {
            nodes { isResolved comments(first: 1) { nodes { author { login __typename } } } }
            pageInfo { hasNextPage endCursor }
          }
        } }
      }`,
      variables: { owner, name, number: prNumber, cursor },
    });
    const connection = result.data?.repository?.pullRequest?.reviewThreads;
    if (result.errors?.length || !connection ||
        (connection.pageInfo.hasNextPage && !connection.pageInfo.endCursor)) {
      throw new Error("Could not read all pull request review threads");
    }
    threads.push(...connection.nodes);
    cursor = connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null;
  } while (cursor);
  return threads;
}

const pull = await api(prPath);
const head = pull.head?.sha;
const expectedHead = event.pull_request?.head.sha ?? requestedHead(event.comment);
if (pull.state !== "open" || pull.base?.ref !== "main" ||
    (expectedHead && expectedHead !== head)) process.exit(0);
if (!FULL_SHA.test(head)) throw new Error("GitHub did not return a full PR head SHA");

const check = await api(`${repoPath}/check-runs`, {
  name: "Codex Review",
  head_sha: head,
  status: "in_progress",
  details_url: detailsUrl,
  external_id: `${prNumber}:${env.GITHUB_RUN_ID}:${env.GITHUB_RUN_ATTEMPT}`,
});

const explanations = {
  pass: "Codex reviewed this commit and the review has no blocking findings.",
  "missing-request": `Post @codex review ${head} as a repository maintainer.`,
  waiting: "Waiting for a formal review or a clean Codex receipt for this commit. After Codex responds, use /codex-check or run this workflow again.",
  "unresolved-thread": "Resolve outstanding Codex review threads, then use /codex-check.",
  "blocking-review": "Address the blocking Codex findings, push the fix, and request review of the new commit.",
  stale: "The PR closed, changed base, or moved to a different commit during evaluation.",
  error: "GitHub did not return complete review evidence. See the workflow log and retry.",
};
let outcome = "error";
try {
  const deadline = Date.now() + 5 * 60_000;
  do {
    const [comments, reviews, inlineComments, threads] = await Promise.all([
      list(`${repoPath}/issues/${prNumber}/comments`),
      list(`${prPath}/reviews`),
      list(`${prPath}/comments`),
      listThreads(),
    ]);
    const current = await api(prPath);
    if (current.state !== "open" || current.base.ref !== "main" || current.head.sha !== head) {
      outcome = "stale";
      break;
    }
    outcome = evaluateReview({ head, comments, reviews, inlineComments, threads });
    if (outcome !== "waiting" || Date.now() >= deadline) break;
    await sleep(20_000);
  } while (true);
} catch (error) {
  outcome = "error";
  console.error(error.message);
}

const success = outcome === "pass";
await api(`${repoPath}/check-runs/${check.id}`, {
  status: "completed",
  conclusion: success ? "success" : "failure",
  output: { title: `Codex Review: ${outcome}`, summary: explanations[outcome] },
}, "PATCH");
console.log(`PR #${prNumber} · ${head} · ${explanations[outcome]}`);
if (!success) process.exitCode = 1;
