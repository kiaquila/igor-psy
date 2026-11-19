import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runReviewGate } from "../scripts/codex-review-gate.mjs";

const head = "1234567890abcdef1234567890abcdef12345678";
const otherHead = "b".repeat(40);
const repoPath = "/repos/owner/site";
const prPath = `${repoPath}/pulls/12`;
const pull = { state: "open", base: { ref: "main" }, head: { sha: head } };
const user = { login: "maintainer", type: "User" };
const bot = { login: "chatgpt-codex-connector[bot]", type: "Bot" };
const request = {
  id: 1, user, author_association: "OWNER", body: `@codex review ${head}`,
  created_at: "2026-11-11T12:00:00Z", updated_at: "2026-11-11T12:00:00Z",
};
const receipt = {
  id: 2, user: bot, created_at: "2026-11-11T12:01:00Z",
  body: `<!-- codex-review-receipt:v1 -->\nCodex Review: Didn't find any major issues.\n**Reviewed commit:** \`${head}\``,
};
const thread = {
  isResolved: false,
  comments: { nodes: [{ author: { login: "chatgpt-codex-connector", __typename: "Bot" } }] },
};
const targetEvent = { pull_request: { number: 12, head: { sha: head } }, action: "edited" };
const commentEvent = {
  issue: { number: 12, pull_request: {} }, comment: { ...request, body: "/codex-check" },
};
const threadsResponse = (nodes = [], pageInfo = { hasNextPage: false, endCursor: null }) => ({
  data: { repository: { pullRequest: { reviewThreads: { nodes, pageInfo } } } },
});

function harness(options = {}) {
  const calls = [];
  const statuses = [];
  const errors = [];
  let pullReads = 0;
  let clockReads = 0;
  const evidence = { comments: [request, receipt], reviews: [], inlineComments: [], ...options.evidence };
  const api = async (path, body) => {
    calls.push({ path, body });
    if (options.failPath?.(path, body)) throw new Error("Simulated GitHub API failure");
    if (path === `${repoPath}/statuses/${head}`) {
      assert.equal(body.context, "Codex Review");
      assert.equal(body.target_url, "https://github.com/owner/site/actions/runs/42");
      assert.ok(body.description.length <= 140);
      statuses.push(body);
      return { id: statuses.length };
    }
    if (path === prPath) {
      const pulls = options.pulls ?? [pull];
      return pulls[Math.min(pullReads++, pulls.length - 1)];
    }
    if (path === "/graphql") return options.graphql?.(body.variables.cursor) ?? threadsResponse();
    if (path.startsWith(`${repoPath}/issues/12/comments?`)) return evidence.comments;
    if (path.startsWith(`${prPath}/reviews?`)) return evidence.reviews;
    if (path.startsWith(`${prPath}/comments?`)) return evidence.inlineComments;
    throw new Error(`Unexpected API call: ${path}`);
  };
  const run = (event = targetEvent, eventName = "pull_request_target") => runReviewGate({
    event,
    env: {
      GITHUB_EVENT_NAME: eventName, GITHUB_REPOSITORY: "owner/site",
      GITHUB_SERVER_URL: "https://github.com", GITHUB_RUN_ID: "42",
    },
    api,
    // Let waiting cases reach the deadline without sleeping for five minutes.
    now: options.now ?? (() => clockReads++ * 300_000),
    wait: options.wait ?? (async () => { throw new Error("Unexpected wait"); }),
    report: { log() {}, error(message) { errors.push(message); } },
  });
  return { run, calls, statuses, errors, evidence };
}

test("metadata edits and /codex-check republish one SHA/context without check-suite dependence", async () => {
  const gate = harness();
  assert.equal(await gate.run(), 0);
  assert.equal(await gate.run(commentEvent, "issue_comment"), 0);
  assert.deepEqual(gate.statuses.map(({ state }) => state), ["pending", "success", "pending", "success"]);
  assert.ok(gate.calls.every(({ path }) => !path.includes("check-runs") && !path.includes("check-suites")));
});

test("untrusted comments and non-PR comments cannot trigger status writes", async () => {
  for (const event of [
    { ...commentEvent, comment: { ...commentEvent.comment, author_association: "NONE" } },
    { ...commentEvent, comment: { ...request, user: { login: "other-bot[bot]", type: "Bot" } } },
    { issue: { number: 12 }, comment: commentEvent.comment },
  ]) {
    const gate = harness();
    assert.equal(await gate.run(event, "issue_comment"), 0);
    assert.deepEqual(gate.calls, []);
  }
});

test("stale request events cannot publish to the current head", async () => {
  for (const [event, eventName] of [
    [{ pull_request: { number: 12, head: { sha: otherHead } } }, "pull_request_target"],
    [{ ...commentEvent, comment: { ...request, body: `@codex review ${otherHead}` } }, "issue_comment"],
  ]) {
    const gate = harness();
    assert.equal(await gate.run(event, eventName), 0);
    assert.deepEqual(gate.statuses, []);
  }
});

test("closed and retargeted PRs are ignored before publication", async () => {
  for (const changed of [{ ...pull, state: "closed" }, { ...pull, base: { ref: "release" } }]) {
    const gate = harness({ pulls: [changed] });
    assert.equal(await gate.run(), 0);
    assert.deepEqual(gate.statuses, []);
  }
});

test("a clean bot receipt cannot pass without a trusted current-head request", async () => {
  for (const comments of [
    [receipt],
    [{ ...request, author_association: "NONE" }, receipt],
    [{ ...request, body: `@codex review ${otherHead}` }, receipt],
  ]) {
    const gate = harness({ evidence: { comments } });
    assert.equal(await gate.run(), 1);
    assert.deepEqual(gate.statuses.map(({ state }) => state), ["pending", "failure"]);
    assert.match(gate.statuses.at(-1).description, /Post @codex review/);
  }
});

test("stale or untrusted clean evidence never publishes success", async () => {
  for (const changed of [
    { ...receipt, body: receipt.body.replace(head, otherHead) },
    { ...receipt, user },
    { ...receipt, created_at: "2026-11-11T11:59:00Z" },
  ]) {
    const gate = harness({ evidence: { comments: [request, changed] } });
    assert.equal(await gate.run(), 1);
    assert.deepEqual(gate.statuses.map(({ state }) => state), ["pending", "failure"]);
    assert.match(gate.statuses.at(-1).description, /Waiting/);
  }
});

test("unresolved threads and blocking reviews override clean receipts", async () => {
  for (const options of [
    { graphql: () => threadsResponse([thread]) },
    { evidence: { reviews: [{ user: bot, commit_id: head, submitted_at: receipt.created_at, state: "CHANGES_REQUESTED" }] } },
  ]) {
    const gate = harness(options);
    assert.equal(await gate.run(), 1);
    assert.deepEqual(gate.statuses.map(({ state }) => state), ["pending", "failure"]);
  }
});

test("head, base and closed-state changes during evaluation fail only the original head", async () => {
  for (const changed of [
    { ...pull, head: { sha: otherHead } },
    { ...pull, base: { ref: "release" } },
    { ...pull, state: "closed" },
  ]) {
    const gate = harness({ pulls: [pull, changed] });
    assert.equal(await gate.run(), 1);
    assert.deepEqual(gate.statuses.map(({ state }) => state), ["pending", "failure"]);
    assert.match(gate.statuses.at(-1).description, /PR closed, changed base, or moved/);
    assert.ok(gate.calls.filter(({ path }) => path.includes("/statuses/")).every(({ path }) => path.endsWith(head)));
  }
});

test("missing or malformed REST evidence fails closed with an error status", async () => {
  for (const evidence of [{ comments: null }, { reviews: {} }, { inlineComments: undefined }]) {
    const gate = harness({ evidence });
    assert.equal(await gate.run(), 1);
    assert.deepEqual(gate.statuses.map(({ state }) => state), ["pending", "error"]);
    assert.equal(gate.errors.length, 1);
  }
});

test("missing GraphQL pages, pagination metadata or thread authors fail closed", async () => {
  for (const response of [
    {},
    { errors: [{ message: "Unavailable" }], ...threadsResponse() },
    threadsResponse(undefined, { hasNextPage: true, endCursor: null }),
    threadsResponse([], {}),
    threadsResponse([{}]),
    threadsResponse([{ isResolved: false, comments: { nodes: [] } }]),
    threadsResponse([{ isResolved: false, comments: { nodes: [{ author: null }] } }]),
    { data: { repository: { pullRequest: { reviewThreads: { pageInfo: { hasNextPage: false } } } } } },
  ]) {
    const gate = harness({ graphql: () => response });
    assert.equal(await gate.run(), 1);
    assert.deepEqual(gate.statuses.map(({ state }) => state), ["pending", "error"]);
  }
});

test("resolved threads may have a deleted author or no remaining comments", async () => {
  for (const nodes of [[{ author: null }], []]) {
    const gate = harness({ graphql: () => threadsResponse([{ isResolved: true, comments: { nodes } }]) });
    assert.equal(await gate.run(), 0);
    assert.deepEqual(gate.statuses.map(({ state }) => state), ["pending", "success"]);
  }
});

test("all thread pages are checked and repeated cursors cannot hide incomplete evidence", async () => {
  const gate = harness({ graphql: (cursor) => cursor
    ? threadsResponse([thread])
    : threadsResponse([], { hasNextPage: true, endCursor: "next" }) });
  assert.equal(await gate.run(), 1);
  assert.match(gate.statuses.at(-1).description, /Resolve outstanding/);
  assert.deepEqual(gate.calls.filter(({ path }) => path === "/graphql").map(({ body }) => body.variables.cursor), [null, "next"]);

  const repeated = harness({ graphql: () => threadsResponse([], { hasNextPage: true, endCursor: "same" }) });
  assert.equal(await repeated.run(), 1);
  assert.equal(repeated.statuses.at(-1).state, "error");
});

test("incomplete PR state after pending cannot preserve success", async () => {
  for (const pulls of [
    [{ head: { sha: head } }],
    [pull, { ...pull, base: null }],
    [pull, { ...pull, head: {} }],
  ]) {
    const gate = harness({ pulls });
    assert.equal(await gate.run(), 1);
    assert.deepEqual(gate.statuses.map(({ state }) => state), ["pending", "error"]);
  }
});

test("polling can replace pending only after a fresh clean receipt arrives", async () => {
  const gate = harness({
    evidence: { comments: [request] },
    now: () => 0,
    wait: async (ms) => {
      assert.equal(ms, 20_000);
      assert.deepEqual(gate.statuses.map(({ state }) => state), ["pending"]);
      gate.evidence.comments.push(receipt);
    },
  });
  assert.equal(await gate.run(), 0);
  assert.deepEqual(gate.statuses.map(({ state }) => state), ["pending", "success"]);
});

test("API failures publish error once pending exists, and publication failures reject", async () => {
  const evidenceFailure = harness({ failPath: (path) => path.includes("/reviews?") });
  assert.equal(await evidenceFailure.run(), 1);
  assert.deepEqual(evidenceFailure.statuses.map(({ state }) => state), ["pending", "error"]);

  for (const failPath of [
    (path) => path === prPath,
    (path, body) => path.includes("/statuses/") && body.state === "pending",
    (path, body) => path.includes("/statuses/") && body.state === "success",
  ]) {
    const gate = harness({ failPath });
    await assert.rejects(gate.run(), /Simulated GitHub API failure/);
    assert.ok(!gate.statuses.some(({ state }) => state === "success"));
  }
  const missingHead = harness({ pulls: [{ ...pull, head: { sha: "short" } }] });
  await assert.rejects(missingHead.run(), /full PR head SHA/);
  assert.deepEqual(missingHead.statuses, []);
});

test("CLI reads the event, posts statuses through fetch and sets its process exit code", async () => {
  const directory = await mkdtemp(join(tmpdir(), "igor-review-gate-test-"));
  try {
    const eventPath = join(directory, "event.json");
    const requestsPath = join(directory, "requests.jsonl");
    const preloadPath = join(directory, "mock-fetch.mjs");
    await writeFile(eventPath, JSON.stringify(targetEvent));
    await writeFile(preloadPath, `
      import assert from "node:assert/strict";
      import { appendFileSync } from "node:fs";
      const pull = ${JSON.stringify(pull)};
      globalThis.fetch = async (url, options) => {
        assert.equal(options.headers.Authorization, "Bearer test-token");
        const path = new URL(url).pathname;
        const body = options.body ? JSON.parse(options.body) : undefined;
        appendFileSync(process.env.GATE_TEST_REQUESTS, JSON.stringify({ path, method: options.method, body }) + "\\n");
        let result;
        if (path.endsWith("/pulls/12")) result = pull;
        else if (path.includes("/statuses/")) result = { id: 1 };
        else if (path.endsWith("/issues/12/comments")) result = JSON.parse(process.env.GATE_TEST_COMMENTS);
        else if (path === "/graphql") result = ${JSON.stringify(threadsResponse())};
        else if (path.endsWith("/reviews") || path.endsWith("/pulls/12/comments")) result = [];
        else throw new Error("Unexpected URL " + path);
        return new Response(JSON.stringify(result), { status: 200 });
      };
    `);
    const env = {
      ...process.env,
      GITHUB_EVENT_PATH: eventPath, GITHUB_EVENT_NAME: "pull_request_target",
      GITHUB_REPOSITORY: "owner/site", GITHUB_RUN_ID: "42", GITHUB_TOKEN: "test-token",
      GITHUB_SERVER_URL: "https://github.com", GITHUB_API_URL: "https://api.github.test",
      GITHUB_GRAPHQL_URL: "https://api.github.test/graphql", GATE_TEST_REQUESTS: requestsPath,
    };
    for (const [comments, exitCode, finalState] of [[[request, receipt], 0, "success"], [[receipt], 1, "failure"]]) {
      await writeFile(requestsPath, "");
      const result = spawnSync(process.execPath, ["--import", preloadPath,
        fileURLToPath(new URL("../scripts/codex-review-gate.mjs", import.meta.url))], {
        env: { ...env, GATE_TEST_COMMENTS: JSON.stringify(comments) }, encoding: "utf8", timeout: 10_000,
      });
      assert.equal(result.status, exitCode, result.stderr);
      const calls = (await readFile(requestsPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
      const publications = calls.filter(({ path }) => path.includes("/statuses/"));
      assert.deepEqual(publications.map(({ body }) => body.state), ["pending", finalState]);
      assert.ok(publications.every(({ path, method, body }) => path === `${repoPath}/statuses/${head}` &&
        method === "POST" && body.context === "Codex Review"));
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
