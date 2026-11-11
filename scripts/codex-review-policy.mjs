import { isStrictNativeCodexReceipt } from "./codex-native-receipt.mjs";

export const CODEX_BOT = "chatgpt-codex-connector[bot]";
export const FULL_SHA = /^[a-f0-9]{40}$/;
const maintainers = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

export function isMaintainer(comment) {
  return comment?.user?.type === "User" && maintainers.has(comment.author_association);
}

export function isCodex(user) {
  // GraphQL returns a typed Bot; REST returns user.type.
  return user?.login === CODEX_BOT && (user.type ?? user.__typename) === "Bot";
}

export function requestedHead(comment) {
  if (!isMaintainer(comment) || !comment.created_at ||
      comment.updated_at !== comment.created_at) return null;
  return comment.body?.trim().match(/^@codex review ([a-f0-9]{40})$/)?.[1] ?? null;
}

export function acceptsCommentEvent(comment) {
  return isCodex(comment?.user) || Boolean(requestedHead(comment)) ||
    (isMaintainer(comment) && comment.body?.trim() === "/codex-check");
}

export function evaluateReview({ head, comments, reviews, inlineComments, threads }) {
  const currentReviews = reviews.filter((review) =>
    isCodex(review.user) && review.commit_id === head && review.submitted_at);
  const blockingPriority = (body) => /\bP[0-2]\b/i.test(body ?? "");
  const hasPriority = (body) => /\bP[0-3]\b/i.test(body ?? "");

  if (threads.some((thread) => !thread.isResolved && isCodex(thread.comments.nodes[0]?.author))) {
    return "unresolved-thread";
  }
  if (currentReviews.some((review) => review.state === "CHANGES_REQUESTED" ||
      review.state === "DISMISSED" || blockingPriority(review.body))) {
    return "blocking-review";
  }
  const currentIds = new Set(currentReviews.map((review) => review.id));
  if (inlineComments.some((comment) => isCodex(comment.user) &&
      (comment.original_commit_id === head || currentIds.has(comment.pull_request_review_id)) &&
      (!hasPriority(comment.body) || blockingPriority(comment.body)))) {
    return "blocking-review";
  }

  const request = comments.filter((comment) => requestedHead(comment) === head)
    .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at) ||
      right.id - left.id)[0];
  if (!request) return "missing-request";

  const requestedAt = Date.parse(request.created_at);
  if (currentReviews.some((review) => Date.parse(review.submitted_at) > requestedAt &&
      (review.state === "APPROVED" || (review.state === "COMMENTED" &&
        isStrictNativeCodexReceipt(review.body, head))))) return "pass";

  const receipt = comments.some((comment) => {
    if (!isCodex(comment.user) || !isStrictNativeCodexReceipt(comment.body, head)) return false;
    const createdAt = Date.parse(comment.created_at);
    return createdAt > requestedAt || (createdAt === requestedAt && comment.id > request.id);
  });
  return receipt ? "pass" : "waiting";
}
