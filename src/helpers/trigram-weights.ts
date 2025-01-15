import { StreamlinedComment } from "../types/llm";
import { splitIntoTrigrams } from "../handlers/rlhf/phrase-scorer";

// Cache for trigram weights to avoid recalculating
const trigramWeightsCache = new Map<string, number>();

/**
 * Calculate weights for trigrams based on comment reactions and edits
 * @param comments - Array of weighted comments to analyze
 * @returns Map of trigram to weight
 */
export function calculateTrigramWeights(comments: StreamlinedComment[]): Map<string, number> {
  const trigramWeights = new Map<string, number>();

  for (const comment of comments) {
    if (!comment.body) continue;

    // Get base weight from comment's reactions and edits
    const commentWeight = comment.weight || 0;

    // Split comment into trigrams
    const trigrams = splitIntoTrigrams(comment.body);

    // Distribute comment weight across its trigrams
    const weightPerTrigram = commentWeight / trigrams.length;

    for (const trigram of trigrams) {
      const currentWeight = trigramWeights.get(trigram) || 0;
      trigramWeights.set(trigram, currentWeight + weightPerTrigram);
    }
  }

  return trigramWeights;
}

/**
 * Get weight for a specific trigram from the weighted comments
 * @param trigram - The trigram to get weight for
 * @param comments - Array of weighted comments to analyze
 * @returns Weight of the trigram
 */
export function getTrigramWeight(trigram: string, comments: StreamlinedComment[]): number {
  // Check cache first
  const cachedWeight = trigramWeightsCache.get(trigram);
  if (cachedWeight !== undefined) {
    return cachedWeight;
  }

  // Calculate weights if not in cache
  const weights = calculateTrigramWeights(comments);

  // Cache all weights
  for (const [t, w] of weights.entries()) {
    trigramWeightsCache.set(t, w);
  }

  return weights.get(trigram) || 0;
}

/**
 * Calculate score for a piece of text based on its trigrams
 * @param text - Text to score
 * @param comments - Array of weighted comments to analyze
 * @returns Score for the text
 */
export function calculateTextScore(text: string, comments: StreamlinedComment[]): number {
  const trigrams = splitIntoTrigrams(text);
  let score = 0;

  for (const trigram of trigrams) {
    score += getTrigramWeight(trigram, comments);
  }

  return score;
}

/**
 * Clear the trigram weights cache
 */
export function clearTrigramWeightsCache(): void {
  trigramWeightsCache.clear();
}
