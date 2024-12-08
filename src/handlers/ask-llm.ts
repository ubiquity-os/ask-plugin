import { Context } from "../types";
import { CompletionsType } from "../adapters/openai/helpers/completions";
import { CommentSimilaritySearchResult } from "../adapters/supabase/helpers/comment";
import { IssueSimilaritySearchResult } from "../adapters/supabase/helpers/issues";
import { fetchIssue, recursivelyFetchLinkedIssues } from "../helpers/issue-fetching";
import { formatChatHistory, formatSpecAndPull } from "../helpers/format-chat-history";
import { fetchRepoDependencies, fetchRepoLanguageStats } from "./ground-truths/chat-bot";
import { findGroundTruths } from "./ground-truths/find-ground-truths";
import { bubbleUpErrorComment, logger } from "../helpers/errors";
import { getTaskNumberFromPullRequest } from "../helpers/pull-helpers/get-task-spec";

export async function askQuestion(context: Context<"issue_comment.created">, question: string) {
  if (!question) {
    throw logger.error("No question provided");
  }
  // using any links in comments or issue/pr bodies to fetch more context
  const { specAndBodies, streamlinedComments } = await recursivelyFetchLinkedIssues({
    context,
    owner: context.payload.repository.owner.login,
    repo: context.payload.repository.name,
  });
  // build a nicely structure system message containing a streamlined chat history
  // includes the current issue, any linked issues, and any linked PRs
  const formattedChat = await formatChatHistory(context, streamlinedComments, specAndBodies);
  logger.info(`${formattedChat.join("")}`);
  return await askLlm(context, question, formattedChat);
}

export async function pullReview(context: Context<"pull_request.opened" | "pull_request.ready_for_review">) {
  const {
    env: { UBIQUITY_OS_APP_NAME },
    config: { anthropicAiModel },
    adapters: {
      anthropic: { completions },
    },
  } = context;

  const taskNumber = await getTaskNumberFromPullRequest(context);

  const issue = await fetchIssue({
    context,
    owner: context.payload.repository.owner.login,
    repo: context.payload.repository.name,
    issueNum: taskNumber,
  });

  if (!issue) {
    throw logger.error(`Error fetching issue, Aborting`, {
      owner: context.payload.repository.owner.login,
      repo: context.payload.repository.name,
      issue_number: taskNumber,
    });
  }

  const taskSpecification = issue.body ?? "";
  const formattedSpecAndPull = await formatSpecAndPull(context, issue);
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
    return await completions.createCompletion(
      anthropicAiModel,
      formattedSpecAndPull,
      groundTruths,
      UBIQUITY_OS_APP_NAME,
      completions.getModelMaxTokenLimit(anthropicAiModel)
    );
  }
  groundTruths = await findGroundTruths(context, "code-review", { taskSpecification });
  return await completions.createCompletion(
    anthropicAiModel,
    formattedSpecAndPull,
    groundTruths,
    UBIQUITY_OS_APP_NAME,
    completions.getModelMaxTokenLimit(anthropicAiModel)
  );
}

export async function askLlm(context: Context, question: string, formattedChat: string[]): Promise<CompletionsType> {
  const {
    env: { UBIQUITY_OS_APP_NAME },
    config: { openAiModel, similarityThreshold, maxTokens },
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

    // rerank the similar text using voyageai
    const rerankedText = similarText.length > 0 ? await reranker.reRankResults(similarText, question) : [];
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
      return await completions.createCompletion(question, openAiModel, rerankedText, formattedChat, groundTruths, UBIQUITY_OS_APP_NAME, maxTokens);
    }

    groundTruths = await findGroundTruths(context, "chat-bot", { languages, dependencies, devDependencies });
    return await completions.createCompletion(question, openAiModel, rerankedText, formattedChat, groundTruths, UBIQUITY_OS_APP_NAME, maxTokens);
  } catch (error) {
    throw bubbleUpErrorComment(context, error, false);
  }
}
