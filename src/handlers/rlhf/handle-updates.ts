/// Handle the Updates from the User/Context

import { Context } from "../../types/context";
import { updatePhraseScoreEdit } from "./phrase-scorer";

export interface UpdatedBody {
  text: string;
  type: "addition" | "deletion";
}

interface Change {
  startIndex: number;
  endIndex: number;
  text: string;
}

export async function handleUpdatedWeights(context: Context<"issue_comment.edited">) {
  const {
    payload: { changes, comment },
  } = context;
  ///If the body is not changed, return
  if (!changes.body) {
    return;
  }
  /// Find the changes (If new body is empty, then it is a deletion)
  const textChanges = findDiffs(changes.body?.from, comment.body || "");
  // Process each text change and update phrase scores
  for (const { text, type } of textChanges) {
    const isAddition = type === "addition";
    if (text.length > 3) {
      await updatePhraseScoreEdit(
        {
          text: text,
          type: "trigram",
        },
        context,
        1,
        isAddition
      );
    } else if (text.length > 0) {
      // For shorter text (3 or fewer chars), use directly
      await updatePhraseScoreEdit(
        {
          text: text,
          type: text.length === 2 ? "bigram" : "unigram",
        },
        context,
        1,
        isAddition
      );
    }
  }
  //As for the reactions, the schema would contain the issue node id
  //Cross join the issue node id with the trigram and return the weights from the
  //functions directly
}
function findActualChanges(oldText: string, newText: string): { deletions: Change[]; additions: Change[] } {
  const deletions: Change[] = [];
  const additions: Change[] = [];

  // Find common prefix and suffix
  let start = 0;
  const minLength = Math.min(oldText.length, newText.length);

  while (start < minLength && oldText[start] === newText[start]) {
    start++;
  }

  let oldEnd = oldText.length;
  let newEnd = newText.length;

  while (oldEnd > start && newEnd > start && oldText[oldEnd - 1] === newText[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }

  // Include context words before and after
  const contextWords = 2; // Number of words to include before/after

  // Extend start to include context words before
  let contextStart = start;
  let wordsBefore = 0;
  while (contextStart > 0 && wordsBefore < contextWords) {
    contextStart--;
    if (oldText[contextStart].match(/\s/)) wordsBefore++;
  }

  // Extend ends to include context words after
  let oldContextEnd = oldEnd;
  let newContextEnd = newEnd;
  let wordsAfter = 0;
  while (oldContextEnd < oldText.length && wordsAfter < contextWords) {
    if (oldText[oldContextEnd].match(/\s/)) wordsAfter++;
    oldContextEnd++;
  }
  wordsAfter = 0;
  while (newContextEnd < newText.length && wordsAfter < contextWords) {
    if (newText[newContextEnd].match(/\s/)) wordsAfter++;
    newContextEnd++;
  }

  if (oldEnd > start) {
    deletions.push({
      startIndex: contextStart,
      endIndex: oldContextEnd,
      text: `...${oldText.slice(contextStart, start)}-${oldText.slice(start, oldEnd)}${oldText.slice(oldEnd, oldContextEnd)}...`,
    });
  }

  if (newEnd > start) {
    additions.push({
      startIndex: contextStart,
      endIndex: newContextEnd,
      text: `...${newText.slice(contextStart, start)}+${newText.slice(start, newEnd)}${newText.slice(newEnd, newContextEnd)}...`,
    });
  }

  return { deletions, additions };
}
/// Find the diffs from the old and new body
export function findDiffs(oldBody: string, newBody: string): UpdatedBody[] {
  const diffs: UpdatedBody[] = [];
  const { deletions, additions } = findActualChanges(oldBody, newBody);
  // Only create trigrams from the actual changed portions
  for (const deletion of deletions) {
    if (deletion.text.trim()) {
      diffs.push({ text: deletion.text.trim(), type: "deletion" });
    }
  }

  for (const addition of additions) {
    if (addition.text.trim()) {
      diffs.push({ text: addition.text.trim(), type: "addition" });
    }
  }

  return diffs;
}
