import { PULL_PRECHECK_SYSTEM_MESSAGE } from "../adapters/openai/helpers/prompts";
import { fetchPullRequestDiff } from "../helpers/issue-fetching";
import { canPerformReview } from "../helpers/pull-helpers/can-perform-review";
import { getTaskSpecFromPullRequest } from "../helpers/pull-helpers/get-task-spec";
import { hasCollaboratorConvertedPr } from "../helpers/pull-helpers/has-collaborator-converted";
import { Context, SupportedEvents } from "../types";
import { CallbackResult } from "../types/proxy";
import { findGroundTruths } from "./find-ground-truths";
import { handleChat } from "../adapters/openai/helpers/call-handler";
// import { handleLlmQueryOutput } from "./llm-query-output";

export async function performPullPrecheck(
  context: Context<"pull_request.opened" | "pull_request.ready_for_review", SupportedEvents["pull_request.opened" | "pull_request.ready_for_review"]>
): Promise<CallbackResult> {
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

  return await handleCodeReview(context);
}

export async function handleCodeReview(context: Context<"pull_request.opened" | "pull_request.ready_for_review">): Promise<CallbackResult> {
  const {
    logger,
    payload,
    config: { model },
    env: { UBIQUITY_OS_APP_NAME },
  } = context;
  let {
    repository: {
      owner: { login: repoOwner },
      name: repoName,
    },
  } = payload;
  const taskSpec = await getTaskSpecFromPullRequest(context, repoOwner, repoName);

  repoOwner = "ubiquity-os-marketplace"; // remove after QA
  repoName = "command-ask"; // remove after QA
  const prDiff = await fetchPullRequestDiff(context, repoOwner, repoName, 11 /* remove after QA*/);
  if (!prDiff) {
    throw logger.error("PR Diff not found");
  }

  const creationOptions = {
    systemMessage: PULL_PRECHECK_SYSTEM_MESSAGE,
    prompt: "What's missing compared to the spec?",
    model,
    additionalContext: [prDiff, taskSpec],
    localContext: [],
    groundTruths: await findGroundTruths(context, taskSpec),
    botName: UBIQUITY_OS_APP_NAME,
  };

  const llmResponse = await handleChat(context, [
    { role: "system", content: creationOptions.systemMessage },
    { role: "user", content: creationOptions.prompt },
  ]);
  console.log(creationOptions, llmResponse);
  return { status: 200, reason: "Success" };
  // const llmResponse = await context.adapters.openai.completions.createCompletion(creationOptions);
  // return handleLlmQueryOutput(context, llmResponse);
}
