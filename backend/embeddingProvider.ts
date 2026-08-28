import type {
  EmbeddingProviderIdentity,
  SemanticProviderModel,
} from "../src/lib/vault/semanticContracts.js";

export type EmbeddingBatchResult = {
  identity: EmbeddingProviderIdentity;
  vectors: number[][];
};

export interface EmbeddingProvider {
  listModels(): Promise<SemanticProviderModel[]>;
  getIdentity(model: string): Promise<EmbeddingProviderIdentity>;
  embed(model: string, texts: string[]): Promise<EmbeddingBatchResult>;
}

export type EmbeddingProviderFailureKind =
  | "provider-unreachable"
  | "model-not-found"
  | "model-not-embedding-capable"
  | "invalid-provider-response"
  | "temporarily-unavailable";

export class EmbeddingProviderError extends Error {
  constructor(
    readonly kind: EmbeddingProviderFailureKind,
    message: string,
  ) {
    super(message);
    this.name = "EmbeddingProviderError";
  }
}
