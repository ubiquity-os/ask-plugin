import OpenAI from "openai";
import { convertPullToDraft } from "../../../helpers/pull-helpers/convert-pull-to-draft";

export const convertPullToDraftTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: "function",
  function: {
    name: "convertPullToDraftTool",
    description: "Convert a pull request that does not meet the spec back to draft mode.",
    parameters: {
      type: "object",
      properties: {
        should_convert: {
          type: "boolean",
          description: "Whether to convert the pull request to draft mode.",
        },
      },
      required: ["should_convert"],
      additionalProperties: false,
    },
  },
};

export const LLM_TOOLS = [convertPullToDraftTool];
export const LLM_FUNCTIONS = [convertPullToDraft];
export type ToolFunctions = typeof LLM_FUNCTIONS;
