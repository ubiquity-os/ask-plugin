import { CompletionsType } from "./completions";
import OpenAI from "openai";

interface FormattedOutput {
  formattedAnswer: string;
  formattedCitations: string[];
}

export class OutputFormatter {
  private static async _formatWithO1Mini(text: string, client: OpenAI): Promise<string> {
    try {
      const response = await client.chat.completions.create({
        model: "o1-mini",
        messages: [
          {
            role: "system",
            content: `You are an authoritative technical writer. Format and rephrase the input text following these rules:

1. Writing Style:
- Use direct, authoritative statements
- Remove phrases like "Based on the context", "I think", "It appears"
- Start sentences with action verbs when possible
- Be concise and definitive
- Maintain technical accuracy
- Keep existing citations intact

2. Formatting:
For code:
\`\`\`language
code here
\`\`\`

For lists:
- Main point
- Key detail
  - Sub-detail
  - Sub-detail

For headings:
# Main Topic

## Sub-topic

For paragraphs:
One clear statement per paragraph.

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

    // Format lists
    formattedText = formattedText.replace(/^[-*]\s/gm, "\n- ");
    formattedText = formattedText.replace(/^\d+\.\s/gm, (match) => `\n${match}`);

    // Format headings
    formattedText = formattedText.replace(/^(#{1,6}\s.*?)$/gm, "\n$1\n");

    // Format paragraphs
    formattedText = formattedText
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .join("\n\n");

    // Clean up multiple newlines
    formattedText = formattedText.replace(/\n{3,}/g, "\n\n");

    return formattedText.trim();
  }

  private static _formatCitation(citation: { reference: string; description: string; url?: string }): string {
    const urlText = citation.url ? ` - [View Source](${citation.url})` : "";
    return `${citation.reference}: ${citation.description}${urlText}`;
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
    ];

    let result = text;
    weakPhrases.forEach((phrase) => {
      result = result.replace(phrase, "");
    });

    return result;
  }

  public static async format(completionResult: CompletionsType, client: OpenAI): Promise<FormattedOutput> {
    // First remove weak phrases
    const strongAnswer = this._removeWeakPhrases(completionResult.answer);

    // Format the answer using o1-mini with fallback
    const formattedAnswer = await this._formatWithO1Mini(strongAnswer, client);

    // Format citations
    const formattedCitations = completionResult.citations.map(this._formatCitation);

    return {
      formattedAnswer: formattedAnswer.trim(),
      formattedCitations,
    };
  }

  public static buildFinalOutput(formattedOutput: FormattedOutput): string {
    const { formattedAnswer, formattedCitations } = formattedOutput;

    // If there are no citations, just return the formatted answer
    if (formattedCitations.length === 0) {
      return formattedAnswer;
    }

    // Build the final output with citations
    return `${formattedAnswer}\n\n---\n\n### References\n\n${formattedCitations.join("\n\n")}`;
  }
}
