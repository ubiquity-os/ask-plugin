import { ResponseFromLlm } from "../adapters/openai/types";
import { bubbleUpErrorComment } from "../helpers/errors";
import { Context } from "../types";
import { CallbackResult } from "../types/proxy";
import { addCommentToIssue } from "./add-comment";
import { createStructuredMetadata } from "./comment-created-callback";

export async function handleLlmQueryOutput(context: Context, llmResponse: ResponseFromLlm): Promise<CallbackResult> {
  const { logger } = context;
  try {
    const { answer, tokenUsage, groundTruths } = llmResponse;
    if (!answer) {
      throw logger.error(`No answer from OpenAI`);
    }
    logger.info(`Answer: ${answer}`, { tokenUsage });

    const metadataString = createStructuredMetadata(
      // don't change this header, it's used for tracking
      "ubiquity-os-llm-response",
      logger.info(`Answer: ${answer}`, {
        metadata: {
          groundTruths,
          tokenUsage,
        },
      })
    );

    await addCommentToIssue(context, answer + metadataString);
    return { status: 200, reason: logger.info("Comment posted successfully").logMessage.raw };
  } catch (error) {
    throw await bubbleUpErrorComment(context, error, false);
  }
}
