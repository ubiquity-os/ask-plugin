/// Implementation of the socring module for the completions.

import { CompletionsType } from "../../adapters/openai/helpers/completions";
import { WeightTableResult } from "../../adapters/supabase/helpers/weights";
import { Context } from "../../types/context";
import { splitIntoTrigrams } from "./phrase-scorer";

/// Given a Phrase Check if overall weight of the phrase is
export async function calculateCompletionScore(completion: CompletionsType, context: Context): Promise<number> {
  let score = 0;
  const { answer } = completion;
  const trigrams = splitIntoTrigrams(answer);
  if (trigrams.length === 0) {
    throw new Error("No trigrams found in the completion");
  } else {
    const {
      adapters: { supabase },
    } = context;
    for (const trigram of trigrams) {
      const weight = await supabase.weights.getWeight(trigram);
      score += weight;
    }
  }
  return score;
}

/// Create a structured representation of the phrase weight table
export async function createWeightTable(context: Context) {
  const {
    adapters: { supabase },
  } = context;
  const weights = await supabase.weights.getAllWeights();
  if (!weights) {
    throw new Error("Error getting weights");
  }
  /// Create a structured representation of the weights
  const table = formatWeightTable(weights);
  return weightTableToString(table);
}

function formatWeightTable(data: WeightTableResult[]): string[][] {
  const table = [["Phrase Word Table"], ["word", "score", "nature"], ["----------------------------------------"]];

  for (const weight of data) {
    let nature = "NEUTRAL";
    if (weight.weight > 0) {
      nature = "POSITIVE";
    } else if (weight.weight < 0) {
      nature = "NEGATIVE";
    }
    table.push([weight.phrase, weight.weight.toString(), nature]);
  }
  return table;
}

function weightTableToString(table: string[][]): string {
  return table.map((row) => row.join(" | ")).join("\n");
}
