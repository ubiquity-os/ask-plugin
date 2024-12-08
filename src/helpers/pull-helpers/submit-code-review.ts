import { Context } from "../../types";
import { CodeReviewStatus } from "../../types/pull-requests";

export async function submitCodeReview(context: Context<"pull_request.opened" | "pull_request.ready_for_review">, review: string, status: CodeReviewStatus) {
  const { logger, payload } = context;
  const { number, sender, organization, repository, action } = payload;
  const { owner, name } = repository;

  logger.info(`${organization}/${repository}#${number} - ${action} - ${sender.login} - ${review}`);

  try {
    const response = await context.octokit.rest.pulls.createReview({
      owner: owner.login,
      repo: name,
      pull_number: number,
      body: review,
      event: status,
    });

    logger.info(`Code review submitted: ${response.data.html_url}`);
  } catch (er) {
    throw logger.error("Failed to submit code review", { err: er });
  }
}
