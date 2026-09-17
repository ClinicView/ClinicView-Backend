import type { OcrBox } from '../../../core/ia/ocr-layout';

interface EvaluationPage<TLine> {
  page: number;
  width: number;
  height: number;
  coordinateSpace: string;
  imageSha256: string;
  lines: TLine[];
}

interface PredictionLine {
  lineId: string;
  text: string;
  order: number;
  bbox: OcrBox;
  recognitionStatus: string;
}

interface ReferenceDraftLine {
  lineId: string;
  text: string;
  order: number;
  bbox: OcrBox;
  sourceLineIds: string[];
  reviewed: true;
}

/** Private evaluation input, not ground-truth certification or a training dataset. */
export interface OcrEvaluationSnapshotDto {
  schemaVersion: 1;
  kind: 'clinicview-ocr-evaluation-snapshot';
  exportedAt: string;
  documentId: string;
  runId: string;
  revision: number;
  sourceSha256: string;
  provenance: {
    referenceKind: 'ocr_postedited';
    referenceDraft: true;
    pageCoverage: 'unassessed';
    clinicalValidationIsReference: false;
    referenceDocumentVersion: number;
    currentDocumentVersion: number;
    currentDocumentStatus: string;
    isCurrentRun: boolean;
    isLatestReview: boolean;
    staleAgainstCurrentCorrection: boolean;
    reviewRecordedAt: string;
  };
  prediction: { pages: EvaluationPage<PredictionLine>[] };
  review: { pages: EvaluationPage<ReferenceDraftLine>[] };
}
