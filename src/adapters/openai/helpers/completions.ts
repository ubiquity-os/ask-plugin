import OpenAI from "openai";
import { Context } from "../../../types";
import { SuperOpenAi } from "./openai";
import { logger } from "../../../helpers/errors";
import { appendToConversation } from "./append-to-base-chat-history";
import { getAnswerAndTokenUsage } from "./get-answer-and-token-usage";
import { CreationParams, ResponseFromLlm, ToolCallResponse } from "../types";
import { MAX_COMPLETION_TOKENS } from "../constants";
import { CompletionsModelHelper, ModelApplications } from "../../../types/llm";
import { encode } from "gpt-tokenizer";

export interface CompletionsType {
  answer: string;
  groundTruths: string[];
  tokenUsage: {
    input: number;
    output: number;
    total: number;
  };
}

export class Completions extends SuperOpenAi {
  protected context: Context;

  constructor(client: OpenAI, context: Context) {
    super(client, context);
    this.context = context;
  }

  getModelMaxTokenLimit(model: string): number {
    // could be made more robust, unfortunately, there's no endpoint to get the model token limit
    const tokenLimits = new Map<string, number>([
      ["o1-mini", 128_000],
      ["o1-preview", 128_000],
      ["gpt-4-turbo", 128_000],
      ["gpt-4o", 128_000],
      ["gpt-4o-mini", 128_000],
      ["gpt-4", 8_192],
      ["gpt-3.5-turbo-0125", 16_385],
      ["gpt-3.5-turbo", 16_385],
    ]);

    return tokenLimits.get(model) || 128_000;
  }

  getModelMaxOutputLimit(model: string): number {
    // could be made more robust, unfortunately, there's no endpoint to get the model token limit
    const tokenLimits = new Map<string, number>([
      ["o1-mini", 65_536],
      ["o1-preview", 32_768],
      ["gpt-4-turbo", 4_096],
      ["gpt-4o-mini", 16_384],
      ["gpt-4o", 16_384],
      ["gpt-4", 8_192],
      ["gpt-3.5-turbo-0125", 4_096],
      ["gpt-3.5-turbo", 4_096],
    ]);

    return tokenLimits.get(model) || 16_384;
  }

  async getModelTokenLimit(): Promise<number> {
    return this.getModelMaxTokenLimit("o1-mini");
  }


  async createCompletion(
    {
      query,
      model,
      additionalContext,
      localContext,
      groundTruths,
      botName,
      maxTokens,
    }: {
      query: string,
      model: string,
      additionalContext: string[],
      localContext: string[],
      groundTruths: string[],
      botName: string,
      maxTokens: number
    }
  ): Promise<CompletionsType> {
    const numTokens = await this.findTokenLength(query, additionalContext, localContext, groundTruths);
    logger.info(`Number of tokens: ${numTokens}`);

    const sysMsg = [
      "You Must obey the following ground truths: ",
      JSON.stringify(groundTruths) + "\n",
      "You are tasked with assisting as a GitHub bot by generating responses based on provided chat history and similar responses, focusing on using available knowledge within the provided corpus, which may contain code, documentation, or incomplete information. Your role is to interpret and use this knowledge effectively to answer user questions.\n\n# Steps\n\n1. **Understand Context**: Review the chat history and any similar provided responses to understand the context.\n2. **Extract Relevant Information**: Identify key pieces of information, even if they are incomplete, from the available corpus.\n3. **Apply Knowledge**: Use the extracted information and relevant documentation to construct an informed response.\n4. **Draft Response**: Compile the gathered insights into a coherent and concise response, ensuring it's clear and directly addresses the user's query.\n5. **Review and Refine**: Check for accuracy and completeness, filling any gaps with logical assumptions where necessary.\n\n# Output Format\n\n- Concise and coherent responses in paragraphs that directly address the user's question.\n- Incorporate inline code snippets or references from the documentation if relevant.\n\n# Examples\n\n**Example 1**\n\n*Input:*\n- Chat History: \"What was the original reason for moving the LP tokens?\"\n- Corpus Excerpts: \"It isn't clear to me if we redid the staking yet and if we should migrate. If so, perhaps we should make a new issue instead. We should investigate whether the missing LP tokens issue from the MasterChefV2.1 contract is critical to the decision of migrating or not.\"\n\n*Output:*\n\"It was due to missing LP tokens issue from the MasterChefV2.1 Contract.\n\n# Notes\n\n- Ensure the response is crafted from the corpus provided, without introducing information outside of what's available or relevant to the query.\n- Consider edge cases where the corpus might lack explicit answers, and justify responses with logical reasoning based on the existing information.",
      `Your name is: ${botName}`,
      "\n",
      "Main Context (Provide additional precedence in terms of information): ",
      localContext.join("\n"),
      "Secondary Context: ",
      additionalContext.join("\n"),
    ].join("\n");

    logger.info(`System message: ${sysMsg}`);
    logger.info(`Query: ${query}`);

    const res: OpenAI.Chat.Completions.ChatCompletion = await this.client.chat.completions.create({
      // tools: LLM_TOOLS, might not be a good idea to have this available for the general chatbot
      model: model,
      messages: [
        {
          role: "system",
          content: [
            {
              type: "text",
              text: sysMsg,
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: query,
            },
          ],
        },
      ],
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
    const answer = res.choices[0].message;
    if (answer && answer.content && res.usage) {
      return {
        answer: answer.content,
        groundTruths,
        tokenUsage: { input: res.usage.prompt_tokens, output: res.usage.completion_tokens, total: res.usage.total_tokens },
      };
    }
    return { answer: "", tokenUsage: { input: 0, output: 0, total: 0 }, groundTruths };
  }

  async createGroundTruthCompletion<TApp extends ModelApplications>(
    context: Context,
    groundTruthSource: string,
    systemMsg: string,
    model: CompletionsModelHelper<TApp>
  ): Promise<string | null> {
    const {
      env: { OPENAI_API_KEY },
      config: { openAiBaseUrl },
    } = context;

    const openAi = new OpenAI({
      apiKey: OPENAI_API_KEY,
      ...(openAiBaseUrl && { baseURL: openAiBaseUrl }),
    });

    const msgs = [
      {
        role: "system",
        content: systemMsg,
      },
      {
        role: "user",
        content: groundTruthSource,
      },
    ] as OpenAI.Chat.Completions.ChatCompletionMessageParam[];

    const res = await openAi.chat.completions.create({
      messages: msgs,
      model: model,
    });

    return res.choices[0].message.content;
  }

  async findTokenLength(prompt: string, additionalContext: string[] = [], localContext: string[] = [], groundTruths: string[] = []): Promise<number> {
    // disallowedSpecial: new Set() because we pass the entire diff as the prompt we should account for all special characters
    return encode(prompt + additionalContext.join("\n") + localContext.join("\n") + groundTruths.join("\n"), { disallowedSpecial: new Set() }).length;
  }
}
