/// Implementation of the phrase scorer.
/// The phrase scorer is responsible for scoring a given phrase based on the weights
/// assigned to the trigrams in the phrase.
/// User Feedback is of two types: Reactions and Edits
/// Reactions: Thumb Up, Thumb Down (+1, -1)
/// Edits: Edit the weight of the phrase (Phrase Removed penality and
/// Phrase Added bonus))

import { Context } from "../../types/context";
import { Phrase } from "../../types/rlhf";

export async function updatePhraseScoreEdit(phrase: Phrase, context: Context, scoringMultiplier: number, isAddition: boolean) {
  const {
    adapters: { supabase },
    payload: { comment },
  } = context;
  /// Get the Comment Node Id for the trigram
  const commentNodeId = comment.node_id;

  /// Update the weight for the trigram
  const weight = await supabase.weights.getWeight(phrase.text);
  context.logger.info(`Weight for trigram ${phrase.text} is ${weight}`);
  if (isAddition) {
    await supabase.weights.setWeight(phrase.text, weight + scoringMultiplier, commentNodeId);
  } else {
    await supabase.weights.setWeight(phrase.text, weight - scoringMultiplier, commentNodeId);
  }
}

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
