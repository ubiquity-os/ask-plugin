import { Context } from "../types";
import { CompletionsType } from "../adapters/openai/helpers/completions";
import { formatChatHistory } from "../helpers/format-chat-history";
import { fetchRepoDependencies, fetchRepoLanguageStats } from "./ground-truths/chat-bot";
import { findGroundTruths } from "./ground-truths/find-ground-truths";
import { bubbleUpErrorComment, logger } from "../helpers/errors";
import { fetchSimilarContent } from "../helpers/issue-fetching";

export async function askQuestion(context: Context, question: string): Promise<CompletionsType> {
  if (!question) {
    throw logger.error("No question provided");
  }

  context.logger.info("Asking LLM question: " + question);
  try {
    const {
      env: { UBIQUITY_OS_APP_NAME },
      config: { model, similarityThreshold, maxDepth },
      adapters: {
        supabase: { comment, issue },
        voyage: { reranker },
        openai: { completions },
      },
    } = context;

    // Calculate total available tokens
    const modelMaxTokens = completions.getModelMaxTokenLimit(model);
    const maxCompletionTokens = completions.getModelMaxOutputLimit(model);
    let availableTokens = modelMaxTokens - maxCompletionTokens;

    // Calculate base prompt tokens (system message + query template)
    const basePromptTokens = await completions.getPromptTokens();
    availableTokens -= basePromptTokens;
    logger.debug(`Base prompt tokens: ${basePromptTokens}`);

    // Find similar comments and issues from Supabase
    const [similarCommentsSearch, similarIssuesSearch] = await Promise.all([
      comment.findSimilarComments(question, 1 - similarityThreshold, ""),
      issue.findSimilarIssues(question, 1 - similarityThreshold, ""),
    ]);

    // Fetch full content for similar items using GitHub API
    const { similarIssues, similarComments } = await fetchSimilarContent(context, similarIssuesSearch || [], similarCommentsSearch || []);

    logger.debug(`Fetched similar comments: ${JSON.stringify(similarComments)}`);
    logger.debug(`Fetched similar issues: ${JSON.stringify(similarIssues)}`);

    // Rerank similar content
    const { similarIssues: rerankedIssues, similarComments: rerankedComments } = await reranker.reRankSimilarContent(question, similarIssues, similarComments);

    // Calculate token usage from reranked content
    const similarText = [
      ...rerankedComments.map((comment) => comment.body).filter((body): body is string => !!body),
      ...rerankedIssues.map((issue) => issue.body).filter((body): body is string => !!body),
    ];
    const similarTextTokens = await completions.findTokenLength(similarText.join("\n"));
    availableTokens -= similarTextTokens;
    logger.debug(`Similar text tokens: ${similarTextTokens}`);

    // Gather repository data and calculate ground truths
    const [languages, { dependencies, devDependencies }] = await Promise.all([fetchRepoLanguageStats(context), fetchRepoDependencies(context)]);

    // Initialize ground truths
    let groundTruths: string[] = [];
    if (!languages.length) groundTruths.push("No languages found in the repository");
    if (!Reflect.ownKeys(dependencies).length) groundTruths.push("No dependencies found in the repository");
    if (!Reflect.ownKeys(devDependencies).length) groundTruths.push("No devDependencies found in the repository");

    // If not all empty, get full ground truths
    if (groundTruths.length !== 3) {
      groundTruths = await findGroundTruths(context, "chat-bot", { languages, dependencies, devDependencies });
    }

    // Calculate ground truths tokens
    const groundTruthsTokens = await completions.findTokenLength(groundTruths.join("\n"));
    availableTokens -= groundTruthsTokens;
    logger.debug(`Ground truths tokens: ${groundTruthsTokens}`);

    // Get formatted chat history with remaining tokens and reranked content
    const formattedChat = await formatChatHistory(context, maxDepth, rerankedIssues, rerankedComments, availableTokens);
    logger.debug("Formatted chat history: " + formattedChat.join("\n"));

    // Create completion with all components
    return await completions.createCompletion(question, model, formattedChat, groundTruths, UBIQUITY_OS_APP_NAME);
  } catch (error) {
    throw bubbleUpErrorComment(context, error, false);
  }
}
