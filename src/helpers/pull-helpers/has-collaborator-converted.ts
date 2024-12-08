import { Context } from "../../types";

export async function hasCollaboratorConvertedPr(context: Context<"pull_request.opened" | "pull_request.ready_for_review">) {
  const { logger, payload, octokit } = context;
  const { number, organization, repository, action, pull_request } = payload;
  const { owner, name } = repository;

  logger.info(`${organization}/${repository}#${number} - ${action}`);

  const timeline = await context.octokit.rest.issues.listEvents({
    owner: owner.login,
    repo: name,
    issue_number: number,
  });

  const usersThatConvertedToDraft = timeline.data.filter((event) => event.event === "converted_to_draft").map((event) => event.actor.login);
  const usersThatReadiedForReview = timeline.data.filter((event) => event.event === "ready_for_review").map((event) => event.actor.login);

  const reviews = await octokit.rest.pulls.listReviews({
    owner: owner.login,
    repo: name,
    pull_number: number,
  });

  const reviewers = reviews.data
    .filter((review) => review.user?.type === "User" && review.author_association === "COLLABORATOR" && review.user?.login !== pull_request.user.login)
    .map((review) => review.user?.login)
    .filter((login): login is string => !!login);

  return reviewers?.some((reviewer) => usersThatConvertedToDraft.includes(reviewer) || usersThatReadiedForReview.includes(reviewer));
}
