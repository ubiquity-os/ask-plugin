import { CallbackResult } from "../types/proxy";
import { Context } from "../types";
import { pullReview } from "./ask-llm";
import { hasCollaboratorConvertedPr } from "../helpers/pull-helpers/has-collaborator-converted";
import { canPerformReview } from "../helpers/pull-helpers/can-perform-review";
import { convertPullToDraft } from "../helpers/pull-helpers/convert-pull-to-draft";
import { submitCodeReview } from "../helpers/pull-helpers/submit-code-review";

export async function performPullPrecheck(context: Context<"pull_request.opened" | "pull_request.ready_for_review">): Promise<CallbackResult> {
  const { logger, payload } = context;
  const { pull_request } = payload;

  // Check if PR is in draft mode, closed, or if we can perform a review
  if (pull_request.draft) {
    return { status: 200, reason: logger.info("PR is in draft mode, no action required").logMessage.raw };
  } else if (pull_request.state === "closed") {
    return { status: 200, reason: logger.info("PR is closed, no action required").logMessage.raw };
  } else if (!(await canPerformReview(context))) {
    return { status: 200, reason: logger.info("Cannot perform review at this time").logMessage.raw };
  } else if (await hasCollaboratorConvertedPr(context)) {
    return { status: 200, reason: logger.info("Collaborator has converted the PR, no action required").logMessage.raw };
  }
  await handleCodeReview(context);

  return { status: 200, reason: logger.info("HEY").logMessage.raw };
}

export async function handleCodeReview(context: Context<"pull_request.opened" | "pull_request.ready_for_review">) {
  const { payload } = context;

  const pullReviewData = await pullReview(context);
  let confidenceThreshold: number;
  try {
    const pullReviewAnswer = JSON.parse(pullReviewData.answer) as { confidenceThreshold: number };
    if ("confidenceThreshold" in pullReviewAnswer) {
      confidenceThreshold = pullReviewAnswer.confidenceThreshold;
    } else {
      throw context.logger.error("Unexpectdly recieved an invalid json resukt, Aborting");
    }
  } catch (e) {
    throw context.logger.error("Unexpectdly recieved a non json compatible result, Aborting", { e });
  }

  context.logger.info(
    await convertPullToDraft(confidenceThreshold < 0.5, {
      nodeId: payload.pull_request.node_id,
      octokit: context.octokit,
    })
  );

  if (confidenceThreshold > 0.5) {
    await submitCodeReview(context, "This pull request has passed the automated review, a reviewer will review this pull request shortly", "COMMENT");
  }
}
