import { logger } from "../../helpers/errors";

const DEFAULT_GROUND_TRUTHS = ["Be helpful and informative", "Provide accurate information", "Cite sources when available", "Stay focused on the question"];

export function validateGroundTruths(truthsString: string | null): string[] {
  if (!truthsString) {
    logger.info("No ground truths provided, using defaults");
    return DEFAULT_GROUND_TRUTHS;
  }

  try {
    const truths = JSON.parse(truthsString);

    if (!Array.isArray(truths)) {
      logger.info("Ground truths must be an array, using defaults");
      return DEFAULT_GROUND_TRUTHS;
    }

    if (truths.length === 0) {
      logger.info("Empty ground truths array, using defaults");
      return DEFAULT_GROUND_TRUTHS;
    }

    if (truths.length > 10) {
      logger.info("Ground truths exceed limit of 10, truncating");
      return truths.slice(0, 10);
    }

    const validTruths = truths.filter((truth: unknown) => typeof truth === "string");
    if (validTruths.length === 0) {
      logger.info("No valid string truths found, using defaults");
      return DEFAULT_GROUND_TRUTHS;
    }

    if (validTruths.length !== truths.length) {
      logger.info("Some ground truths were invalid and filtered out");
    }

    return validTruths;
  } catch (err) {
    logger.info("Failed to parse ground truths, using defaults");
    return DEFAULT_GROUND_TRUTHS;
  }
}
