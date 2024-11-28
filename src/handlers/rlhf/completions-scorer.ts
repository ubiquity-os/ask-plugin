import { CompletionsType } from "../../adapters/openai/helpers/completions";
import { Context } from "../../types/context";
import { StreamlinedComment } from "../../types/llm";
import { calculateTextScore, calculateTrigramWeights } from "../../helpers/trigram-weights";

/**
 * Calculate a score for a completion based on weighted comments
 */
export async function calculateCompletionScore(completion: CompletionsType, context: Context, weightedComments: StreamlinedComment[]): Promise<number> {
  const { answer } = completion;
  return calculateTextScore(answer, weightedComments);
}

/**
 * Create a structured representation of the trigram weights
 */
export async function createWeightTable(weightedComments: StreamlinedComment[]) {
  const weights = calculateTrigramWeights(weightedComments);
  const table = formatWeightTable(weights);
  return weightTableToString(table);
}

function formatWeightTable(weights: Map<string, number>): string[][] {
  const table = [["Trigram Weight Table"], ["trigram", "score", "nature"], ["----------------------------------------"]];

  for (const [trigram, weight] of weights.entries()) {
    let nature = "NEUTRAL";
    if (weight > 0) {
      nature = "POSITIVE";
    } else if (weight < 0) {
      nature = "NEGATIVE";
    }
    table.push([trigram, weight.toFixed(2), nature]);
  }
  return table;
}

function weightTableToString(table: string[][]): string {
  return table.map((row) => row.join(" | ")).join("\n");
}
