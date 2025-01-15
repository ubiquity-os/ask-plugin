/// Implementation of the phrase scorer.
/// The phrase scorer is responsible for scoring a given phrase based on the weights
/// assigned to the trigrams in the phrase.
/// User Feedback is of two types: Reactions and Edits
/// Reactions: Thumb Up, Thumb Down (+1, -1)
/// Edits: Edit the weight of the phrase (Phrase Removed penality and
/// Phrase Added bonus))

import { Context } from "../../types/context";
import { Phrase } from "../../types/rlhf";
import { calculateTextScore } from "../../helpers/trigram-weights";
import { StreamlinedComment } from "../../types/llm";

/// Update scores for phrases based on edits and reactions
/// Now uses the new weights system based on reactions and edits history
export async function updatePhraseScoreEdit(
  phrase: Phrase,
  context: Context,
  weightedComments: StreamlinedComment[],
  scoringMultiplier: number,
  isAddition: boolean
) {
  /// Calculate current score using the weighted comments system
  const currentScore = calculateTextScore(phrase.text, weightedComments);

  /// Update the weight based on the edit action
  const newScore = isAddition ? currentScore + scoringMultiplier : currentScore - scoringMultiplier;

  context.logger.info(`Updated score for phrase "${phrase.text}": ${currentScore} -> ${newScore}`);

  return newScore;
}

/// Split text into trigrams for scoring
/// This function creates both word-level and character-level trigrams
/// to capture both semantic and character patterns
export function splitIntoTrigrams(phrase: string): string[] {
  // Normalize the text: lowercase and remove special characters
  const normalized = phrase.toLowerCase().replace(/[^a-z0-9\s]/g, "");

  // Split into words
  const words = normalized.split(/\s+/).filter((word) => word.length > 0);

  const trigrams = [];

  // Handle word-level trigrams
  for (let i = 0; i < words.length - 2; i++) {
    trigrams.push(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
  }

  // Handle character-level trigrams for each word
  words.forEach((word) => {
    if (word.length >= 3) {
      for (let i = 0; i < word.length - 2; i++) {
        trigrams.push(word.slice(i, i + 3));
      }
    }
  });

  return [...new Set(trigrams)]; // Remove duplicates
}
