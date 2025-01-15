/// Types for User Feedback

export interface Phrase {
  text: string;
  type: "trigram" | "bigram" | "unigram";
}

export interface CompletionsReaction {
  phrase: Phrase;
  reaction: "up" | "down";
}

export interface CompletionsEdit {
  phrase: Phrase;
  isAddition: boolean;
}

export type UserFeedback = CompletionsReaction | CompletionsEdit;
