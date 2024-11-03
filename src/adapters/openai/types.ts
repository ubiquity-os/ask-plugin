import OpenAI from "openai";

export type ChatHistory = OpenAI.Chat.Completions.ChatCompletionMessageParam[];

export type TokenUsage = {
  input: number;
  output: number;
  total: number;
  reasoning_tokens?: number;
};

export type ResponseFromLlm = {
  answer: string;
  groundTruths: string[];
  tokenUsage: TokenUsage;
};

export type CreationParams = {
  systemMessage: string;
  query: string;
  model: string;
  additionalContext: string[];
  localContext: string[];
  groundTruths: string[];
  botName: string;
  maxTokens: number;
};

export type ToolCallResponse = {
  response: OpenAI.Chat.Completions.ChatCompletionMessage;
  tool_call_response: {
    role: "tool";
    content: string;
    tool_call_id: string;
  };
};
