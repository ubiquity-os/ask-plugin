//// Implmentation of ROUGE (https://en.wikipedia.org/wiki/ROUGE_(metric))

import { MetricResult, MetricsResult } from "../../types/metrics";

interface RougeScore {
  precision: number;
  recall: number;
  fScore: number;
}

export type RougeInput = {
  candidate: string;
  reference: string;
};

/// Calculate the ROUGE-N score between two strings.
function calculateRougeN(candidate: string, reference: string, n: number): RougeScore {
  const candidateNgrams = getNgrams(candidate, n);
  const referenceNgrams = getNgrams(reference, n);

  const overlap = candidateNgrams.filter((ngram) => referenceNgrams.includes(ngram)).length;

  const precision = overlap / candidateNgrams.length;
  const recall = overlap / referenceNgrams.length;
  const fScore = (2 * precision * recall) / (precision + recall) || 0;

  return { precision, recall, fScore };
}

/// Get all n-grams of a string.
function getNgrams(text: string, n: number): string[] {
  const words = text.toLowerCase().split(/\s+/);
  const ngrams: string[] = [];

  for (let i = 0; i <= words.length - n; i++) {
    ngrams.push(words.slice(i, i + n).join(" "));
  }

  return ngrams;
}

/// Calculate the ROUGE metrics for a given input.
export function calculateRougeMetrics(input: RougeInput): MetricsResult<RougeInput> {
  const { candidate, reference } = input;
  const rouge1 = calculateRougeN(candidate, reference, 1);
  const rouge2 = calculateRougeN(candidate, reference, 2);
  const rougeL = calculateLongestCommonSubsequence(candidate, reference);

  const results: Record<string, MetricResult<RougeInput>> = {
    "rouge1.fScore": {
      input,
      metric: { value: rouge1.fScore, threshold: 0.5, strategy: "greater" },
    },
    "rouge2.fScore": {
      input,
      metric: { value: rouge2.fScore, threshold: 0.3, strategy: "greater" },
    },
    "rougeL.fScore": {
      input,
      metric: { value: rougeL.fScore, threshold: 0.4, strategy: "greater" },
    },
  };

  const isPassed = Object.values(results).every((result) =>
    result.metric.strategy === "greater" ? result.metric.value >= result.metric.threshold : result.metric.value <= result.metric.threshold
  );

  return { passed: isPassed, results };
}

/// Calculate the ROUGE-L score between two strings.
function calculateLongestCommonSubsequence(candidate: string, reference: string): RougeScore {
  const candidateWords = candidate.toLowerCase().split(/\s+/);
  const referenceWords = reference.toLowerCase().split(/\s+/);

  const lcsLength = getLongestCommonSubsequenceLength(candidateWords, referenceWords);

  const precision = lcsLength / candidateWords.length;
  const recall = lcsLength / referenceWords.length;
  const fScore = (2 * precision * recall) / (precision + recall) || 0;

  return { precision, recall, fScore };
}

/// Returns the length of the longest common subsequence between two arrays.
function getLongestCommonSubsequenceLength(arr1: string[], arr2: string[]): number {
  const dp: number[][] = Array(arr1.length + 1)
    .fill(0)
    .map(() => Array(arr2.length + 1).fill(0));

  for (let i = 1; i <= arr1.length; i++) {
    for (let j = 1; j <= arr2.length; j++) {
      if (arr1[i - 1] === arr2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  return dp[arr1.length][arr2.length];
}
