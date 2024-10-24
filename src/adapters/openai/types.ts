import OpenAI from "openai";

export type ChatHistory = OpenAI.Chat.Completions.ChatCompletionMessageParam[];

export type TokenUsage = {
  input: number;
  output: number;
  total: number;
  outputDetails?: OpenAI.Completions.CompletionUsage.CompletionTokensDetails;
};

export type ResponseFromLlm = {
  answer: string;
  tokenUsage: TokenUsage;
};

export type CreationParams = {
  systemMessage: string;
  prompt: string;
  model: string;
  additionalContext: string[];
  localContext: string[];
  groundTruths: string[];
  botName: string;
};

export type ToolCallResponse = {
  response: OpenAI.Chat.Completions.ChatCompletionMessage;
  tool_call_response: {
    role: "tool";
    content: string;
    tool_call_id: string;
  };
};
