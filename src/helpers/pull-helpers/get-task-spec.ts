import { Context } from "../../types";
import { getOwnerRepoIssueNumberFromUrl } from "../get-owner-repo-issue-from-url";
import { checkIfPrClosesIssues } from "../gql-functions";
import { fetchIssue } from "../issue-fetching";
import { getContextIfNoSpecFound } from "./get-context-if-no-spec";

export async function getTaskSpecFromPullRequest(
  context: Context<"pull_request.opened" | "pull_request.ready_for_review">,
  repoOwner: string,
  repoName: string,
  fallbackToConvo: boolean = false
) {
  const {
    payload: { pull_request },
    logger,
  } = context;
  let taskSpec;
  let owner, repo, issueNumber;

  const { issues: closingIssues } = await checkIfPrClosesIssues(context.octokit, {
    owner: pull_request.base.repo.owner.login,
    repo: pull_request.base.repo.name,
    pr_number: pull_request.number,
  });

  if (closingIssues.length === 0) {
    const linkedViaBodyHash = pull_request.body?.match(/#(\d+)/g);
    const urlMatch = getOwnerRepoIssueNumberFromUrl(pull_request.body);

    if (linkedViaBodyHash?.length) {
      const issueNumber = linkedViaBodyHash[0].replace("#", "");
      const issue = await fetchIssue({ context, owner: repoOwner, repo: repoName, issueNum: Number(issueNumber) });
      taskSpec = issue?.body;
    }

    if (urlMatch && !taskSpec) {
      owner = urlMatch.owner;
      repo = urlMatch.repo;
      issueNumber = urlMatch.issueNumber;
      const issue = await fetchIssue({ context, owner, repo, issueNum: Number(issueNumber) });
      taskSpec = issue?.body;
    }
  } else if (closingIssues.length > 1) {
    throw logger.error("Multiple tasks linked to this PR, needs investigated to see how best to handle it.", {
      closingIssues,
      pull_request,
    });
  } else {
    taskSpec = closingIssues[0].body;
  }

  if (!taskSpec) {
    throw logger.error("Task spec not found", { pull_request });
  }

  if (!taskSpec && fallbackToConvo) {
    taskSpec = await getContextIfNoSpecFound(context, repoOwner, repoName, pull_request.number);
  }

  return taskSpec;
}
