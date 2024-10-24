import { Context } from "../../types";

export async function convertPullToDraft(context: Context<"pull_request.opened" | "pull_request.ready_for_review">) {
    const { logger, payload } = context;
    const { number, organization, repository, action } = payload;
    const { owner, name } = repository;

    logger.info(`${organization}/${repository}#${number} - ${action}`);

    try {
        await context.octokit.pulls.update({
            owner: owner.login,
            repo: name,
            pull_number: number,
            draft: true,
        });

        logger.info("Pull request converted to draft");
    } catch (er) {
        throw logger.error("Failed to convert pull request to draft", { err: er });
    }
}

