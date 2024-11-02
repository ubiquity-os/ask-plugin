import { Context } from "../types";
import { CompletionsType, Citation } from "../adapters/openai/helpers/completions";

/**
 * Formats a response with citations
 * @param response - The completion response from GPT
 * @returns The formatted response string
 */
function formatResponse(response: CompletionsType): string {
  const formattedResponse = response.answer;

  // Add citations section if there are citations
  if (response.citations && response.citations.length > 0) {
    // Sort citations by reference number to ensure proper ordering
    const sortedCitations = [...response.citations].sort((a, b) => {
      const aNum = parseInt(a.reference.match(/\^(\d+)\^/)?.[1] || "0");
      const bNum = parseInt(b.reference.match(/\^(\d+)\^/)?.[1] || "0");
      return aNum - bNum;
    });

    const citationsText = sortedCitations
      .map((c: Citation) => {
        if (c.url) {
          const type = c.url.includes("#comment") ? "Comment" : "Issue";
          return `${c.reference}: ${c.description} [GitHub ${type}](${c.url})`;
        }
        return `${c.reference}: ${c.description}`;
      })
      .join("\n");
    return `${formattedResponse}\n\nCitations:\n${citationsText}`;
  }

  return formattedResponse;
}
import { bubbleUpErrorComment } from "../helpers/errors";

/**
 * Asks a question to GPT and returns the response
 * @param context - The context object containing environment and configuration details
 * @param question - The question to ask GPT
 * @returns The response from GPT
 * @throws If no question is provided
 */
export async function askQuestion(context: Context, question: string) {
  if (!question) {
    throw context.logger.error("No question provided");
  }

  const response = await askGpt(context, question);
  context.logger.info(`Answer: ${response.answer}`, {
    caller: "_Logs.<anonymous>",
    tokenUsage: {
      input: response.tokenUsage.input,
      output: response.tokenUsage.output,
      total: response.tokenUsage.total,
    },
  });
  return formatResponse(response);
}

/**
 * Asks GPT a question and returns the completions
 * @param context - The context object containing environment and configuration details
 * @param question - The question to ask GPT
 * @returns completions - The completions generated by GPT
 **/
export async function askGpt(context: Context, question: string): Promise<CompletionsType> {
  const {
    env: { UBIQUITY_OS_APP_NAME },
    config: { model, maxTokens },
  } = context;

  //Calculate the current context size in tokens
  const numTokens = await context.adapters.openai.completions.findTokenLength(question);
  context.logger.info(`Number of tokens: ${numTokens}`);

  return context.adapters.openai.completions.createCompletion(
    question,
    model,
    [], // Empty ground truths array - will be fetched by tool if needed
    UBIQUITY_OS_APP_NAME,
    maxTokens
  );
}
