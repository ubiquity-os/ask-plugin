import OpenAI from "openai";
import { Context } from "../../../types";
import { SuperOpenAi } from "./openai";
const MAX_TOKENS = 7000;

export interface ResponseFromLlm {
  answer: string;
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

  private _createSystemMessage(systemMessage: string, additionalContext: string[], localContext: string[], groundTruths: string[], botName: string) {
    // safer to use array join than string concatenation
    const parts = [
      "You Must obey the following ground truths: [",
      groundTruths.join(":"),
      "]\n",
      systemMessage,
      "Your name is : ",
      botName,
      "\n",
      "Primary Context: ",
      additionalContext.join("\n"),
      "\nLocal Context: ",
      localContext.join("\n"),
    ];

    return parts.join("\n");
  }

  async createCompletion({
    systemMessage,
    prompt,
    model = "o1-mini",
    additionalContext,
    localContext,
    groundTruths,
    botName,
  }: {
    systemMessage: string;
    prompt: string;
    model: string;
    additionalContext: string[];
    localContext: string[];
    groundTruths: string[];
    botName: string;
  }): Promise<ResponseFromLlm> {
    const res: OpenAI.Chat.Completions.ChatCompletion = await this.client.chat.completions.create({
      model: model,
      messages: [
        {
          role: "system",
          content: [
            {
              type: "text",
              text: this._createSystemMessage(systemMessage, additionalContext, localContext, groundTruths, botName),
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: prompt,
            },
          ],
        },
      ],
      temperature: 0.2,
      max_tokens: MAX_TOKENS,
      top_p: 0.5,
      frequency_penalty: 0,
      presence_penalty: 0,
      response_format: {
        type: "text",
      },
    });
    const answer = res.choices[0].message;
    if (answer && answer.content && res.usage) {
      return { answer: answer.content, tokenUsage: { input: res.usage.prompt_tokens, output: res.usage.completion_tokens, total: res.usage.total_tokens } };
    }
    return { answer: "", tokenUsage: { input: 0, output: 0, total: 0 } };
  }
}
