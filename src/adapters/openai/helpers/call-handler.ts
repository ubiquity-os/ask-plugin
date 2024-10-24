import OpenAI from "openai";
import { LLM_FUNCTIONS, LLM_TOOLS } from "./llm-tools";
import { Context } from "../../../types";
import { getIssueNumberFromPayload } from "../../../helpers/get-issue-no-from-payload";
import { logger } from "../../../helpers/errors";
import { ChatHistory, ResponseFromLlm } from "../types";
import { getAnswerAndTokenUsage } from "./get-answer-and-token-usage";

export async function handleChat(context: Context, chatHistory: ChatHistory) {
  const response = await singleResponse(context, chatHistory);
  return await handleResponse(context, response, chatHistory);
}

async function singleResponse(context: Context, chatHistory: ChatHistory) {
  const {
    config: { model },
    env: { OPENAI_API_KEY },
  } = context;
  const openAi = new OpenAI({
    apiKey: OPENAI_API_KEY,
  });

  return await openAi.chat.completions.create({
    messages: chatHistory,
    model,
    max_tokens: 7000,
    temperature: 0,
    tools: LLM_TOOLS,
    tool_choice: "auto",
  });
}

async function handleResponse(
  context: Context,
  response: OpenAI.Chat.Completions.ChatCompletion,
  chatHistory: ChatHistory
): Promise<ResponseFromLlm & { chatHistory: ChatHistory }> {
  let chainCount = 0;
  let toolIndex = 0;
  let funcName = response.choices[0].message.tool_calls?.[0].function?.name;
  let funcParams = response.choices[0].message.tool_calls?.[0].function?.arguments;
  const toolCalls = response.choices[0].message.tool_calls?.length;

  const answerAndUsage = getAnswerAndTokenUsage(response);

  if (!toolCalls) {
    return {
      ...answerAndUsage,
      chatHistory,
    };
  }

  while (toolCalls > 0) {
    chainCount++;
    console.log(`Chain count: ${chainCount}`);
    console.log(`Response ${chainCount}: ${response.choices[0].message.content}`);
    const toolCallFn = agentCommands.find((command) => command.name === funcName);

    let argObj: Record<string, unknown>;
    if (funcParams) {
      argObj = JSON.parse(funcParams);
    } else {
      argObj = {};
    }

    try {
      if (toolCallFn && toolCallFn.func) {
        const issueNumber = getIssueNumberFromPayload(context.payload);
        const args = toolCallFn?.expectedArgs.map((arg: string) => argObj[arg]) || [];
        const result = await toolCallFn?.func(...args, {
          owner: context.payload.repository.owner.login,
          repo: context.payload.repository.name,
          octokit: context.octokit,
          pull_number: issueNumber,
        });

        chatHistory.push({
          role: "tool",
          content: result,
          tool_call_id: response.choices[0].message.tool_calls?.[toolIndex]?.id || "",
        });
      }
    } catch (err) {
      console.log("====================================");
      console.log("err:", err);
      console.log("====================================");
    }
    toolIndex++;

    if (!response.choices[0].message.tool_calls?.[toolIndex]) {
      break;
    }

    funcName = response.choices[0].message.tool_calls?.[toolIndex]?.function.name;
    funcParams = response.choices[0].message.tool_calls?.[toolIndex]?.function.arguments;
  }

  response = await singleResponse(context, chatHistory);

  const lastResponse = getAnswerAndTokenUsage(response);

  if (!lastResponse.answer) {
    throw logger.error("No response found in handleResponse", {
      response,
      chatHistory,
      chainCount,
      toolCalls,
      toolIndex,
    });
  }
  const {
    tokenUsage: { outputDetails: lastOutputDetails },
  } = lastResponse;
  const {
    tokenUsage: { outputDetails: firstOutputDetails },
  } = answerAndUsage;

  let totalReasoningTokens = 0;

  if (lastOutputDetails && lastOutputDetails.reasoning_tokens) {
    totalReasoningTokens += lastOutputDetails.reasoning_tokens;
  }

  if (firstOutputDetails && firstOutputDetails.reasoning_tokens) {
    totalReasoningTokens += firstOutputDetails.reasoning_tokens;
  }

  return {
    answer: lastResponse.answer,
    chatHistory,
    tokenUsage: {
      input: answerAndUsage.tokenUsage.input + lastResponse.tokenUsage.input,
      output: answerAndUsage.tokenUsage.output + lastResponse.tokenUsage.output,
      total: answerAndUsage.tokenUsage.total + lastResponse.tokenUsage.total,
      outputDetails: {
        reasoning_tokens: totalReasoningTokens,
      },
    },
  };
}

function isValidTool(name: string) {
  return LLM_TOOLS.some((tool) => tool.function.name === `${name}Tool`);
}

type AgentCommand = {
  name: string;
  // eslint-disable-next-line @typescript-eslint/ban-types
  func: Function;
  expectedArgs: string[];
};

/**
 * Handles function calling/response chaining for our models.
 */
const agentCommands: AgentCommand[] = LLM_TOOLS.map((tool) => {
  // tools should be named like: fnNameTool > fnName (convertPullToDraftTool > convertPullToDraft)
  // where fnNameTool is the api consumed by the LLM and fnName is the actual function
  const fnName = tool.function.name.replace("Tool", "");

  if (!isValidTool(fnName)) {
    throw new Error(`Invalid tool called: ${fnName}`);
  }

  return {
    name: tool.function.name,
    // eslint-disable-next-line @typescript-eslint/ban-types
    func: LLM_FUNCTIONS.find((fn) => fn.name === fnName) as Function,
    expectedArgs: JSON.parse(JSON.stringify(tool.function.parameters?.required)) as string[],
  };
});
