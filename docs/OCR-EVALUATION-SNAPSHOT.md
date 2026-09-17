# Private OCR evaluation snapshot

An evaluation export freezes the relationship between an original OCR run and an
explicit saved spatial review. It is **not** a clinical validation, ground-truth
certification, automatic measurement, training dataset, or image-extraction feature.
The original prediction is retained even when subsequent corrections are better.

## Protected HTTP contract

`GET /api/patients/:patientId/documents/:id/ocr-layout/reviews/:revision/evaluation-snapshot?runId=<uuid>`

- Requires authenticated JWT and **both** `documents.read` and
  `documents.validate`. The document must belong to the patient in the route.
- `runId` is the canonical lowercase UUID of the exact processing run; `revision`
  is a positive integer. There is no implicit latest-run or latest-review fallback.
- Returns a JSON attachment named `ocr-evaluation-<runId>-r<revision>.json`, with
  `Cache-Control: private, no-store, max-age=0`, `Pragma: no-cache`, and `nosniff`.
- Uses the existing audit mechanism with `DOCUMENT_OCR_EVALUATION_EXPORTED`.
  The event records the authenticated actor, document/patient identifiers, route,
  outcome and timing; it does not store request/response text, crop images or PHI.
- The export is read-only. It never changes clinical status, correction text,
  saved revisions, assignments, metrics, or model weights. No schema migration is
  needed. Audit logging is the sole normal operational write.

The source file SHA-256 must be present on a successful processing job with the
**same document and processing run**. Missing, invalid, or contradictory hashes
return 409 rather than guessing from another run or hashing an unrelated file.
Legacy spatial runs without this provenance are not silently upgraded.

Every saved review fragment must be explicitly marked reviewed. The existing
review geometry and source-line checks are applied again: no original source line
can be dropped, and splits, merges and justified manual regions are retained.
The reconstructed review text must equal the immutable saved review text. Missing
page hashes or inconsistent preserved-image dimensions also block the export.

## JSON structure (version 1)

The TypeScript contract is
`src/modules/medical-documents/dto/ocr-evaluation-snapshot.dto.ts`.

```text
schemaVersion: 1
kind: clinicview-ocr-evaluation-snapshot
exportedAt: ISO timestamp
documentId, runId, revision, sourceSha256
provenance:
  referenceKind: ocr_postedited
  referenceDraft: true
  pageCoverage: unassessed
  clinicalValidationIsReference: false
  referenceDocumentVersion, currentDocumentVersion, currentDocumentStatus
  isCurrentRun, isLatestReview, staleAgainstCurrentCorrection
  reviewRecordedAt
prediction.pages[]:
  page, width, height, coordinateSpace, imageSha256
  lines[]: lineId, text, order, bbox, recognitionStatus
review.pages[]:
  page, width, height, coordinateSpace, imageSha256
  lines[]: lineId, text, order, bbox, sourceLineIds, reviewed
```

The prediction comes only from the immutable `DocumentOcrRun.machineLayout`.
The reference draft comes only from the requested immutable
`DocumentOcrReviewRevision`, not the document's current flat correction.
No model identifier is invented when it was not stored with the run. Arrays and
pixel-edge boxes are copied without modifying their source records. Review order
is the saved page/order sequence; original machine order remains unchanged.
The spatial contract has no implicit `excluded` flag: an explicit reviewed empty
text remains empty, while a merge retains several source IDs but only one reviewed
text. Consumers must concatenate review texts by page/order, never expand original
machine texts from `sourceLineIds` or replace an empty correction with OCR text.

The exported page SHA-256 is the stored fingerprint of the exact preserved,
preprocessed image coordinate space. Export does not reread or package its image
binary, so the fingerprint does not claim current file availability. Authorized
page-image requests remain separate and verify the stored image bytes on access.

Historical runs and revisions may be exported. The current/latest/staleness flags
make their relationship to the current clinical document explicit; an old snapshot
is not silently substituted with a later correction. Related mutable context is
read within a repeatable-read transaction for a consistent observation.

## Reference preparation and limits

**Reviewing every detected fragment is not proof that all page content was detected.**
A region the detector missed will not appear until it is manually added, and an
entire page may contain undetected content. Thus every exported snapshot starts
with `pageCoverage: unassessed` and `referenceDraft: true`, even if the clinical
document is already `VALIDATED`.

Before using it for full-document CER/WER or completeness claims, a reviewer must
compare the draft against every original page, account for missed/illegible text,
and explicitly confirm the reference's scope and completeness in the evaluation
workflow. CER/WER derived only from the detected subset must not be described as
whole-document accuracy. Confidence scores are not measured error rates.

This export supports evaluation preparation only. Packaging crop/text pairs for
training, dataset consent/governance, patient-level train/test separation and
model retraining are separate future work.

## Privacy and verification

Although names, original filenames, reviewer names, storage paths, tokens, previous
correction snapshots and original binary files are omitted, **OCR/review text may
still contain patient information**. This is not anonymization. Keep downloads and
evaluation reports in approved private local storage; do not commit them, attach
them to public issues, or send them to third-party services. Use synthetic inputs
for automated tests and publication examples.

Targeted regression command:

```shell
npm test -- --runInBand ocr-evaluation-snapshot.service.spec.ts ocr-layout.controller.spec.ts ocr-layout.service.spec.ts
```

Tests cover JWT/permission metadata, ownership, exact-run/revision queries,
unchanged predictions, merge/split/manual provenance, stale and historical review
flags, unknown/ambiguous fingerprints, unreviewed lines, no clinical mutation,
private headers and omission of private metadata. These unit tests do not measure
recognition accuracy on real clinical documents.

The existing `clinical-integrity.e2e-spec.ts` spatial-review case also verifies the
endpoint through real Nest HTTP and isolated PostgreSQL: unauthenticated/reader
denials, patient ownership, original and page hashes, privacy headers, audited actor,
unchanged clinical version, historical-text staleness and rejection of an incomplete
review. Follow `test/README.md` for its explicit isolated-database setup. The OCR
boundary is synthetic; those integration tests are not OCR accuracy measurements.
