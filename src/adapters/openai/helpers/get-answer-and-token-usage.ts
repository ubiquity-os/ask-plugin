import OpenAI from "openai";
import { ResponseFromLlm } from "../types";

export function getAnswerAndTokenUsage(apiResponse: OpenAI.Chat.Completions.ChatCompletion): ResponseFromLlm {
  const answer = apiResponse.choices[0].message;
  if (answer && answer.content && apiResponse.usage) {
    return {
      answer: answer.content,
      tokenUsage: {
        input: apiResponse.usage.prompt_tokens,
        output: apiResponse.usage.completion_tokens,
        total: apiResponse.usage.total_tokens,
        outputDetails: apiResponse.usage.completion_tokens_details,
      },
    };
  }
  return { answer: "", tokenUsage: { input: 0, output: 0, total: 0, outputDetails: { reasoning_tokens: 0 } } };
}
