import { createSystemMessage } from "./create-system-msg";
import { ChatHistory, CreationParams, ToolCallResponse } from "../types";

export function appendToConversation(params: CreationParams, toolCallsToAppend: ToolCallResponse[] = []): ChatHistory {
  const { systemMessage, query, additionalContext, localContext, groundTruths, botName } = params;
  const baseChat: ChatHistory = [
    {
      role: "system",
      content: [
        {
          type: "text",
          text: createSystemMessage(systemMessage, additionalContext, localContext, groundTruths, botName),
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
  ];

  if (toolCallsToAppend.length > 0) {
    toolCallsToAppend.forEach((toolCallResponse) => {
      baseChat.push(toolCallResponse.response);
      baseChat.push(toolCallResponse.tool_call_response);
    });
  }

  return baseChat;
}
