import Anthropic from "@anthropic-ai/sdk";
import { Context } from "../../../types/context";

export class SuperAnthropic {
  protected client: Anthropic;
  protected context: Context;

  constructor(client: Anthropic, context: Context) {
    this.context = context;
    this.client = client;
  }
}
