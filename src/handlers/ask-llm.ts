import { Context } from "../types";
import { CommentSimilaritySearchResult } from "../adapters/supabase/helpers/comment";
import { IssueSimilaritySearchResult } from "../adapters/supabase/helpers/issues";
import { recursivelyFetchLinkedIssues } from "../helpers/issue-fetching";
import { formatChatHistory } from "../helpers/format-chat-history";
import { fetchRepoDependencies, fetchRepoLanguageStats } from "./ground-truths/chat-bot";
import { findGroundTruths } from "./ground-truths/find-ground-truths";
import { bubbleUpErrorComment, logger } from "../helpers/errors";
import { ResponseFromLlm } from "../adapters/openai/types";
import { CHATBOT_DEFAULT_SYSTEM_MESSAGE } from "../adapters/openai/helpers/prompts";

export async function askQuestion(context: Context<"issue_comment.created">, question: string) {
  if (!question) {
    throw logger.error("No question provided");
  }
  // using any links in comments or issue/pr bodies to fetch more context
  const { specAndBodies, streamlinedComments } = await recursivelyFetchLinkedIssues({
    context,
    owner: context.payload.repository.owner.login,
    repo: context.payload.repository.name,
    issueNum: context.payload.issue.number,
  });
  // build a nicely structure system message containing a streamlined chat history
  // includes the current issue, any linked issues, and any linked PRs
  const formattedChat = await formatChatHistory(context, streamlinedComments, specAndBodies);
  logger.info(`${formattedChat.join("")}`);
  return await askLlm(context, question, formattedChat);
}

export async function askLlm(context: Context, question: string, formattedChat: string[]): Promise<ResponseFromLlm> {
  const {
    env: { UBIQUITY_OS_APP_NAME },
    config: { model, similarityThreshold, maxTokens },
    adapters: {
      supabase: { comment, issue },
      voyage: { reranker },
      openai: { completions },
    },
  } = context;

  try {
    // using db functions to find similar comments and issues
    const [similarComments, similarIssues] = await Promise.all([
      comment.findSimilarComments(question, 1 - similarityThreshold, ""),
      issue.findSimilarIssues(question, 1 - similarityThreshold, ""),
    ]);

    // combine the similar comments and issues into a single array
    const similarText = [
      ...(similarComments?.map((comment: CommentSimilaritySearchResult) => comment.comment_plaintext) || []),
      ...(similarIssues?.map((issue: IssueSimilaritySearchResult) => issue.issue_plaintext) || []),
    ];

    // filter out any empty strings
    formattedChat = formattedChat.filter((text) => text);

    logger.info(`Found similar texts: pre-rerank`, {
      similarComments,
      similarIssues,
    });

    // rerank the similar text using voyageai
    const rerankedText = similarText.length > 0 ? await reranker.reRankResults(similarText, question) : [];

    logger.info(`Found similar texts: post-rerank`, {
      rerankedText,
    });

    // gather structural data about the payload repository
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
      return await completions.createCompletion({
        systemMessage: CHATBOT_DEFAULT_SYSTEM_MESSAGE,
        query: question,
        model,
        additionalContext: rerankedText,
        localContext: formattedChat,
        groundTruths,
        botName: UBIQUITY_OS_APP_NAME,
        maxTokens,
      });
    }

    groundTruths = await findGroundTruths(context, "chat-bot", { languages, dependencies, devDependencies });
    return await completions.createCompletion({
      systemMessage: CHATBOT_DEFAULT_SYSTEM_MESSAGE,
      query: question,
      model,
      additionalContext: rerankedText,
      localContext: formattedChat,
      groundTruths,
      botName: UBIQUITY_OS_APP_NAME,
      maxTokens,
    });
  } catch (error) {
    throw bubbleUpErrorComment(context, error, false);
  }
}
