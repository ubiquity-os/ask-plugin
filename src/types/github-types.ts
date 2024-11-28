import { RestEndpointMethodTypes } from "@octokit/rest";
import { Context } from "./context";

export type Issue = RestEndpointMethodTypes["issues"]["get"]["response"]["data"];
export type IssueComments = RestEndpointMethodTypes["issues"]["listComments"]["response"]["data"][0];
export type ReviewComments = RestEndpointMethodTypes["pulls"]["listReviewComments"]["response"]["data"][0];
export type User = RestEndpointMethodTypes["users"]["getByUsername"]["response"]["data"];

export type Reaction = {
  id: number;
  node_id: string;
  user: Partial<User>;
  content: "+1" | "-1" | "laugh" | "confused" | "heart" | "hooray" | "rocket" | "eyes";
  created_at: string;
};

export type CommentEdit = {
  created_at: string;
  updated_at: string;
  body: string;
};

export type SimplifiedComment = {
  user: Partial<User> | null;
  body?: string | null;
  id: string;
  org: string;
  repo: string;
  issueUrl: string;
};

export type WeightedComment = SimplifiedComment & {
  weight: number;
  reactions: Reaction[];
  edits: CommentEdit[];
};

export type FetchParams = {
  context: Context;
  issueNum?: number;
  owner?: string;
  repo?: string;
};

export type LinkedIssues = {
  issueNumber: number;
  repo: string;
  owner: string;
  url: string;
  comments?: SimplifiedComment[] | null | undefined;
  body?: string | null;
  context: Context;
};

export type FetchedCodes = {
  body?: string;
  user: Partial<User> | null;
  issueUrl: string;
  id: string;
  org: string;
  repo: string;
  issueNumber: number;
};
