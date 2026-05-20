import {
  durableBarWriter,
  type DurableBarsWriteResult,
} from "@/services/durable_bar_writer.js";
import type { Bar } from "@/types/common.types.js";

export interface FlatFileIngestionRequest {
  bars: Bar[];
  metadata?: {
    fileName?: string;
    provider?: string;
    dataset?: string;
  };
}

export interface FlatFileIngestionResult extends DurableBarsWriteResult {
  metadata: FlatFileIngestionRequest["metadata"];
}

export class FlatFileIngestionService {
  async ingestBars(
    request: FlatFileIngestionRequest,
  ): Promise<FlatFileIngestionResult> {
    const result = await durableBarWriter.writeDurableBars(
      request.bars,
      "flat_file",
    );

    return {
      ...result,
      metadata: request.metadata,
    };
  }
}

export const flatFileIngestionService = new FlatFileIngestionService();
