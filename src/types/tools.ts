import { Context } from "./context";
import { fetchRepoLanguageStats, fetchRepoDependencies } from "../handlers/ground-truths/chat-bot";
import { findGroundTruths } from "../handlers/ground-truths/find-ground-truths";
import { recursivelyFetchLinkedIssues } from "../helpers/issue-fetching";
import { formatChatHistory } from "../helpers/format-chat-history";

export interface Tool {
  name: string;
  description: string;
  parameters: {
    [key: string]: {
      type: string;
      description: string;
      required: boolean;
    };
  };
  execute: (context: Context, params: Record<string, unknown>) => Promise<unknown>;
}

export interface ToolCall {
  name: string;
  parameters: Record<string, unknown>;
}

export interface ToolResponse {
  result: unknown;
  error?: string;
}

export const AVAILABLE_TOOLS: Tool[] = [
  {
    name: "log",
    description: "Log information about tool execution",
    parameters: {
      message: {
        type: "string",
        description: "The message to log",
        required: true,
      },
      data: {
        type: "object",
        description: "Additional data to log",
        required: false,
      },
    },
    execute: async (context, params) => {
      context.logger.info(params.message as string, params.data as Record<string, unknown>);
      return { logged: true };
    },
  },
  {
    name: "fetch_similar_comments",
    description: "Fetch comments that are similar to the given text",
    parameters: {
      text: {
        type: "string",
        description: "The text to find similar comments for (Enter at least 2 to 3 words.)",
        required: true,
      },
      threshold: {
        type: "number",
        description: "Similarity threshold (0-1)",
        required: false,
      },
    },
    execute: async (context, params) => {
      const threshold = (params.threshold as number) || 0.9;
      return context.adapters.supabase.comment.findSimilarComments(params.text as string, 1 - threshold, "");
    },
  },
  {
    name: "fetch_similar_issues",
    description: "Fetch issues that are similar to the given text",
    parameters: {
      text: {
        type: "string",
        description: "The text to find similar issues for (Enter at least 2 to 3 words.)",
        required: true,
      },
      threshold: {
        type: "number",
        description: "Similarity threshold (0-1)",
        required: false,
      },
    },
    execute: async (context, params) => {
      const threshold = (params.threshold as number) || 0.9;
      return context.adapters.supabase.issue.findSimilarIssues(params.text as string, 1 - threshold, "");
    },
  },
  {
    name: "fetch_chat_history",
    description: "Fetch and format chat history for the current issue",
    parameters: {},
    execute: async (context) => {
      const { specAndBodies, streamlinedComments } = await recursivelyFetchLinkedIssues({
        context,
        owner: context.payload.repository.owner.login,
        repo: context.payload.repository.name,
      });
      const chatHistory = await formatChatHistory(context, streamlinedComments, specAndBodies);
      context.logger.info(chatHistory.join("\n"));
      return chatHistory;
    },
  },
  {
    name: "fetch_ground_truths",
    description: "Fetch repository context including languages and dependencies",
    parameters: {},
    execute: async (context) => {
      const languages = await fetchRepoLanguageStats(context);
      const dependencies: Record<string, string> = {};
      const devDependencies: Record<string, string> = {};

      try {
        const deps = await fetchRepoDependencies(context);
        Object.assign(dependencies, deps.dependencies);
        Object.assign(devDependencies, deps.devDependencies);
      } catch (error) {
        context.logger.error(`Unable to Fetch Dependencies: ${(error as Error).message}`);
      }

      return findGroundTruths(context, "chat-bot", {
        languages,
        dependencies,
        devDependencies,
      });
    },
  },
  {
    name: "fetch_pr_diff",
    description: "Fetch the diff for a pull request",
    parameters: {
      pr_number: {
        type: "number",
        description: "The PR number to fetch the diff for",
        required: true,
      },
    },
    execute: async (context, params) => {
      try {
        const { data: pullRequest } = await context.octokit.pulls.get({
          owner: context.payload.repository.owner.login,
          repo: context.payload.repository.name,
          pull_number: params.pr_number as number,
          mediaType: {
            format: "diff",
          },
        });
        return pullRequest;
      } catch (error) {
        context.logger.error(`Error fetching PR diff: ${(error as Error).message}`);
        return null;
      }
    },
  },
];

// Helper to find a tool by name
export function findTool(name: string): Tool | undefined {
  return AVAILABLE_TOOLS.find((tool) => tool.name === name);
}
