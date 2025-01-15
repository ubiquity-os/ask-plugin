/// Implementation of the LLM question answering system
/// This module handles asking questions to the LLM using context from issues,
/// comments, and repository information. It now uses a weighted comment system
/// based on reactions and edit history instead of Supabase similarity search.

import { Context } from "../types";
import { CompletionsType } from "../adapters/openai/helpers/completions";
import { recursivelyFetchLinkedIssues } from "../helpers/issue-fetching";
import { formatChatHistory } from "../helpers/format-chat-history";
import { fetchRepoDependencies, fetchRepoLanguageStats } from "./ground-truths/chat-bot";
import { findGroundTruths } from "./ground-truths/find-ground-truths";
import { bubbleUpErrorComment, logger } from "../helpers/errors";
import { calculateTextScore } from "../helpers/trigram-weights";
import { StreamlinedComment } from "../types/llm";

/// Find most relevant comments based on weights and similarity to question
/// Uses the new weighted comments system that combines reactions and edit history
/// to determine relevance along with textual similarity to the question
async function findRelevantComments(question: string, comments: StreamlinedComment[], threshold: number, maxResults: number = 5): Promise<string[]> {
  /// Sort comments by their weight and similarity to question
  const scoredComments = comments
    .filter((c) => c.body)
    .map((comment) => ({
      comment,
      /// Combine the comment's weight from reactions/edits with its similarity score
      score: (comment.weight || 0) + calculateTextScore(question, [comment]),
    }))
    .sort((a, b) => b.score - a.score);

  /// Take top results above threshold
  return scoredComments
    .filter((c) => c.score >= threshold)
    .slice(0, maxResults)
    .map((c) => c.comment.body || "")
    .filter(Boolean);
}

export async function askQuestion(context: Context, question: string) {
  if (!question) {
    throw logger.error("No question provided");
  }

  /// Using any links in comments or issue/pr bodies to fetch more context
  const { specAndBodies, streamlinedComments } = await recursivelyFetchLinkedIssues({
    context,
    owner: context.payload.repository.owner.login,
    repo: context.payload.repository.name,
  });

  /// Get all comments as a flat array for processing
  const allComments = Object.values(streamlinedComments).flat();

  /// Find relevant comments based on weights and question similarity
  /// This replaces the previous Supabase similarity search with our new weighted system
  const relevantComments = await findRelevantComments(question, allComments, context.config.similarityThreshold);

  /// Build a nicely structured system message containing a streamlined chat history
  /// Includes the current issue, any linked issues, and any linked PRs
  const formattedChat = await formatChatHistory(context, streamlinedComments, specAndBodies);
  logger.info(`${formattedChat.join("")}`);

  return await askLlm(context, question, formattedChat, relevantComments, allComments);
}

export async function askLlm(
  context: Context,
  question: string,
  formattedChat: string[],
  relevantComments: string[],
  weightedComments: StreamlinedComment[]
): Promise<CompletionsType> {
  const {
    env: { UBIQUITY_OS_APP_NAME },
    config: { model, maxTokens },
    adapters: {
      openai: { completions },
    },
  } = context;

  try {
    /// Filter out any empty strings from the chat history
    formattedChat = formattedChat.filter((text) => text);

    /// Gather structural data about the payload repository
    const [languages, { dependencies, devDependencies }] = await Promise.all([fetchRepoLanguageStats(context), fetchRepoDependencies(context)]);

    let groundTruths: string[] = [];

    if (!languages.length) {
      groundTruths.push("No languages found in the repository");
    }

    if (!Reflect.ownKeys(dependencies).length) {
      groundTruths.push("No dependencies found in the repository");
    }

    if (!Reflect.ownKeys(devDependencies).length) {
      groundTruths.push("No devDependencies found in the repository");
    }

    if (groundTruths.length === 3) {
      return await completions.createCompletionWithHF(
        10,
        question,
        model,
        relevantComments,
        formattedChat,
        groundTruths,
        UBIQUITY_OS_APP_NAME,
        maxTokens,
        weightedComments
      );
    }

    groundTruths = await findGroundTruths(context, "chat-bot", {
      languages,
      dependencies,
      devDependencies,
    });

    return await completions.createCompletionWithHF(
      10,
      question,
      model,
      relevantComments,
      formattedChat,
      groundTruths,
      UBIQUITY_OS_APP_NAME,
      maxTokens,
      weightedComments
    );
  } catch (error) {
    throw bubbleUpErrorComment(context, error, false);
  }
}
