import { SupabaseClient } from "@supabase/supabase-js";
import { Context } from "../../../types/context";
import { SuperSupabase } from "./supabase";

export interface WeightTableResult {
  weight: number;
  phrase: string;
  comment_node_id: string;
}

export class Weights extends SuperSupabase {
  constructor(supabase: SupabaseClient, context: Context) {
    super(supabase, context);
  }

  /// Get the weight for the given phrase
  async getWeight(phrase: string): Promise<number> {
    /// Use trigram search to get the weight for the given phrase
    /// Weight vectors would be valid within a org/repo context. Issue ?
    const { data, error } = await this.supabase.rpc("get_weight", {
      input_phrase: phrase,
    });
    if (error) {
      this.context.logger.error(error.message || "Error getting weight for phrase");
      throw new Error(`Error getting weight for phrase: ${phrase}`);
    }
    return data || 0;
  }

  /// Set the weight for the given phrase
  async setWeight(phrase: string, weight: number, commentNodeId: string) {
    /// Set the weight for the given phrase
    const { error } = await this.supabase.rpc("set_weight", {
      inputphrase: phrase,
      weight: weight,
      commentnodeid: commentNodeId,
    });
    if (error) {
      this.context.logger.error(error.message || "Error setting weight for phrase");
      throw new Error(`Error setting weight for phrase: ${phrase}`);
    }
  }

  ///Dump the weight table
  async getAllWeights(): Promise<WeightTableResult[]> {
    const { data, error } = await this.supabase.from<"weights", WeightTableResult>("weights").select("*");
    if (error) {
      throw new Error("Error getting weights");
    }
    return data as WeightTableResult[];
  }
}
