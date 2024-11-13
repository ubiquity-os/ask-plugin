/// Handle the Updates from the User/Context

import { Context } from "../../types/context";
import { updatePhraseScoreEdit } from "./phrase-scorer";

export interface UpdatedBody {
  text: string;
  type: "addition" | "deletion";
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
    await updatePhraseScoreEdit({ text, type: "trigram" }, context, 1, isAddition);
  }
  //As for the reactions, the schema would contain the issue node id
  //Cross join the issue node id with the trigram and return the weights from the
  //functions directly
}

/// Find the diffs from the old and new body
function findDiffs(oldBody: string, newBody: string): UpdatedBody[] {
  const diffs: UpdatedBody[] = [];
  const oldBodyArray = oldBody.split("\n");
  const newBodyArray = newBody.split("\n");

  const maxLength = Math.max(oldBodyArray.length, newBodyArray.length);

  for (let i = 0; i < maxLength; i++) {
    const oldLine = oldBodyArray[i];
    const newLine = newBodyArray[i];

    if (oldLine === newLine) {
      continue;
    }

    if (oldLine === undefined) {
      diffs.push({ text: newLine, type: "addition" });
    } else if (newLine === undefined) {
      diffs.push({ text: oldLine, type: "deletion" });
    } else {
      diffs.push({ text: newLine, type: "addition" });
      diffs.push({ text: oldLine, type: "deletion" });
    }
  }
  return diffs;
}
