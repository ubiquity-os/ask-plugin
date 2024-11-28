import { logger } from "../helpers/errors";
import { splitKey } from "../helpers/issue";
import { LinkedIssues, SimplifiedComment } from "../types/github-types";
import { StreamlinedComment } from "../types/llm";
import { processCommentsWithWeights } from "../helpers/weights";
import { Context } from "../types/context";

/**
 * Get all streamlined comments from linked issues
 * @param linkedIssues - The linked issues to get comments from
 * @returns The streamlined comments which are grouped by issue key
 */
export async function getAllStreamlinedComments(linkedIssues: LinkedIssues[]) {
  const streamlinedComments: Record<string, StreamlinedComment[]> = {};

  for (const issue of linkedIssues) {
    const linkedIssueComments = issue.comments || [];
    if (linkedIssueComments.length === 0) continue;

    const linkedStreamlinedComments = await streamlineComments(linkedIssueComments, issue.context);
    if (!linkedStreamlinedComments) continue;

    for (const [key, value] of Object.entries(linkedStreamlinedComments)) {
      streamlinedComments[key] = [...(streamlinedComments[key] || []), ...value];
    }
  }
  return streamlinedComments;
}

/**
 * Create a unique key for an issue based on its URL and optional issue number
 * @param issueUrl - The URL of the issue
 * @param issue - The optional issue number
 * @returns The unique key for the issue
 */
export function createKey(issueUrl: string, issue?: number) {
  const urlParts = issueUrl.split("/");

  let key;

  if (urlParts.length === 7) {
    const [, , , issueOrg, issueRepo, , issueNumber] = urlParts;
    key = `${issueOrg}/${issueRepo}/${issueNumber}`;
  }

  if (urlParts.length === 5) {
    const [, , issueOrg, issueRepo] = urlParts;
    key = `${issueOrg}/${issueRepo}/${issue}`;
  }

  if (urlParts.length === 8) {
    const [, , , issueOrg, issueRepo, , , issueNumber] = urlParts;
    key = `${issueOrg}/${issueRepo}/${issueNumber || issue}`;
  }

  if (urlParts.length === 3) {
    const [issueOrg, issueRepo, issueNumber] = urlParts;
    key = `${issueOrg}/${issueRepo}/${issueNumber || issue}`;
  }

  if (!key) {
    throw logger.error("Invalid issue URL", {
      issueUrl,
      issueNumber: issue,
    });
  }

  if (key.includes("#")) {
    key = key.split("#")[0];
  }

  return key;
}

/**
 * Streamline comments by filtering out bot comments, organizing them by issue key,
 * and calculating weights based on reactions and edits
 * @param comments - The comments to streamline
 * @param context - The context object containing octokit client
 * @returns The streamlined comments grouped by issue key
 */
export async function streamlineComments(comments: SimplifiedComment[], context: Context) {
  const streamlined: Record<string, StreamlinedComment[]> = {};

  // First pass: organize comments by key
  for (const comment of comments) {
    const { user, issueUrl: url, body } = comment;
    if (user?.type === "Bot") continue;

    const key = createKey(url);
    const [owner, repo] = splitKey(key);
    streamlined[key] ??= [];

    if (user && body) {
      streamlined[key].push({
        user,
        body,
        id: comment.id,
        org: owner,
        repo,
        issueUrl: url,
      });
    }
  }

  // Second pass: process weights for each group of comments
  for (const [key, groupComments] of Object.entries(streamlined)) {
    const weightedComments = await processCommentsWithWeights(context, groupComments);
    streamlined[key] = weightedComments.map((comment) => ({
      ...comment,
      id: comment.id.toString(),
    }));
  }

  return streamlined;
}
