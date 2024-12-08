import { Context } from "../../types";

export async function canPerformReview(context: Context<"pull_request.opened" | "pull_request.ready_for_review">) {
  const { logger, payload } = context;
  const { number, organization, repository, action } = payload;
  const { owner, name } = repository;

  logger.info(`${organization}/${repository}#${number} - ${action}`);

  const timeline = await context.octokit.rest.issues.listEvents({
    owner: owner.login,
    repo: name,
    issue_number: number,
  });

  const reviews = timeline.data.filter((event) => event.event === "reviewed");
  const botReviews = reviews.filter((review) => review.actor.type === "Bot");

  if (!botReviews.length) {
    logger.info("No bot reviews found");
    return true;
  }

  const lastReview = botReviews[botReviews.length - 1];
  const lastReviewDate = new Date(lastReview.created_at);
  const now = new Date();

  const diff = now.getTime() - lastReviewDate.getTime();
  const ONE_DAY = 24 * 60 * 60 * 1000;

  if (diff < ONE_DAY) {
    throw logger.error("Only one review per day is allowed");
  }

  logger.info("One review per day check passed");

  return true;
}
