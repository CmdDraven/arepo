export const RELATED_NOTES_PRODUCER = "arepo.related-notes" as const;
export const RELATED_NOTES_PRODUCER_VERSION = 1;
export const RELATED_NOTES_DERIVATION_VERSION = 1;

export type RelatedNoteEvidence =
  | { kind: "tag-overlap"; score: number; sharedTags: string[] }
  | { kind: "title-term-overlap"; score: number; sharedTerms: string[] }
  | { kind: "heading-term-overlap"; score: number; sharedTerms: string[] }
  | { kind: "common-neighbours"; score: number; paths: string[] }
  | { kind: "lexical-similarity"; score: number; sharedTerms: string[] };

export type RelatedNoteCandidate = {
  targetPath: string;
  targetHash: string;
  title: string;
  score: number;
  evidence: RelatedNoteEvidence[];
};

export type RelatedNotesResponse = {
  status: "ready";
  sourcePath: string;
  sourceHash: string;
  corpusHash: string;
  producer: typeof RELATED_NOTES_PRODUCER;
  producerVersion: number;
  derivationVersion: number;
  generatedAt: string;
  candidates: RelatedNoteCandidate[];
};

export type RelatedNotesDisabledResponse = {
  status: "disabled";
  producer: typeof RELATED_NOTES_PRODUCER;
  candidates: [];
};

export type RelatedNotesEndpointResponse = RelatedNotesResponse | RelatedNotesDisabledResponse;
