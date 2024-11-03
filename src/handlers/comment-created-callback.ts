import { Context, SupportedEvents } from "../types";
import { CallbackResult } from "../types/proxy";
import { askQuestion } from "./ask-llm";
import { handleLlmQueryOutput } from "./llm-query-output";
import { sanitizeMetadata } from "../helpers/errors";
import { LogReturn } from "@ubiquity-os/ubiquity-os-logger";

export async function issueCommentCreatedCallback(
  context: Context<"issue_comment.created", SupportedEvents["issue_comment.created"]>
): Promise<CallbackResult> {
  const {
    logger,
    env: { UBIQUITY_OS_APP_NAME },
  } = context;
  const question = context.payload.comment.body.trim();
  const slugRegex = new RegExp(`^@${UBIQUITY_OS_APP_NAME}`, "i");

  if (!slugRegex.test(question)) {
    return { status: 204, reason: logger.info("Comment does not mention the app. Skipping.").logMessage.raw };
  }

  if (!question.length || question.replace(slugRegex, "").trim().length === 0) {
    return { status: 204, reason: logger.info("No question provided. Skipping.").logMessage.raw };
  }

  if (context.payload.comment.user?.type === "Bot") {
    return { status: 204, reason: logger.info("Comment is from a bot. Skipping.").logMessage.raw };
  }
  if (question.replace(slugRegex, "").trim().length === 0) {
    return { status: 204, reason: logger.info("Comment is empty. Skipping.").logMessage.raw };
  }
  logger.info(`Asking question: ${question}`);
  return await handleLlmQueryOutput(context, await askQuestion(context, question));
}

export function createStructuredMetadata(header: string | undefined, logReturn: LogReturn) {
  let logMessage, metadata;
  if (logReturn) {
    logMessage = logReturn.logMessage;
    metadata = logReturn.metadata;
  }

  const jsonPretty = sanitizeMetadata(metadata);
  const stackLine = new Error().stack?.split("\n")[2] ?? "";
  const caller = stackLine.match(/at (\S+)/)?.[1] ?? "";
  const ubiquityMetadataHeader = `\n\n<!-- Ubiquity - ${header} - ${caller} - ${metadata?.revision}`;

  let metadataSerialized: string;
  const metadataSerializedVisible = ["```json", jsonPretty, "```"].join("\n");
  const metadataSerializedHidden = [ubiquityMetadataHeader, jsonPretty, "-->"].join("\n");

  if (logMessage?.type === "fatal") {
    // if the log message is fatal, then we want to show the metadata
    metadataSerialized = [metadataSerializedVisible, metadataSerializedHidden].join("\n");
  } else {
    // otherwise we want to hide it
    metadataSerialized = metadataSerializedHidden;
  }

  return metadataSerialized;
}
