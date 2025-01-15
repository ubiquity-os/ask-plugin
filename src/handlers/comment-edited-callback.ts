import { bubbleUpErrorComment } from "../helpers/errors";
import { Context, SupportedEvents } from "../types";
import { CallbackResult } from "../types/proxy";
import { handleUpdatedWeights } from "./rlhf/handle-updates";

export async function issueCommentEditedCallback(context: Context<"issue_comment.edited">): Promise<CallbackResult> {
  try {
    await handleUpdatedWeights(context);
    context.logger.info("Weights updated successfully");
    return {
      status: 200,
      reason: "Weights updated successfully",
    };
  } catch (error) {
    throw await bubbleUpErrorComment(context, error, false);
  }
}
