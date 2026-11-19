import { readFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { acceptsCommentEvent, evaluateReview, FULL_SHA, requestedHead } from "./codex-review-policy.mjs";

export async function runReviewGate({ event, env, api, wait = sleep, now = Date.now, report = console }) {
  const prNumber = event.pull_request?.number ?? event.issue?.number ?? Number(event.inputs?.pr_number);
  if (!Number.isSafeInteger(prNumber) || prNumber < 1) return 0;
  if (env.GITHUB_EVENT_NAME === "issue_comment" &&
      (!event.issue?.pull_request || !acceptsCommentEvent(event.comment))) return 0;

  const repository = env.GITHUB_REPOSITORY;
  const repoPath = `/repos/${repository}`;
  const prPath = `${repoPath}/pulls/${prNumber}`;
  const detailsUrl = `${env.GITHUB_SERVER_URL}/${repository}/actions/runs/${env.GITHUB_RUN_ID}`;

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
    const cursors = new Set();
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
      const connection = result?.data?.repository?.pullRequest?.reviewThreads;
      if (result?.errors?.length || !Array.isArray(connection?.nodes) ||
          typeof connection.pageInfo?.hasNextPage !== "boolean" ||
          (connection.pageInfo.hasNextPage &&
            (typeof connection.pageInfo.endCursor !== "string" ||
              !connection.pageInfo.endCursor || cursors.has(connection.pageInfo.endCursor))) ||
          connection.nodes.some((thread) => typeof thread?.isResolved !== "boolean" ||
            !Array.isArray(thread.comments?.nodes) ||
            (!thread.isResolved && (!thread.comments.nodes.length ||
              typeof thread.comments.nodes[0]?.author?.login !== "string" ||
              typeof thread.comments.nodes[0]?.author?.__typename !== "string")))) {
        throw new Error("Could not read all pull request review threads");
      }
      threads.push(...connection.nodes);
      cursor = connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null;
      if (cursor) cursors.add(cursor);
    } while (cursor);
    return threads;
  }

  const pull = await api(prPath);
  const head = pull?.head?.sha;
  const expectedHead = event.pull_request?.head.sha ?? requestedHead(event.comment);
  if (!FULL_SHA.test(head)) throw new Error("GitHub did not return a full PR head SHA");
  if (pull.state === "closed" ||
      (typeof pull.base?.ref === "string" && pull.base.ref !== "main") ||
      (expectedHead && expectedHead !== head)) return 0;

  // Commit statuses are keyed by SHA/context, so new workflow suites cannot hide a previous result.
  async function publish(state, description) {
    await api(`${repoPath}/statuses/${head}`, {
      context: "Codex Review",
      state,
      target_url: detailsUrl,
      description,
    });
  }
  await publish("pending", "Checking trusted Codex review evidence for this commit.");

  const explanations = {
    pass: "Codex reviewed this commit and the review has no blocking findings.",
    "missing-request": `Post @codex review ${head} as a repository maintainer.`,
    waiting: "Waiting for a trusted, clean review of this commit. Use /codex-check after Codex responds.",
    "unresolved-thread": "Resolve outstanding Codex review threads, then use /codex-check.",
    "blocking-review": "Address the blocking Codex findings, push the fix, and request review of the new commit.",
    stale: "The PR closed, changed base, or moved to a different commit during evaluation.",
    error: "GitHub did not return complete review evidence. See the workflow log and retry.",
  };
  let outcome = "error";
  try {
    if (pull.state !== "open" || pull.base?.ref !== "main") {
      throw new Error("GitHub did not return complete pull request state");
    }
    const deadline = now() + 5 * 60_000;
    do {
      const [comments, reviews, inlineComments, threads] = await Promise.all([
        list(`${repoPath}/issues/${prNumber}/comments`),
        list(`${prPath}/reviews`),
        list(`${prPath}/comments`),
        listThreads(),
      ]);
      const current = await api(prPath);
      if (typeof current?.state !== "string" || typeof current.base?.ref !== "string" ||
          !FULL_SHA.test(current.head?.sha)) {
        throw new Error("GitHub did not return complete pull request state");
      }
      if (current.state !== "open" || current.base.ref !== "main" || current.head.sha !== head) {
        outcome = "stale";
        break;
      }
      outcome = evaluateReview({ head, comments, reviews, inlineComments, threads });
      if (outcome !== "waiting" || now() >= deadline) break;
      await wait(20_000);
    } while (true);
  } catch (error) {
    outcome = "error";
    report.error(error.message);
  }

  await publish(outcome === "pass" ? "success" : outcome === "error" ? "error" : "failure", explanations[outcome]);
  report.log(`PR #${prNumber} · ${head} · ${explanations[outcome]}`);
  return outcome === "pass" ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const env = process.env;
  const event = JSON.parse(await readFile(env.GITHUB_EVENT_PATH, "utf8"));
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
  process.exitCode = await runReviewGate({ event, env, api });
}
