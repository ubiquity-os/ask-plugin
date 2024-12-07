/* eslint-disable sonarjs/no-duplicate-string */

import Anthropic from "@anthropic-ai/sdk";
import { Context } from "../../../types";
import { CompletionsModelHelper, ModelApplications } from "../../../types/llm";
import { encode } from "gpt-tokenizer";
import { ContentBlock } from "@anthropic-ai/sdk/resources";
import { SuperAnthropic } from "./claude";

export interface CompletionsType {
  answer: string;
  groundTruths: string[];
  tokenUsage: {
    input: number;
    output: number;
    total: number;
  };
}

// Type guard for content block
interface TextBlock {
  type: "text";
  text: string;
}

function isTextBlock(content: ContentBlock): content is TextBlock {
  return content?.type === "text" && typeof content?.text === "string";
}

export class AnthropicCompletion extends SuperAnthropic {
  protected context: Context;

  constructor(client: Anthropic, context: Context) {
    super(client, context);
    this.context = context;
  }

  getModelMaxTokenLimit(model: string): number {
    const tokenLimits = new Map<string, number>([["claude-3.5-sonnet", 200000]]);

    return tokenLimits.get(model) || 200000;
  }

  getModelMaxOutputLimit(model: string): number {
    const tokenLimits = new Map<string, number>([["claude-3.5-sonnet", 4096]]);

    return tokenLimits.get(model) || 4096;
  }

  async createCompletion(
    model: string = "claude-3.5-sonnet",
    additionalContext: string[],
    localContext: string[],
    groundTruths: string[],
    botName: string,
    maxTokens: number
  ): Promise<CompletionsType> {
    const numTokens = await this.findTokenLength("", additionalContext, localContext, groundTruths);
    this.context.logger.info(`Number of tokens: ${numTokens}`);

    const sysMsg = [
      "You Must obey the following ground truths: ",
      JSON.stringify(groundTruths) + "\n",
      "You are tasked with assisting as a GitHub bot by generating a confidence threshold from 0-1 on whether you think the pull difference completes the issue specification/body based on provided chat history and similar responses, focusing on using available knowledge within the provided corpus, which may contain code, documentation, or incomplete information. Your role is to interpret and use this knowledge effectively to answer user questions.\n\n# Steps\n\n1. **Understand Context**: Analyze the chat history and any similar responses to grasp the issue requirements and pull request intent.\n2. **Extract Key Information**: Identify crucial details from the corpus, even if incomplete, focusing on specifications and their alignment with the pull diff.\n3. **Evaluate Completeness**: Assess how well the pull diff fulfills the issue specifications, using logical assumptions if needed to fill gaps.\n4. **Generate Confidence**: Provide a confidence score (0-1) indicating how likely the pull diff satisfies the issue specification.\n5. **Output Response**: Return only a JSON object in this format: `{confidenceThreshold: <value>}`. For example, if the pull diff adds `x.py` to fulfill a request to add `x.py`, output `{confidenceThreshold: 1}`. Include no explanation or additional text.",
      `Your name is: ${botName}`,
      "\n",
      "Main Context (Provide additional precedence in terms of information): ",
      localContext.join("\n"),
      "Secondary Context: ",
      additionalContext.join("\n"),
    ].join("\n");

    this.context.logger.info(`System message: ${sysMsg}`);

    const res = await this.client.messages.create({
      model: model,
      system: sysMsg,
      messages: [
        {
          role: "user",
          content:
            "Perform code review using the diff and spec and output a JSON format with key: 'confidenceThreshold' (0-1). A 0 indicates that the code review failed and 1 mean its passed",
        },
      ],
      max_tokens: maxTokens,
      temperature: 0.2,
      top_p: 0.5,
    });

    // Use type guard to safely handle the response
    const content = res.content[0];
    if (!isTextBlock(content)) {
      throw this.context.logger.error("Unexpected response format: Expected text block");
    }

    const answer = content.text;
    const inputTokens = await this.findTokenLength(sysMsg);
    const outputTokens = await this.findTokenLength(answer);

    return {
      answer,
      groundTruths,
      tokenUsage: {
        input: inputTokens,
        output: outputTokens,
        total: inputTokens + outputTokens,
      },
    };
  }

  async createGroundTruthCompletion<TApp extends ModelApplications>(
    context: Context,
    groundTruthSource: string,
    systemMsg: string,
    model: CompletionsModelHelper<TApp>
  ): Promise<string | null> {
    const {
      env: { ANTHROPIC_API_KEY },
      config: { anthropicAiBaseUrl },
    } = context;

    const client = new Anthropic({
      apiKey: ANTHROPIC_API_KEY,
      baseURL: anthropicAiBaseUrl,
    });

    const res = await client.messages.create({
      model: model,
      system: systemMsg,
      max_tokens: this.getModelMaxTokenLimit(model),
      messages: [
        {
          role: "user",
          content: groundTruthSource,
        },
      ],
    });

    const content = res.content[0];
    if (!isTextBlock(content)) {
      throw this.context.logger.error("Unexpected response format: Expected text block");
    }

    return content.text;
  }

  async findTokenLength(text: string = "", additionalContext: string[] = [], localContext: string[] = [], groundTruths: string[] = []): Promise<number> {
    // Note: You might want to replace gpt-tokenizer with claude-specific tokenizer if available
    return encode(text + additionalContext.join("\n") + localContext.join("\n") + groundTruths.join("\n"), { disallowedSpecial: new Set() }).length;
  }
}
