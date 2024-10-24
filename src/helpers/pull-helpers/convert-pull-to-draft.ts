import { Octokit } from "@octokit/rest";

export async function convertPullToDraft(
  shouldConvert: boolean,
  params: {
    owner: string;
    repo: string;
    pull_number: number;
    octokit: Octokit;
  }
) {
  if (!shouldConvert) {
    return `No action taken. The pull request will remain in its current state.`;
  }
  const { owner, repo, pull_number } = params;
  try {
    await params.octokit.pulls.update({
      owner,
      repo,
      pull_number,
      draft: true,
    });
    return `Successfully converted pull request to draft mode.`;
  } catch (err) {
    return `Failed to convert pull request to draft mode: ${JSON.stringify(err)}`;
  }
}
