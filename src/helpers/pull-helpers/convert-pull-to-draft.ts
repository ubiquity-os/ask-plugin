import { customOctokit } from "@ubiquity-os/plugin-sdk/octokit";

export async function convertPullToDraft(
  shouldConvert: boolean,
  params: {
    nodeId: string;
    octokit: InstanceType<typeof customOctokit>;
  }
) {
  if (!shouldConvert) {
    return `No action taken. The pull request will remain in its current state.`;
  }
  const toDraft = `mutation {
    convertPullRequestToDraft(input: {pullRequestId: "${params.nodeId}"}) {
      pullRequest{
        id
        number
        isDraft
        title
      }
    }
  }`;

  try {
    await params.octokit.graphql(toDraft);
    return `Successfully converted pull request to draft mode.`;
  } catch (err) {
    return `Failed to convert pull request to draft mode: ${JSON.stringify(err)}`;
  }
}
