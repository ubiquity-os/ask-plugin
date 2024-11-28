import OpenAI from "openai";
import { Context } from "../../../types";
import { SuperOpenAi } from "./openai";
import { CompletionsModelHelper, ModelApplications, StreamlinedComment } from "../../../types/llm";
import { encode } from "gpt-tokenizer";
import { logger } from "../../../helpers/errors";
import { createWeightTable } from "../../../handlers/rlhf/completions-scorer";

export interface CompletionsType {
  answer: string;
  groundTruths: string[];
  tokenUsage: {
    input: number;
    output: number;
    total: number;
  };
}

export const defaultCompletionsType: CompletionsType = {
  answer: "",
  groundTruths: [],
  tokenUsage: {
    input: 0,
    output: 0,
    total: 0,
  },
};

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
    query: string,
    model: string = "o1-mini",
    additionalContext: string[],
    localContext: string[],
    groundTruths: string[],
    botName: string,
    maxTokens: number,
    weightPrompt: string = ""
  ): Promise<CompletionsType> {
    const numTokens = await this.findTokenLength(query, additionalContext, localContext, groundTruths);
    logger.info(`Number of tokens: ${numTokens}`);

    const sysMsg = [
      "You Must obey the following ground truths: ",
      JSON.stringify(groundTruths) + "\n",
      "You are tasked with assisting as a GitHub bot by generating responses based on provided chat history and weighted context. The context is weighted based on:",
      "1. User Reactions: Positive reactions (👍, ❤️, 🎉, 🚀) increase weight, negative reactions (👎, 😕) decrease weight",
      "2. Edit History: Comments that have been refined through edits have higher weight",
      "3. Similarity to Current Query: Content more similar to the current question has higher weight",
      "\nWeighted Context Table:",
      weightPrompt + "\n",
      "Your role is to interpret this weighted knowledge effectively to answer user questions, giving more consideration to higher-weighted content.\n\n# Steps\n\n1. **Understand Context**: Review the chat history and weighted responses, prioritizing higher-weighted content.\n2. **Extract Relevant Information**: Focus on information from highly-weighted sources, which represent community-validated content.\n3. **Apply Knowledge**: Use the extracted information, considering both content relevance and community feedback.\n4. **Draft Response**: Compile insights into a coherent response, emphasizing information from highly-weighted sources.\n5. **Review and Refine**: Ensure accuracy and alignment with the weighted context.\n\n# Output Format\n\n- Concise and coherent responses that directly address the user's question.\n- Prioritize information from highly-weighted sources.\n- Include code snippets or references when relevant.\n\n# Notes\n\n- Higher weights indicate stronger community validation through reactions and refinements.\n- Consider both the content and its weight when forming responses.\n- Balance between different sources based on their weights.",
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
      max_tokens: maxTokens,
      top_p: 0.5,
      frequency_penalty: 0,
      presence_penalty: 0,
      response_format: {
        type: "text",
      },
    });

    const answer = res.choices[0].message;
    if (answer && answer.content && res.usage) {
      return {
        answer: answer.content,
        groundTruths,
        tokenUsage: { input: res.usage.prompt_tokens, output: res.usage.completion_tokens, total: res.usage.total_tokens },
      };
    }
    return defaultCompletionsType;
  }

  async createCompletionWithHF(
    minResultWeight: number,
    query: string,
    model: string = "o1-mini",
    additionalContext: string[],
    localContext: string[],
    groundTruths: string[],
    botName: string,
    maxTokens: number,
    weightedComments: StreamlinedComment[] = []
  ): Promise<CompletionsType> {
    const weightPrompt = await createWeightTable(weightedComments);
    return await this.createCompletion(query, model, additionalContext, localContext, groundTruths, botName, maxTokens, weightPrompt);
  }

  async createGroundTruthCompletion<TApp extends ModelApplications>(
    groundTruthSource: string,
    systemMsg: string,
    model: CompletionsModelHelper<TApp>
  ): Promise<string | null> {
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

    const res = await this.client.chat.completions.create({
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
