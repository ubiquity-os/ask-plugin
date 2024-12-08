import { closedByPullRequestsReferences, IssuesClosedByThisPr } from "./gql-queries";
import { customOctokit } from "@ubiquity-os/plugin-sdk/octokit";

export async function checkIfPrClosesIssues(
  octokit: InstanceType<typeof customOctokit>,
  pr: {
    owner: string;
    repo: string;
    pr_number: number;
  }
) {
  const { owner, repo, pr_number } = pr;

  if (!pr_number) {
    throw new Error("[checkIfPrClosesIssues]: pr_number is required");
  }
  try {
    const result = await octokit.graphql<IssuesClosedByThisPr>(closedByPullRequestsReferences, {
      owner,
      repo,
      pr_number,
    });

    const closingIssues = result.repository.pullRequest.closingIssuesReferences.edges.map((edge) => ({
      number: edge.node.number,
      title: edge.node.title,
      url: edge.node.url,
      body: edge.node.body,
      repository: {
        name: edge.node.name,
        owner: edge.node.owner,
      },
    }));

    if (closingIssues.length > 0) {
      return {
        closesIssues: true,
        issues: closingIssues,
      };
    } else {
      return {
        closesIssues: false,
        issues: [],
      };
    }
  } catch (error) {
    console.error("Error fetching closing issues:", error);
    return {
      closesIssues: false,
      issues: [],
    };
  }
}
