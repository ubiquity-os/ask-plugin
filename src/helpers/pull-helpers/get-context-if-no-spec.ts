import { Context } from "../../types";
import { logger } from "../errors";
import { formatChatHistory } from "../format-chat-history";
import { recursivelyFetchLinkedIssues } from "../issue-fetching";

export async function getContextIfNoSpecFound(
  context: Context<"pull_request.opened" | "pull_request.ready_for_review">,
  owner: string,
  repo: string,
  issueNumber: number
) {
  logger.info(`No spec found for PR #${issueNumber} in ${owner}/${repo}`);
  const { data: prAsIssue } = await context.octokit.issues.get({
    owner,
    repo,
    issue_number: 11, // remove after QA
  });
  const { specAndBodies, streamlinedComments } = await recursivelyFetchLinkedIssues({
    context,
    owner: context.payload.repository.owner.login,
    repo: context.payload.repository.name,
    issueNum: context.payload.pull_request.number,
  });
  const formattedChat = await formatChatHistory(
    {
      ...context,
      eventName: "issue_comment.created",
      payload: {
        ...context.payload,
        action: "created",
        issue: prAsIssue as Context<"issue_comment.created">["payload"]["issue"],
        comment: { body: prAsIssue.body } as Context<"issue_comment.created">["payload"]["comment"],
        sender: { login: prAsIssue.user?.login } as Context<"issue_comment.created">["payload"]["sender"],
        repository: { owner: { login: owner }, name: repo } as Context<"issue_comment.created">["payload"]["repository"],
      } as Context<"issue_comment.created">["payload"],
    },
    streamlinedComments,
    specAndBodies
  );

  return formattedChat.join("");
}
