import { StaticDecode, Type as T } from "@sinclair/typebox";

/**
 * This should contain the properties of the bot config
 * that are required for the plugin to function.
 *
 * The kernel will extract those and pass them to the plugin,
 * which are built into the context object from setup().
 */

export const pluginSettingsSchema = T.Object({
  model: T.String({ default: "o1-mini" }),
  openAiBaseUrl: T.Optional(T.String()),
  similarityThreshold: T.Number({ default: 0.9 }),
  maxDepth: T.Optional(T.Number({ default: 3 })), // max depth of the chat history to be fetched
});

export type PluginSettings = StaticDecode<typeof pluginSettingsSchema>;
