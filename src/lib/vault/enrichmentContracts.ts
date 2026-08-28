export const RELATED_NOTES_PRODUCER = "arepo.related-notes" as const;
export const RELATED_NOTES_PRODUCER_VERSION = 1;
export const RELATED_NOTES_DERIVATION_VERSION = 1;

export const RELATED_NOTES_CURATION_KIND = "arepo.relatedNotesCuration" as const;
export const RELATED_NOTES_CURATION_VERSION = 1;
export const RELATED_NOTES_CURATION_MAX_DECISIONS = 10_000;

export function compareRelatedNotesCurationPaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export type RelatedNotesCurationDecision = "kept" | "dismissed";

export type RelatedNotesCurationFreshness =
  | "current"
  | "left-changed"
  | "right-changed"
  | "both-changed"
  | "left-missing"
  | "right-missing"
  | "both-missing";

export type RelatedNotesCurationRecord = {
  leftPath: string;
  rightPath: string;
  decision: RelatedNotesCurationDecision;
  decidedAt: string;
  leftHashAtDecision: string;
  rightHashAtDecision: string;
  producerAtDecision?: string;
  producerVersionAtDecision?: number;
};

export type RelatedNotesCurationPresentation = Pick<
  RelatedNotesCurationRecord,
  | "leftPath"
  | "rightPath"
  | "decision"
  | "decidedAt"
  | "producerAtDecision"
  | "producerVersionAtDecision"
> & {
  freshness: RelatedNotesCurationFreshness;
};

export type RelatedNotesCurationResponse = {
  status: "ready" | "invalid";
  vaultId: string;
  sourcePath?: string;
  canMutate: boolean;
  summary: { kept: number; dismissed: number };
  decisions: RelatedNotesCurationPresentation[];
  diagnostic?: string;
};

export type RelatedNotesCurationMutationResponse = {
  status: "updated" | "cleared";
  decision?: RelatedNotesCurationPresentation;
};

export type RelatedNotesKeptRelationship = {
  targetPath: string;
  decidedAt: string;
  freshness: RelatedNotesCurationFreshness;
  explicitInSource: boolean;
};

export type RelatedNotesCurationResult = {
  status: "ready" | "invalid";
  kept: RelatedNotesKeptRelationship[];
  diagnostic?: string;
};

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

export type RelatedNotesDerivedResponse = {
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

export type RelatedNotesResponse = RelatedNotesDerivedResponse & {
  curation: RelatedNotesCurationResult;
};

export type RelatedNotesDisabledResponse = {
  status: "disabled";
  producer: typeof RELATED_NOTES_PRODUCER;
  candidates: [];
};

export type RelatedNotesEndpointResponse = RelatedNotesResponse | RelatedNotesDisabledResponse;
