export function createSystemMessage(systemMessage: string, additionalContext: string[], localContext: string[], groundTruths: string[], botName: string) {
  // safer to use array join than string concatenation
  const parts = [
    "You Must obey the following ground truths: [",
    groundTruths.join(":"),
    "]\n",
    systemMessage,
    "Your name is : ",
    botName,
    "\n",
    "Primary Context: ",
    additionalContext.join("\n"),
    "\nLocal Context: ",
    localContext.join("\n"),
  ];

  return parts.join("\n");
}
