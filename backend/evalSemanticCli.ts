import path from "node:path";
import { EmbeddingProviderError } from "./embeddingProvider.js";
import { OllamaEmbeddingProvider } from "./ollamaEmbeddingProvider.js";
import { loadRelatedNotesEvaluationCorpus } from "./relatedNotesEvaluation.js";
import { formatSemanticEvaluationReport, runSemanticEvaluation } from "./semanticEvaluation.js";
import { DEFAULT_OLLAMA_ENDPOINT } from "../src/lib/vault/semanticContracts.js";

async function main(): Promise<void> {
  const model = process.env.AREPO_OLLAMA_MODEL;
  if (!model) {
    process.stdout.write(
      "Semantic evaluation skipped: set AREPO_OLLAMA_MODEL to an installed Ollama embedding model. Optional: AREPO_OLLAMA_URL (loopback HTTP only).\n",
    );
    return;
  }
  const endpoint = process.env.AREPO_OLLAMA_URL ?? DEFAULT_OLLAMA_ENDPOINT;
  const provider = new OllamaEmbeddingProvider(endpoint);
  await provider.getIdentity(model);
  const corpus = await loadRelatedNotesEvaluationCorpus(
    path.resolve(process.cwd(), "evaluation", "related-notes-v1.json"),
  );
  const report = await runSemanticEvaluation({ corpus, provider, model });
  if (process.argv.slice(2).includes("--json")) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(formatSemanticEvaluationReport(report));
  }
}

main().catch((error: unknown) => {
  const diagnostic =
    error instanceof EmbeddingProviderError
      ? error.message
      : "The semantic evaluation could not be completed.";
  process.stderr.write(`Semantic evaluation unavailable: ${diagnostic}\n`);
  process.exitCode = error instanceof EmbeddingProviderError ? 0 : 1;
});
