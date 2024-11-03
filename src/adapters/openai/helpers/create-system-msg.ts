export function createSystemMessage(systemMessage: string, additionalContext: string[], localContext: string[], groundTruths: string[], botName: string) {
  // safer to use array join than string concatenation
  const parts = [
    `You Must obey the following ground truths: ${JSON.stringify(groundTruths)}\n`,
    systemMessage,
    `Your name is: ${botName}`,
    "Main Context (Provide additional precedence in terms of information): ",
    localContext.join("\n"),
    "Secondary Context: ",
    additionalContext.join("\n"),
  ];

  return parts.join("\n");
}
