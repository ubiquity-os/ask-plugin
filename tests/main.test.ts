import { db } from "./__mocks__/db";
import { server } from "./__mocks__/node";
import usersGet from "./__mocks__/users-get.json";
import { expect, describe, beforeAll, beforeEach, afterAll, afterEach, it, jest } from "@jest/globals";
import { Context, SupportedEvents } from "../src/types";
import { drop } from "@mswjs/data";
import issueTemplate from "./__mocks__/issue-template";
import repoTemplate from "./__mocks__/repo-template";
import { TransformDecodeCheckError, Value } from "@sinclair/typebox/value";
import { envSchema } from "../src/types/env";
import { CompletionsType } from "../src/adapters/openai/helpers/completions";
import { logger } from "../src/helpers/errors";
import { Octokit } from "@octokit/rest";
import { createKey } from "../src/helpers/issue-fetching";

const TEST_QUESTION = "what is pi?";
const LOG_CALLER = "_Logs.<anonymous>";
const ISSUE_ID_2_CONTENT = "More context here #2";
const ISSUE_ID_3_CONTENT = "More context here #3";
const MOCK_ANSWER = "This is a mock answer for the chat";
const SPEC = "This is a demo spec for a demo task just perfect for testing.";

type Comment = {
  id: number;
  user: {
    login: string;
    type: string;
  };
  body: string;
  url: string;
  html_url: string;
  owner: string;
  repo: string;
  issue_number: number;
  issue_url?: string;
  pull_request_url?: string;
};

// extractDependencies

jest.unstable_mockModule("../src/handlers/ground-truths/chat-bot", () => {
  return {
    fetchRepoDependencies: jest.fn().mockReturnValue({
      dependencies: {},
      devDependencies: {},
    }),
    extractDependencies: jest.fn(),
    // [string, number][]
    fetchRepoLanguageStats: jest.fn().mockReturnValue([
      ["JavaScript", 100],
      ["TypeScript", 200],
    ]),
  };
});

beforeAll(() => {
  server.listen();
});
afterEach(() => {
  drop(db);
  server.resetHandlers();
});
afterAll(() => server.close());

// TESTS

describe("Ask plugin tests", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await setupTests();
  });

  it("should ask GPT a question", async () => {
    const ctx = createContext(TEST_QUESTION);
    createComments([transformCommentTemplate(1, 1, TEST_QUESTION, "ubiquity", "test-repo", true)]);
    const askQuestion = (await import("../src/handlers/ask-llm")).askQuestion;
    const res = await askQuestion(ctx, TEST_QUESTION);

    expect(res).toBeDefined();

    expect(res?.answer).toBe(MOCK_ANSWER);
  });

  it("Should throw if OPENAI_API_KEY is not defined", () => {
    const settings = {};
    expect(() => Value.Decode(envSchema, settings)).toThrow(TransformDecodeCheckError);
  });

  it("should handle PR review comment URLs correctly", () => {
    const prReviewUrl = "https://github.com/ubiquity/test-repo/pull/123/comments/456";
    const key = createKey(prReviewUrl);
    expect(key).toBe("ubiquity/test-repo/123");
  });

  it("should construct the chat history correctly", async () => {
    const ctx = createContext(TEST_QUESTION);
    const infoSpy = jest.spyOn(ctx.logger, "info");
    createComments([
      transformCommentTemplate(1, 1, ISSUE_ID_2_CONTENT, "ubiquity", "test-repo", true, "2"),
      transformCommentTemplate(2, 1, TEST_QUESTION, "ubiquity", "test-repo", true, "1"),
      transformCommentTemplate(3, 2, ISSUE_ID_3_CONTENT, "ubiquity", "test-repo", true, "3"),
      transformCommentTemplate(4, 3, "Just a comment", "ubiquity", "test-repo", true, "1"),
    ]);

    const issueCommentCreatedCallback = (await import("../src/handlers/comment-created-callback")).processCommentCallback;
    await issueCommentCreatedCallback(ctx);

    const expectedOutput = [
      "Formatted chat history Issue Tree Structure:",
      "",
      "Issue #1 (https://github.com/ubiquity/test-repo/issues/1)",
      "Body:",
      `      ${SPEC}`,
      "",
      "Comments: 2",
      `├── issuecomment-1: ubiquity: More context here #2 [#2](https://github.com/ubiquity/test-repo/issues/2)`,
      `└── issuecomment-2: ubiquity: ${TEST_QUESTION} [#1](https://github.com/ubiquity/test-repo/issues/1)`,
      "",
      "      └── Issue #2 (https://github.com/ubiquity/test-repo/issues/2)",
      "          Body:",
      `              Related to issue #3`,
      "",
      "          Comments: 1",
      `          └── issuecomment-3: ubiquity: ${ISSUE_ID_3_CONTENT} [#3](https://github.com/ubiquity/test-repo/issues/3)`,
      "",
      "              └── Issue #3 (https://github.com/ubiquity/test-repo/issues/3)",
      "                  Body:",
      `                      Just another issue`,
      "                  Comments: 1",
      `                  └── issuecomment-4: ubiquity: Just a comment [#1](https://github.com/ubiquity/test-repo/issues/1)`,
      "",
    ].join("\n");

    // Find the index of the formatted chat history log
    const chatHistoryLogIndex = infoSpy.mock.calls.findIndex((call) => (call[0] as string).startsWith("Formatted chat history"));

    const normalizedExpected = normalizeString(expectedOutput);
    const normalizedReceived = normalizeString(infoSpy.mock.calls[chatHistoryLogIndex][0] as string);
    expect(normalizedReceived).toEqual(normalizedExpected);

    // Find the index of the answer log
    const answerLogIndex = infoSpy.mock.calls.findIndex((call) => (call[0] as string).startsWith("Answer:"));

    expect(infoSpy.mock.calls[answerLogIndex]).toEqual([
      "Answer: This is a mock answer for the chat",
      {
        caller: LOG_CALLER,
        metadata: {
          tokenUsage: {
            input: 1000,
            output: 150,
            total: 1150,
          },
          groundTruths: ["This is a mock answer for the chat"],
        },
      },
    ]);
  });
});

// HELPERS

function normalizeString(str: string) {
  return str.replace(/\s+/g, " ").trim();
}

function transformCommentTemplate(commentId: number, issueNumber: number, body: string, owner: string, repo: string, isIssue = true, linkTo: string = "1") {
  const COMMENT_TEMPLATE = {
    id: 1,
    user: {
      login: "ubiquity",
      type: "User",
    },
    body: body,
    url: "https://api.github.com/repos/ubiquity/test-repo/issues/comments/1",
    html_url: "https://github.com/ubiquity/test-repo/issues/1",
    owner: "ubiquity",
    repo: "test-repo",
    issue_number: 1,
  };

  const comment: Comment = {
    id: commentId,
    user: {
      login: COMMENT_TEMPLATE.user.login,
      type: "User",
    },
    body: body + ` [#${linkTo}](${COMMENT_TEMPLATE.html_url.replace("1", linkTo.toString())})`,
    url: COMMENT_TEMPLATE.url.replace("1", issueNumber.toString()),
    html_url: COMMENT_TEMPLATE.html_url.replace("1", issueNumber.toString()),
    owner: owner,
    repo: repo,
    issue_number: issueNumber,
  };

  if (isIssue) {
    comment.issue_url = COMMENT_TEMPLATE.html_url.replace("1", issueNumber.toString());
  } else {
    comment.pull_request_url = COMMENT_TEMPLATE.html_url.replace("1", issueNumber.toString());
  }

  return comment;
}

async function setupTests() {
  for (const item of usersGet) {
    db.users.create(item);
  }

  db.repo.create({
    ...repoTemplate,
  });

  db.issue.create({
    ...issueTemplate,
  });

  db.issue.create({
    ...issueTemplate,
    id: 2,
    number: 2,
    body: "Related to issue #3",
    html_url: "https://github.com/ubiquity/test-repo/issues/2",
    url: "https://api.github.com/repos/ubiquity/test-repo/issues/2",
  });

  db.issue.create({
    ...issueTemplate,
    id: 3,
    number: 3,
    body: "Just another issue",
    html_url: "https://github.com/ubiquity/test-repo/issues/3",
    url: "https://api.github.com/repos/ubiquity/test-repo/issues/3",
  });
}

function createComments(comments: Comment[]) {
  for (const comment of comments) {
    db.comments.create({
      ...comment,
    });
  }
}

function createContext(body = TEST_QUESTION) {
  const user = db.users.findFirst({ where: { id: { equals: 1 } } });
  return {
    payload: {
      issue: db.issue.findFirst({ where: { id: { equals: 1 } } }) as unknown as Context<"issue_comment.created">["payload"]["issue"],
      sender: user,
      repository: db.repo.findFirst({ where: { id: { equals: 1 } } }) as unknown as Context["payload"]["repository"],
      comment: { body, user: user } as unknown as Context["payload"]["comment"],
      action: "created" as string,
      installation: { id: 1 } as unknown as Context["payload"]["installation"],
      organization: { login: "ubiquity" } as unknown as Context["payload"]["organization"],
    },
    command: {
      name: "ask",
      parameters: {
        question: body,
      },
    },
    owner: "ubiquity",
    repo: "test-repo",
    logger: logger,
    config: {
      maxDepth: 5,
    },
    env: {
      UBIQUITY_OS_APP_NAME: "UbiquityOS",
      OPENAI_API_KEY: "test",
      VOYAGEAI_API_KEY: "test",
      SUPABASE_URL: "test",
      SUPABASE_KEY: "test",
    },
    adapters: {
      supabase: {
        issue: {
          getIssue: async () => {
            return [
              {
                id: "1",
                markdown: SPEC,
                plaintext: SPEC,
                author_id: 1,
                created_at: new Date().toISOString(),
                modified_at: new Date().toISOString(),
                embedding: [1, 2, 3],
              },
            ];
          },
          findSimilarIssues: async () => {
            return [
              {
                issue_id: "2",
                issue_plaintext: "Related to issue #3",
                similarity: 0.5,
              },
              {
                issue_id: "3",
                issue_plaintext: "Some other issue",
                similarity: 0.3,
              },
            ];
          },
        },
        comment: {
          getComments: async () => {
            return [
              {
                id: "1",
                plaintext: TEST_QUESTION,
                markdown: TEST_QUESTION,
                author_id: 1,
                created_at: new Date().toISOString(),
                modified_at: new Date().toISOString(),
                embedding: [1, 2, 3],
              },
              {
                id: "2",
                plaintext: ISSUE_ID_2_CONTENT,
                markdown: ISSUE_ID_2_CONTENT,
                author_id: 1,
                created_at: new Date().toISOString(),
                modified_at: new Date().toISOString(),
                embedding: [1, 2, 3],
              },
              {
                id: "3",
                plaintext: ISSUE_ID_3_CONTENT,
                markdown: ISSUE_ID_3_CONTENT,
                author_id: 1,
                created_at: new Date().toISOString(),
                modified_at: new Date().toISOString(),
                embedding: [1, 2, 3],
              },
              {
                id: "4",
                plaintext: "Something new",
                markdown: "Something new",
                author_id: 1,
                created_at: new Date().toISOString(),
                modified_at: new Date().toISOString(),
                embedding: [1, 2, 3],
              },
            ];
          },
          findSimilarComments: async () => {
            return [
              {
                id: "2",
                plaintext: ISSUE_ID_2_CONTENT,
                markdown: ISSUE_ID_2_CONTENT,
                author_id: 1,
                created_at: new Date().toISOString(),
                modified_at: new Date().toISOString(),
                embedding: [1, 2, 3],
              },
              {
                id: "3",
                plaintext: ISSUE_ID_3_CONTENT,
                markdown: ISSUE_ID_3_CONTENT,
                author_id: 1,
                created_at: new Date().toISOString(),
                modified_at: new Date().toISOString(),
                embedding: [1, 2, 3],
              },
              {
                id: "4",
                plaintext: "New Comment",
                markdown: "New Comment",
                author_id: 1,
                created_at: new Date().toISOString(),
                modified_at: new Date().toISOString(),
                embedding: [1, 2, 3],
              },
            ];
          },
        },
      },
      voyage: {
        embedding: {
          createEmbedding: async () => {
            return new Array(1024).fill(0);
          },
        },
        reranker: {
          reRankResults: async (similarText: string[]) => {
            return similarText;
          },
        },
      },
      openai: {
        completions: {
          getModelMaxTokenLimit: () => {
            return 50000;
          },
          getModelMaxOutputLimit: () => {
            return 10000;
          },
          createCompletion: async (): Promise<CompletionsType> => {
            return {
              answer: MOCK_ANSWER,
              groundTruths: [MOCK_ANSWER],
              tokenUsage: {
                input: 1000,
                output: 150,
                total: 1150,
              },
            };
          },
          findTokenLength: async () => {
            return 1000;
          },
          createGroundTruthCompletion: async (): Promise<string> => {
            return `["${MOCK_ANSWER}"]`;
          },
        },
      },
    },
    octokit: new Octokit(),
    eventName: "issue_comment.created" as SupportedEvents,
  } as unknown as Context;
}
