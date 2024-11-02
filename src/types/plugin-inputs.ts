import { SupportedEvents, SupportedEventsU } from "./context";
import { StaticDecode, Type as T } from "@sinclair/typebox";
import { StandardValidator } from "typebox-validators";

export interface PluginInputs<T extends SupportedEventsU = SupportedEventsU, TU extends SupportedEvents[T] = SupportedEvents[T]> {
  stateId: string;
  eventName: T;
  eventPayload: TU["payload"];
  settings: PluginSettings;
  authToken: string;
  ref: string;
}

/**
 * This should contain the properties of the bot config
 * that are required for the plugin to function.
 *
 * The kernel will extract those and pass them to the plugin,
 * which are built into the context object from setup().
 */

const chainOfThoughtSchema = T.Object(
  {
    enabled: T.Boolean({ default: true }),
    steps: T.Array(T.String(), {
      default: [
        "Understand the question and context",
        "Analyze relevant information from provided context",
        "Consider technical implications",
        "Form logical reasoning chain",
        "Generate comprehensive response",
      ],
    }),
    temperature: T.Number({ default: 0.7 }),
    requireExplanation: T.Boolean({ default: true }),
  },
  { default: {} }
);

export const pluginSettingsSchema = T.Object({
  model: T.String({ default: "o1-mini" }),
  openAiBaseUrl: T.Optional(T.String()),
  similarityThreshold: T.Number({ default: 0.9 }),
  maxTokens: T.Number({ default: 10000 }),
  chainOfThought: T.Optional(chainOfThoughtSchema),
});

export const pluginSettingsValidator = new StandardValidator(pluginSettingsSchema);

export type PluginSettings = StaticDecode<typeof pluginSettingsSchema>;
