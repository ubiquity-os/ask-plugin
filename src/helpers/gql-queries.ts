import { PullRequest } from "@octokit/graphql-schema";

type ClosedByPullRequestsReferences = {
  node: Pick<PullRequest, "url" | "title" | "number" | "body"> & { owner: string; name: string };
};

export type IssuesClosedByThisPr = {
  repository: {
    pullRequest: {
      closingIssuesReferences: {
        edges: ClosedByPullRequestsReferences[];
      };
    };
  };
};

export const closedByPullRequestsReferences = /* GraphQL */ `
  query closingIssuesReferencesQuery($owner: String!, $repo: String!, $pr_number: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $pr_number) {
        closingIssuesReferences(first: 100) {
          edges {
            node {
              number
              title
              url
              body
              repository {
                name
                owner {
                  login
                }
              }
            }
          }
        }
      }
    }
  }
`;
