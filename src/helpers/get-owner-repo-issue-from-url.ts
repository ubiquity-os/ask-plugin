export function getOwnerRepoIssueNumberFromUrl(body: string | undefined | null): { owner: string; repo: string; issueNumber: string } | null {
  if (!body) return null;

  const regex = /https:\/\/(www\.)?github.com\/(?<owner>[\w-]+)\/(?<repo>[\w-]+)\/issues\/(?<issueNumber>\d+)/i;
  const match = body.match(regex);

  if (match && match.groups) {
    const { owner, repo, issueNumber } = match.groups;
    return { owner, repo, issueNumber };
  }

  return null;
}
