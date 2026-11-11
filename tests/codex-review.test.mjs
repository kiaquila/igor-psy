import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { acceptsCommentEvent, evaluateReview, requestedHead } from "../scripts/codex-review-policy.mjs";

const head = "1234567890abcdef1234567890abcdef12345678";
const otherHead = "b".repeat(40);
const bot = { login: "chatgpt-codex-connector[bot]", type: "Bot" };
const user = { login: "maintainer", type: "User" };
const requestedAt = "2026-11-11T12:00:00Z";
const reviewedAt = "2026-11-11T12:01:00Z";
const request = {
  id: 1, user, author_association: "OWNER",
  created_at: requestedAt, updated_at: requestedAt, body: `@codex review ${head}`,
};
const clean = {
  id: 2, user: bot, created_at: reviewedAt,
  body: `<!-- codex-review-receipt:v1 -->\nCodex Review: Didn't find any major issues.\n**Reviewed commit:** \`${head}\``,
};
const approval = { id: 10, user: bot, commit_id: head, state: "APPROVED", submitted_at: reviewedAt };
const decide = (evidence = {}) => evaluateReview({
  head, comments: [request], reviews: [], inlineComments: [], threads: [], ...evidence,
});

test("only a maintainer's fresh command with a complete SHA qualifies", () => {
  assert.equal(requestedHead(request), head);
  for (const change of [
    { body: `@codex review ${head.slice(0, 10)}` },
    { body: `> @codex review ${head}` },
    { body: `@codex review ${head}\nmore text` },
    { updated_at: reviewedAt },
    { author_association: "CONTRIBUTOR" },
    { user: bot },
  ]) assert.equal(requestedHead({ ...request, ...change }), null);

  assert.equal(acceptsCommentEvent({ ...request, body: "/codex-check" }), true);
  assert.equal(acceptsCommentEvent({ ...request, author_association: "NONE", body: "/codex-check" }), false);
});

test("accepts known native receipts from ks after the current-head request", () => {
  const fixtures = JSON.parse(readFileSync(new URL("./fixtures/native-codex-clean-replies.json", import.meta.url)));
  for (const { closing, body } of fixtures) {
    assert.equal(decide({ comments: [request, { ...clean, body }] }), "pass", closing);
  }
});

test("rejects forged, stale, ambiguous and unbound receipts", () => {
  for (const change of [
    { user },
    { user: { ...bot, type: "User" } },
    { body: clean.body.replace(head, otherHead) },
    { body: clean.body.replace("v1", "v2") },
    { body: clean.body + "\nFound a regression" },
    { body: "Codex Review: Didn't find any major issues." },
    { body: "<!-- codex-pull-request-review-summary -->" },
    { body: "👍" },
    { created_at: "2026-11-11T11:59:00Z" },
    { created_at: requestedAt, id: 0 },
  ]) assert.equal(decide({ comments: [request, { ...clean, ...change }] }), "waiting");
  assert.equal(decide({ comments: [clean] }), "missing-request");
  assert.equal(decide({ comments: [request, clean], head: otherHead }), "missing-request");
  assert.equal(decide({ comments: [request, { ...clean, created_at: requestedAt }] }), "pass");
});

test("a new request supersedes old clean evidence", () => {
  const retry = { ...request, id: 3, created_at: reviewedAt, updated_at: reviewedAt };
  assert.equal(decide({ comments: [request, clean, retry] }), "waiting");
});

test("a formal review must be clean, match the current head and follow the request", () => {
  assert.equal(decide({ reviews: [approval] }), "pass");
  assert.equal(decide({ reviews: [{ ...approval, state: "COMMENTED", body: clean.body }] }), "pass");
  assert.equal(decide({ reviews: [{ ...approval, state: "COMMENTED", body: "Here are some suggestions." }] }), "waiting");
  assert.equal(decide({ reviews: [{ ...approval, submitted_at: requestedAt }] }), "waiting");
  assert.equal(decide({ reviews: [{ ...approval, commit_id: otherHead }] }), "waiting");
  assert.equal(decide({ reviews: [{ ...approval, user }] }), "waiting");
});

test("blocking findings survive a subsequent approval or receipt on the same head", () => {
  for (const change of [
    { state: "CHANGES_REQUESTED" },
    { state: "DISMISSED" },
    { state: "COMMENTED", body: "[P2] Broken link" },
  ]) {
    assert.equal(decide({ reviews: [{ ...approval, id: 9, ...change }, approval] }), "blocking-review");
  }
  const inline = { user: bot, original_commit_id: head, pull_request_review_id: approval.id };
  assert.equal(decide({ reviews: [approval], inlineComments: [{ ...inline, body: "[P1] Regression" }] }), "blocking-review");
  assert.equal(decide({ reviews: [approval], inlineComments: [{ ...inline, body: "Unclassified issue" }] }), "blocking-review");
  assert.equal(decide({ reviews: [approval], inlineComments: [{ ...inline, body: "[P3] Minor" }] }), "pass");
});

test("unresolved Codex threads block even with a clean review of a later commit", () => {
  const thread = { isResolved: false, comments: { nodes: [{ author: { login: bot.login, __typename: "Bot" } }] } };
  assert.equal(decide({ reviews: [approval], threads: [thread] }), "unresolved-thread");
  assert.equal(decide({ reviews: [approval], threads: [{ ...thread, isResolved: true }] }), "pass");
});
