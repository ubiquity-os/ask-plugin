import { Context } from "../../types";
import { getOwnerRepoIssueNumberFromUrl } from "../get-owner-repo-issue-from-url";
import { checkIfPrClosesIssues } from "../gql-functions";

export async function getTaskNumberFromPullRequest(context: Context<"pull_request.opened" | "pull_request.ready_for_review">) {
  const {
    payload: { pull_request },
    logger,
  } = context;
  let issueNumber;

  const { issues: closingIssues } = await checkIfPrClosesIssues(context.octokit, {
    owner: pull_request.base.repo.owner.login,
    repo: pull_request.base.repo.name,
    pr_number: pull_request.number,
  });

  if (closingIssues.length === 0) {
    const linkedViaBodyHash = pull_request.body?.match(/#(\d+)/g);
    const urlMatch = getOwnerRepoIssueNumberFromUrl(pull_request.body);

    if (linkedViaBodyHash?.length) {
      issueNumber = Number(linkedViaBodyHash[0].replace("#", ""));
    }

    if (urlMatch && !issueNumber) {
      issueNumber = Number(urlMatch.issueNumber);
    }
  } else if (closingIssues.length > 1) {
    throw logger.error("Multiple tasks linked to this PR, needs investigated to see how best to handle it.", {
      closingIssues,
      pull_request,
    });
  } else {
    issueNumber = closingIssues[0].number;
  }

  if (!issueNumber) {
    throw logger.error("Task number not found", { pull_request });
  }

  return issueNumber;
}
