import OpenAI from "openai";

export class OutputFormatter {
  private static async _formatWithO1Mini(text: string, client: OpenAI): Promise<string> {
    try {
      const response = await client.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: `You are an authoritative technical writer. Format and rephrase the input text following these rules:

1. Writing Style:
- Use direct, authoritative statements
- Remove phrases like "Based on the context", "I think", "It appears"
- Start sentences with action verbs when possible
- Be concise yet consise.
- Do Not Add titles to your responses.
- Maintain technical accuracy
- Keep existing citations intact
- Expand on technical concepts when relevant
- Include detailed explanations for complex topics
- Provide context for technical decisions
- Add clarifying examples where helpful

2. Formatting:
For code:
\`\`\`language
code here
\`\`\`

For lists:
- Main point with detailed explanation
  - Sub-detail with context
  - Sub-detail with examples

For headings:
# Main Topic with Context

## Sub-topic with Details

For paragraphs:
One clear statement per paragraph with supporting details.

Add empty line between paragraphs.

Return only the formatted text with improved style.`,
          },
          {
            role: "user",
            content: `Format and improve this text:\n\n${text}`,
          },
        ],
        temperature: 0.1,
        max_tokens: 2000,
      });

      const formattedText = response.choices[0]?.message?.content;
      if (!formattedText) {
        return this._fallbackFormatting(text);
      }

      return formattedText;
    } catch (error) {
      console.error("Error formatting with o1-mini:", error);
      return this._fallbackFormatting(text);
    }
  }

  private static _fallbackFormatting(text: string): string {
    let formattedText = text;

    // Format code blocks
    formattedText = formattedText.replace(/```([\s\S]*?)```/g, (match, code) => {
      const trimmedCode = code.trim();
      return `\n\n\`\`\`\n${trimmedCode}\n\`\`\`\n\n`;
    });

    // Format inline code
    formattedText = formattedText.replace(/`([^`]+)`/g, (match) => `\n${match}\n`);

    // Format lists
    formattedText = formattedText.replace(/^[-*]\s/gm, "\n- ");
    formattedText = formattedText.replace(/^\d+\.\s/gm, (match) => `\n${match}`);

    // Format headings
    formattedText = formattedText.replace(/^(#{1,6}\s.*?)$/gm, "\n$1\n");

    // Format paragraphs with improved spacing
    formattedText = formattedText
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .join("\n\n");

    // Clean up multiple newlines while preserving paragraph spacing
    formattedText = formattedText.replace(/\n{3,}/g, "\n\n");

    return formattedText.trim();
  }

  private static _removeWeakPhrases(text: string): string {
    const weakPhrases = [
      /based on (?:the|this|our) context,?\s*/gi,
      /it appears that\s*/gi,
      /i think\s*/gi,
      /it seems\s*/gi,
      /in my opinion\s*/gi,
      /from what i can see\s*/gi,
      /it looks like\s*/gi,
      /according to the context\s*/gi,
      /after analyzing\s*/gi,
      /based on the information\s*/gi,
      /i believe\s*/gi,
      /possibly\s*/gi,
      /maybe\s*/gi,
      /perhaps\s*/gi,
      /i would say\s*/gi,
    ];

    let result = text;
    weakPhrases.forEach((phrase) => {
      result = result.replace(phrase, "");
    });

    return result;
  }

  public static async format(text: string, client: OpenAI): Promise<string> {
    // First remove weak phrases
    const strongText = this._removeWeakPhrases(text);

    // Format the text using o1-mini with fallback
    const formattedText = await this._formatWithO1Mini(strongText, client);

    return formattedText.trim();
  }
}
