import OpenAI from "openai";
import { Context } from "../../../types";
import { SuperOpenAi } from "./openai";
import { logger } from "../../../helpers/errors";
import { appendToConversation } from "./append-to-base-chat-history";
import { getAnswerAndTokenUsage } from "./get-answer-and-token-usage";
import { CreationParams, ResponseFromLlm, ToolCallResponse } from "../types";
import { MAX_COMPLETION_TOKENS } from "../constants";
// import { LLM_TOOLS } from "./llm-tools";

export class Completions extends SuperOpenAi {
  protected context: Context;

  constructor(client: OpenAI, context: Context) {
    super(client, context);
    this.context = context;
  }

  async createCompletion(params: CreationParams, messages?: OpenAI.Chat.Completions.ChatCompletionMessageParam[]): Promise<ResponseFromLlm> {
    const { model } = params;
    const res: OpenAI.Chat.Completions.ChatCompletion = await this.client.chat.completions.create({
      // tools: LLM_TOOLS, might not be a good idea to have this available for the general chatbot
      model: model,
      messages: messages || appendToConversation(params),
      temperature: 0.2,
      // This value is now deprecated in favor of max_completion_tokens, and is not compatible with o1 series models.
      // max_COMPLETION_tokens: MAX_COMPLETION_TOKENS,

      /**An upper bound for the number of tokens that can be generated for a completion, including visible output tokens and reasoning tokens. */
      max_completion_tokens: MAX_COMPLETION_TOKENS,
      top_p: 0.5,
      frequency_penalty: 0,
      presence_penalty: 0,
      response_format: {
        type: "text",
      },
    });

    await this.handleFunctionCalling(res, params);

    return getAnswerAndTokenUsage(res);
  }

  async handleFunctionCalling(res: OpenAI.Chat.Completions.ChatCompletion, params: CreationParams) {
    const { systemMessage, prompt, model, additionalContext, localContext, groundTruths, botName } = params;
    if (res.choices[0].finish_reason === "function_call") {
      const toolCalls = res.choices[0].message.tool_calls;
      const choiceMessage = res.choices[0]["message"];

      if (!toolCalls) {
        return;
      }

      const fnCallResults: ToolCallResponse[] = [];

      for (const toolCall of toolCalls) {
        const { name, arguments: args } = toolCall.function;
        let parsedArgs: { should_convert: boolean } = JSON.parse(args);

        if (name === "convert_pull_request_to_draft") {
          try {
            parsedArgs = JSON.parse(args);
          } catch (er) {
            throw logger.error("Error parsing args for convert_pull_request_to_draft", {
              args,
              er,
            });
          }
          let fnCallResponse;

          if (!parsedArgs.should_convert) {
            fnCallResponse = {
              role: "tool",
              content: "pull request meets the specification, no action taken.",
              tool_call_id: toolCall.id,
            };
          } else {
            let number;

            if ("pull_request" in this.context.payload) {
              number = this.context.payload.pull_request.number;
            } else if ("issue" in this.context.payload) {
              number = this.context.payload.issue.number;
            }

            if (!number) {
              throw logger.error("No pull request or issue number found in payload");
            }

            await this.context.octokit.pulls.update({
              owner: this.context.payload.repository.owner.login,
              repo: this.context.payload.repository.name,
              pull_number: number,
              draft: true,
            });

            fnCallResponse = {
              role: "tool",
              content: "pull request did not meet the specification, converted to draft.",
              tool_call_id: toolCall.id,
            };
          }

          fnCallResults.push({
            response: choiceMessage,
            tool_call_response: {
              content: fnCallResponse.content,
              role: "tool",
              tool_call_id: toolCall.id,
            },
          });
        }
      }
      const newChat = appendToConversation(params, fnCallResults);

      return await this.createCompletion(
        {
          systemMessage,
          prompt,
          model,
          additionalContext,
          localContext,
          groundTruths,
          botName,
        },
        newChat
      );
    }
  }
}
