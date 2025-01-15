import { Context } from "../types/context";
import { Reaction, CommentEdit, WeightedComment, SimplifiedComment } from "../types/github-types";

// Reaction weights configuration
const REACTION_WEIGHTS = {
  "+1": 1,
  heart: 1,
  hooray: 1,
  rocket: 1,
  "-1": -1,
  confused: -0.5,
  eyes: 0.5,
  laugh: 0.25,
};

// Calculate weight based on reactions
function calculateReactionWeight(reactions: Reaction[]): number {
  return reactions.reduce((total, reaction) => {
    return total + (REACTION_WEIGHTS[reaction.content] || 0);
  }, 0);
}

// Calculate weight based on edit history
function calculateEditWeight(edits: CommentEdit[]): number {
  // More edits could indicate refinement and improvement
  // We use a logarithmic scale to prevent excessive weight from many edits
  return edits.length > 0 ? Math.log2(edits.length + 1) : 0;
}

// Fetch reactions for a comment
async function fetchReactions(context: Context, owner: string, repo: string, commentId: string): Promise<Reaction[]> {
  try {
    const { data } = await context.octokit.reactions.listForIssueComment({
      owner,
      repo,
      comment_id: parseInt(commentId),
    });
    return data as Reaction[];
  } catch (error) {
    context.logger.error("Error fetching reactions", {
      error: error instanceof Error ? error : new Error("Unknown error occurred"),
      owner,
      repo,
      commentId,
    });
    return [];
  }
}

interface StrictGraphQlCommentEdit {
  createdAt: string;
  updatedAt: string;
  editedBody: string;
}

interface StrictGraphQlResponse {
  node?: {
    userContentEdits?: {
      nodes?: StrictGraphQlCommentEdit[];
    };
  };
}

// Fetch edit history for a comment using GraphQL
async function fetchCommentEdits(context: Context, commentId: string): Promise<CommentEdit[]> {
  try {
    const query = `
      query($nodeId: ID!) {
        node(id: $nodeId) {
          ... on IssueComment {
            userContentEdits(first: 100) {
              nodes {
                createdAt
                updatedAt
                editedBody
              }
            }
          }
        }
      }
    `;

    const result = await context.octokit.graphql<StrictGraphQlResponse>(query, {
      nodeId: commentId,
    });

    const edits = result.node?.userContentEdits?.nodes || [];
    return edits.map((edit) => ({
      created_at: edit.createdAt,
      updated_at: edit.updatedAt,
      body: edit.editedBody,
    }));
  } catch (error) {
    context.logger.error("Error fetching comment edits", {
      error: error instanceof Error ? error : new Error("Unknown error occurred"),
      commentId,
    });
    return [];
  }
}

// Calculate final weight for a comment based on reactions and edits
function calculateCommentWeight(reactions: Reaction[], edits: CommentEdit[]): number {
  const reactionWeight = calculateReactionWeight(reactions);
  const editWeight = calculateEditWeight(edits);

  // Combine weights - reactions have more impact than edits
  return reactionWeight + editWeight * 0.5;
}

// Main function to process comments and calculate weights
export async function processCommentsWithWeights(context: Context, comments: SimplifiedComment[]): Promise<WeightedComment[]> {
  const weightedComments: WeightedComment[] = [];

  for (const comment of comments) {
    const reactions = await fetchReactions(context, comment.org, comment.repo, comment.id);
    const edits = await fetchCommentEdits(context, comment.id);
    const weight = calculateCommentWeight(reactions, edits);

    weightedComments.push({
      ...comment,
      weight,
      reactions,
      edits,
    });
  }

  // Sort by weight in descending order
  return weightedComments.sort((a, b) => b.weight - a.weight);
}
