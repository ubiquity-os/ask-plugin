import OpenAI from "openai";
import { Context } from "../../../types";
import { SuperOpenAi } from "./openai";
import { CompletionsModelHelper, ModelApplications } from "../../../types/llm";
import { encode } from "gpt-tokenizer";
import { AVAILABLE_TOOLS, Tool, ToolCall, ToolResponse, findTool } from "../../../types/tools";
import { OutputFormatter } from "./format-output";

export interface Citation {
  reference: string;
  description: string;
  url?: string;
}

interface ToolCallParams {
  [key: string]: string | number | boolean | null;
}

interface ToolCallResult {
  [key: string]: string | number | boolean | null | Array<unknown>;
}

type ToolCallType = {
  tool: string;
  params: ToolCallParams;
  result: ToolCallResult;
  status: "success" | "empty" | "error";
  message?: string;
};

export interface CompletionsType {
  answer: string;
  citations: Citation[];
  tokenUsage: {
    input: number;
    output: number;
    total: number;
  };
}

export class Completions extends SuperOpenAi {
  protected context: Context;
  public lastTokenUsage: CompletionsType["tokenUsage"];
  public lastToolCalls: ToolCallType[];

  constructor(client: OpenAI, context: Context) {
    super(client, context);
    this.context = context;
    this.lastTokenUsage = {
      input: 0,
      output: 0,
      total: 0,
    };
    this.lastToolCalls = [];
  }

  private async _executeTool(toolCall: ToolCall): Promise<{
    response: ToolResponse;
    status: "success" | "empty" | "error";
    message?: string;
  }> {
    const tool = findTool(toolCall.name);
    if (!tool) {
      return {
        response: { result: null },
        status: "error",
        message: `Tool ${toolCall.name} not found`,
      };
    }

    try {
      const result = await tool.execute(this.context, toolCall.parameters);
      console.log("Tool result", result);
      // Handle empty results
      if (result === null || result === undefined) {
        return {
          response: { result: null },
          status: "empty",
          message: "No results found",
        };
      }

      // Handle array results
      if (Array.isArray(result) && result.length === 0) {
        return {
          response: { result: [] },
          status: "empty",
          message: "No matching results found",
        };
      }

      return {
        response: { result },
        status: "success",
      };
    } catch (error) {
      return {
        response: { result: null },
        status: "error",
        message: (error as Error).message,
      };
    }
  }

  private _sanitizeContent(content: string): string {
    // Remove user mentions (e.g., @username)
    content = content.replace(/@[\w-]+/g, "");
    // Clean up any double spaces created by removals
    content = content.replace(/\s+/g, " ").trim();
    return content;
  }

  private _sanitizeUrl(url: string | undefined): string | undefined {
    if (!url) return url;
    // Add www. after http:// or https:// if not already present
    return url.replace(/(https?:\/\/)(?!www\.)/, "$1www.");
  }

  private _parseResponse(content: string): {
    finalAnswer: string;
    citations?: Citation[];
  } {
    try {
      const response = JSON.parse(content);
      return {
        finalAnswer: response.answer,
        citations: response.citations,
      };
    } catch (error) {
      // If JSON parsing fails, try to extract citations from plain text
      const citationRegex = /\[(\^[0-9]+\^)\]:\s*(.*?)(?=\n\[|$)/g;
      const matches = content.matchAll(citationRegex);
      const citations: Citation[] = [];
      let finalAnswer = content;

      for (const match of matches) {
        const [fullMatch, reference, description] = match;
        citations.push({
          reference,
          description: description.trim(),
          url: undefined,
        });
        finalAnswer = finalAnswer.replace(fullMatch, "");
      }

      return {
        finalAnswer: finalAnswer.trim(),
        citations,
      };
    }
  }

  private _formatFootnoteNumber(num: number): string {
    const index = num + 1;
    return index < 10 ? `0${index}` : `${index}`;
  }

  public async findTokenLength(prompt: string, groundTruths: string[] = []): Promise<number> {
    return encode(prompt + groundTruths.join("\n")).length;
  }

  public async createGroundTruthCompletion<TApp extends ModelApplications>(
    context: Context,
    groundTruthSource: string,
    systemMsg: string,
    model: CompletionsModelHelper<TApp>
  ): Promise<string> {
    try {
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
        temperature: 0.1,
        max_tokens: 500,
      });

      if (!res?.choices?.[0]?.message?.content) {
        context.logger.info("No ground truths generated, using empty string");
        return "";
      }

      return res.choices[0].message.content;
    } catch (error) {
      context.logger.info(`Ground truth completion error: ${(error as Error).message}, using empty string`);
      return "";
    }
  }

  private _getCitationDescription(result: ToolCallResult): string {
    if (!result) return "Unknown reference";

    if ("issue_number" in result) {
      // Get first line of issue body or comment
      const text = (result.comment_plaintext as string) || (result.issue_plaintext as string) || "";
      const firstLine = text.split("\n")[0].trim();
      return firstLine.length > 50 ? firstLine.substring(0, 47) + "..." : firstLine;
    }

    return (result.title as string) || "Reference";
  }

  async createCompletion(prompt: string, model: string = "o1-mini", groundTruths: string[], botName: string, maxTokens: number): Promise<CompletionsType> {
    try {
      const { chainOfThought } = this.context.config;
      const systemMessage = this._buildSystemMessage(groundTruths, botName, chainOfThought, prompt);

      const messages: Array<OpenAI.Chat.Completions.ChatCompletionMessageParam> = [
        {
          role: "system",
          content: systemMessage,
        },
        {
          role: "user",
          content: prompt,
        },
      ];

      const toolCalls: ToolCallType[] = [];
      let finalAnswer = "";
      let citations: Citation[] = [];

      // Start conversation loop to handle tool calls
      while (true) {
        let response;
        try {
          response = await this.client.chat.completions.create({
            model,
            messages,
            temperature: chainOfThought?.temperature ?? 0.2,
            max_tokens: maxTokens,
            tool_choice: "auto",
            tools: AVAILABLE_TOOLS.map((tool: Tool) => ({
              type: "function",
              function: {
                name: tool.name,
                description: tool.description,
                parameters: {
                  type: "object",
                  properties: Object.entries(tool.parameters).reduce(
                    (acc, [key, value]) => ({
                      ...acc,
                      [key]: {
                        type: value.type,
                        description: value.description,
                      },
                    }),
                    {}
                  ),
                  required: Object.entries(tool.parameters)
                    .filter(([, value]) => value.required)
                    .map(([key]) => key),
                },
              },
            })),
          });
        } catch (error) {
          this.context.logger.error(`OpenAI API error: ${(error as Error).message}`);
          throw new Error(`OpenAI API error: ${(error as Error).message}`);
        }

        // Validate OpenAI response
        if (!response) {
          this.context.logger.error("No response received from OpenAI");
          throw new Error("No response received from OpenAI");
        }

        if (!response.choices) {
          console.log(response);
          this.context.logger.error("OpenAI response missing choices array");
          throw new Error("OpenAI response missing choices array");
        }

        if (response.choices.length === 0) {
          this.context.logger.error("OpenAI response contains empty choices array");
          throw new Error("OpenAI response contains empty choices array");
        }

        const choice = response.choices[0];
        if (!choice) {
          this.context.logger.error("First choice is undefined in OpenAI response");
          throw new Error("First choice is undefined in OpenAI response");
        }

        if (!choice.message) {
          this.context.logger.error("OpenAI response choice contains no message");
          throw new Error("OpenAI response choice contains no message");
        }

        const responseMessage = choice.message;

        // Handle tool calls
        if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
          const toolResponses: Array<{
            id: string;
            response: ToolResponse;
            status: "success" | "empty" | "error";
            message?: string;
          }> = [];

          for (const toolCall of responseMessage.tool_calls) {
            try {
              const parameters = JSON.parse(toolCall.function.arguments);
              const { response, status, message } = await this._executeTool({
                name: toolCall.function.name,
                parameters,
              });

              toolResponses.push({
                id: toolCall.id,
                response,
                status,
                message,
              });

              toolCalls.push({
                tool: toolCall.function.name,
                params: parameters,
                result: response.result as ToolCallResult,
                status,
                message,
              });

              // Add citations from successful tool calls
              if (status === "success" && (toolCall.function.name === "fetch_similar_comments" || toolCall.function.name === "fetch_similar_issues")) {
                const results = Array.isArray(response.result) ? response.result : [];
                for (let index = 0; index < results.length; index++) {
                  const result = results[index] as ToolCallResult;
                  if ("comment_plaintext" in result || "issue_plaintext" in result) {
                    const url = this._sanitizeUrl(result.html_url as string);
                    citations.push({
                      reference: `[^${this._formatFootnoteNumber(index)}^]`,
                      description: this._getCitationDescription(result),
                      url,
                    });
                  }
                }
              }
            } catch (error) {
              this.context.logger.error(`Tool execution error: ${(error as Error).message}`);
              toolResponses.push({
                id: toolCall.id,
                response: { result: null },
                status: "error",
                message: `Tool execution failed: ${(error as Error).message}`,
              });
            }
          }

          // Add assistant message with tool calls
          messages.push(responseMessage);

          // Add individual tool response messages for each tool call
          for (const toolResponse of toolResponses) {
            messages.push({
              role: "tool",
              tool_call_id: toolResponse.id,
              content: JSON.stringify({
                result: toolResponse.response.result,
                status: toolResponse.status,
                message: toolResponse.message,
              }),
            });
          }

          continue;
        }

        // Parse final response
        if (!responseMessage.content) {
          throw new Error("OpenAI response message contains no content");
        }

        const parsed = this._parseResponse(responseMessage.content);
        if (!parsed.finalAnswer) {
          throw new Error("Failed to parse response: no answer found");
        }

        finalAnswer = this._sanitizeContent(parsed.finalAnswer);
        if (parsed.citations) {
          citations = parsed.citations.map((citation: Citation, index: number) => ({
            reference: `[^${this._formatFootnoteNumber(index)}^]`,
            description: citation.description,
            url: this._sanitizeUrl(citation.url),
          }));
        }

        break;
      }

      // Update last token usage and tool calls
      this.lastTokenUsage = {
        input: 0,
        output: 0,
        total: 0,
      };
      this.lastToolCalls = toolCalls;

      // Create completion result
      const completionResult: CompletionsType = {
        answer: finalAnswer,
        citations: citations.filter((citation, index, self) => index === self.findIndex((c) => c.description === citation.description)),
        tokenUsage: this.lastTokenUsage,
      };

      try {
        // Format the output using the new OutputFormatter with o1-mini
        const formattedOutput = await OutputFormatter.format(completionResult, this.client);
        const finalFormattedOutput = OutputFormatter.buildFinalOutput(formattedOutput);

        // Return the formatted result
        return {
          ...completionResult,
          answer: finalFormattedOutput,
        };
      } catch (formattingError) {
        this.context.logger.error(`Formatting error: ${(formattingError as Error).message}`);
        // If formatting fails, return the original unformatted result
        return completionResult;
      }
    } catch (error) {
      const errorMessage = (error as Error).message;
      this.context.logger.error(`Completion error: ${errorMessage}`);

      // Update last token usage and tool calls for error case
      this.lastTokenUsage = {
        input: 0,
        output: 0,
        total: 0,
      };
      this.lastToolCalls = [];

      // Return error response as CompletionsType
      return {
        answer: `I apologize, but I encountered an error: ${errorMessage}. Please try again or rephrase your question.`,
        citations: [],
        tokenUsage: this.lastTokenUsage,
      };
    }
  }

  private _buildSystemMessage(
    groundTruths: string[],
    botName: string,
    chainOfThought?: { enabled: boolean; steps: string[]; requireExplanation: boolean },
    userQuestion?: string
  ): string {
    const availableTools = AVAILABLE_TOOLS.map((tool) => `- ${tool.name}: ${tool.description}`).join("\n");
    const groundTruthsText = groundTruths.length > 0 ? `\nRepository Ground Truths:\n${groundTruths.join("\n")}\n` : "";
    const baseMessage = `You are an authoritative writer, You are tasked with assisting as a GitHub bot. You must NEVER make assumptions about the context of an issue or discussion. Instead, you must ALWAYS gather comprehensive context using the available tools in this specific order:

  1. fetch_similar_comments - Find relevant discussions to understand the context. When using this tool, ALWAYS pass the entire user question: ${userQuestion || ""} as the search query.
  2. fetch_similar_issues - Find related issues for broader context. When using this tool, ALWAYS pass the entire user question: ${userQuestion || ""} as the search query.
  3. fetch_chat_history - Get the conversation history to understand the current discussion
  4. fetch_ground_truths - Get repository context (ONLY after gathering discussion context)
  5. fetch_pr_diff - Get PR changes (ONLY when explicitly discussing PRs and after gathering context)

  IMPORTANT:
  - ALWAYS produce CLEAN and FORMATTED responses.
  - You must ALWAYS use the first three tools (fetch_similar_comments, fetch_similar_issues, fetch_chat_history) to gather context before proceeding
  - When using fetch_similar_comments and fetch_similar_issues, ALWAYS use the complete user question as the search query
  - Do not make ANY assumptions about the context of discussions or issues
  - Analyze ALL gathered context before forming responses
  - Use fetch_ground_truths ONLY after you have comprehensive discussion context
  - Use fetch_pr_diff ONLY when explicitly discussing PRs and after gathering all other context
  - NEVER mention users by their usernames in your responses
  - For each piece of information from external sources, add a reference [^01^] in your answer
  - All URLs should include www after http:// or https:// if not already present
  - For citations, include the exact text you are referencing from the source
  - Do not duplicate citations or references

  Available Tools:
  ${availableTools}

  Tool Response Status:
  - success: Tool executed successfully with results
  - empty: No matching data found
  - error: Tool execution failed

  ${groundTruthsText}`;

    const responseFormat = `Your response must follow this structured format:
Example:
{
  "answer": "The feature was implemented with XP rewards based on total rewards earned [^01^].",
  "citations": [
    {
      "reference": "[^01^]",
      "description": "XP rewards as a form of payout but I think maybe not a priority",
      "url": "https://www.github.com/..."
    }
  ]
}
  
For Code citations:
IMPORTANT
- DO NOT ADD CITATIONS FOR THE CODE
- ALWAYS add Formatted code blocks using triple backticks (\\\`\\\`\\\`);

Example:
The following code snippet adds two numbers:
\`\`\`python
def add(a, b):
  return a + b
\`\`\``;

    return `${baseMessage}\n\n${responseFormat}\n\nYour name is: ${botName}`;
  }
}
