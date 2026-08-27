import path from "node:path";
import {
  formatRelatedNotesEvaluationReport,
  loadRelatedNotesEvaluationCorpus,
  runDeterministicRelatedNotesEvaluation,
} from "./relatedNotesEvaluation.js";

async function main(): Promise<void> {
  const corpusFile = path.resolve(process.cwd(), "evaluation", "related-notes-v1.json");
  const corpus = await loadRelatedNotesEvaluationCorpus(corpusFile);
  const report = runDeterministicRelatedNotesEvaluation(corpus);
  if (process.argv.slice(2).includes("--json")) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(formatRelatedNotesEvaluationReport(report));
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown evaluation failure.";
  process.stderr.write(`Related-note evaluation failed: ${message}\n`);
  process.exitCode = 1;
});
