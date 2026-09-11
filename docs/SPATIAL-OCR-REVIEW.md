# Spatial OCR review (schema version 1)

The backend retains IA v2's detected lines, their unmodified machine text, crop
coordinates, polygons, confidence and warnings in an immutable processing run.
It does **not** infer missing geometry for older flat-text OCR responses.

## Deployment

Apply the additive migration `20260911180000_spatial_ocr_review` and generate the
Prisma client. No records are backfilled with invented boxes. Configure the same
private `IA_INTERNAL_API_KEY` in IA v2 and the backend. This value must never be a
frontend/public environment variable. IA v2 must retain its page artifacts.

The processing request has a configurable bounded timeout (30 minutes by default).
The backend retrieves each preserved PNG with the internal key, verifies its
format and dimensions, and writes a uniquely named private copy and its SHA-256.
Each image is limited to 25 MiB by default; a run has a 256 MiB local image-cache
budget. Missing/unavailable pages retain their geometry with `imageAvailable:false`.
This is not replaced with a misleading render of a differently transformed PDF.

The source image used for boxes is the **preserved preprocessed page**, not an
untransformed PDF coordinate system. The unchanged original upload remains
available through the existing protected document-file endpoint.

## HTTP contract

All paths below are under `/api/patients/:patientId/documents/:id` and require JWT
authentication. Every operation verifies that the document belongs to the patient.

### `GET /ocr-layout` — `documents.read`

Returns:

```typescript
{
  schemaVersion: 1;
  available: boolean;
  reason?: 'OCR_LAYOUT_UNAVAILABLE';
  runId: string | null;
  documentVersion: number;
  documentStatus: string;
  assignedReviewerId: string | null;
  pages: Array<{
    page: number; width: number; height: number; coordinateSpace: string;
    segmentationMethod: string | null; readingOrderMethod: string | null;
    imageAvailable: boolean;
    imageUnavailableReason?: 'PRESERVED_PAGE_UNAVAILABLE';
    warnings: string[];
    lines: Array<{
      lineId: string; text: string; bbox: [number, number, number, number];
      detectionBbox: [number, number, number, number] | null;
      polygon: number[][]; regionId: string | null; order: number;
      confidence: number | null; detectionConfidence: number | null;
      recognitionStatus: string; warnings: string[];
      detectorIndex?: number; rawPolygon?: number[][];
      cropProvenance?: {
        policy: 'fixed_padding' | 'neighbor_padding_v1';
        originalPaddedBbox: [number, number, number, number];
        requestedPaddingPx: number;
        appliedPaddingPx: [number, number, number, number]; // left, top, right, bottom
        adjustedSides: Array<'left' | 'top' | 'right' | 'bottom'>;
        neighborLineIds: string[]; overlappingLineIds: string[];
      };
    }>;
  }>;
  review: null | {
    revision: number; documentVersion: number; stale: boolean;
    lines: ReviewedLine[]; recordedAt: string;
    recordedBy: { id: string; username: string; fullName: string };
    reason: string | null;
  };
  revisions: Array<{
    revision: number; documentVersion: number; recordedAt: string;
    recordedBy: { id: string; username: string; fullName: string };
    reason: string | null;
  }>;
}
```

`pages[].lines` always contains original machine data; a review never replaces
these lines. No filesystem paths, internal URLs or internal keys are exposed.
Confidence/warnings are model signals, not measured completeness or clinical accuracy.

#### Conservative crop-policy provenance (optional, additive)

`bbox` remains the actual machine crop on the preserved preprocessed image;
`detectionBbox` and `polygon` remain the detector's clipped geometry. Consumers
must not add padding again or substitute `originalPaddedBbox` for the actual crop.
`rawPolygon`, when supplied, is the detector polygon **before** page clipping and
may extend outside the page. `detectorIndex` is zero-based detector input order,
not the final reading order. No field is synthesized for historical runs.

`cropProvenance` explains the margin-only policy. `originalPaddedBbox` is the
page-clamped fixed-padding baseline. The backend checks that the actual crop
contains the detector box, stays within that baseline, has exactly the stated
per-side padding, and names exactly the adjusted sides in left/top/right/bottom
order. Neighbor/overlap IDs must be unique other machine lines on the same page.
Padding is an integer in 0–50,000; each reference list has at most 500 IDs.
Raw polygons have at most 64 finite two-coordinate points with absolute
coordinates at most 1,000,000; detector indices are integers in 0–1,000,000.

Invalid optional metadata is omitted with an explicit review warning, **not** by
discarding the line, its text, or its original coordinates. A machine crop that
clips its detector receives `machine_crop_clips_detection_requires_review`;
the backend never quietly repairs or shrinks detector geometry. Remaining
overlaps/possible duplicate detections also require review; they are not removed
automatically. Fewer padding overlaps is not evidence of complete digitization.

The immutable machine-layout JSON stores these optional values with its run.
No migration, backfill, historical run rewrite or correction rewrite is required.
Reading stored history does not re-normalize it with today's policy. Human
regions and splits may legitimately be smaller than original detections: the
machine crop-containment rule is **not** a restriction on human review geometry.
The existing run/version guards and append-only revisions remain unchanged.

### `PATCH /ocr-layout/review` — `documents.validate`

```typescript
type ReviewedLine = {
  lineId: string;
  page: number;
  bbox: [number, number, number, number];
  order: number;
  text: string;
  reviewed: boolean;
  sourceLineIds: string[];
  reason?: string;
};

type Request = {
  expectedVersion: number;
  runId: string;
  lines: ReviewedLine[];
  reason?: string;
  confirmTextReplacement?: boolean;
};
```

The request contains **all** reviewed lines, including untouched ones and all
pages. The document must be `PROCESSED` and assigned to the authenticated reviewer.
The run must be the latest processing run. A document version compare-and-swap
guards the entire transaction, including its append-only review revision.

Rules:

- Coordinates are integer pixel edges `[x1,y1,x2,y2]`, positive area, inside the
  declared page. IDs are `[A-Za-z0-9_-]`, 1–120 characters. Order is positive and
  unique within a page; IDs are unique within the request.
- Every original machine line must occur in the union of `sourceLineIds`.
  No source can silently disappear. References must belong to the same page.
- Merge: one new line references all merged source IDs. Split: several new lines
  may reference the same source ID. A reused original ID must retain its own origin.
- A manually added region uses `sourceLineIds:[]` and requires a reason of at least
  10 characters. Reasons are limited to 500 characters.
- Text is limited to 4,000 characters per line and 50,000 characters in aggregate.
  The endpoint has a 4 MiB JSON body limit and a maximum of 20,000 lines.
- Reconstructed text is exactly
  `lines.sort(page, order).map(line => line.text).join('\n').trim()`.
  There is no extra blank line between pages.
- Saving also updates `correctedText` atomically, **not** the original `ocrText`.
  It does not overwrite entities or clinically validate the document.
- If an existing `correctedText` differs, `confirmTextReplacement:true` is required
  after an explicit frontend confirmation. The previous text/entities/version are
  preserved privately in the new revision, not copied into operational audit logs.

Response: refreshed `GET /ocr-layout` shape. Invalid geometry/provenance returns
400. Stale version/run, wrong assignment/status or missing replacement confirmation
returns 409, without a partial save.

Later flat-text edits do not rewrite line revisions. `review.stale` becomes true
when the latest revision's reconstructed text differs from current corrected text.
Clients must not present such a revision as synchronized with the clinical draft.
Marking a line reviewed is not a substitute for the existing clinical checklist.

### `GET /ocr-layout/pages/:page/image?runId=...` — `documents.read`

Returns only the exact private PNG for that document/run/page after a hash check.
Response headers include `Cache-Control: private, no-store, max-age=0`, `Pragma:
no-cache`, and `X-Content-Type-Options: nosniff`. Unavailable pages/runs return 404.
There is no arbitrary file-path/URL input and no unauthenticated image URL.

### `GET /ocr-layout/reviews/:revision?runId=...` — `documents.read`

Returns the historical revision metadata, lines, reconstructed `correctedText` and
`previousCorrection:{text,entities,documentVersion}`. History is read-only.

## Integrity and tests

Database triggers reject updates/deletes on the run and revision tables. Runs and
successful processing status are committed together. Duplicate processing claims
and stale callbacks are protected by status/version predicates. Notification
failure cannot turn a successfully processed document into `FAILED`.

Unit tests cover geometry, provenance, ordering, legacy responses, private artifact
fetch limits, hash mismatch, ownership predicates, permissions, revisions and CAS.
The existing isolated Postgres E2E suite additionally covers real concurrent HTTP
saves, immutable database triggers, protected image copies, patient isolation,
flat-text staleness, explicit replacement and historical actor snapshots. Fixtures
are synthetic and IA calls are mocked; no clinical PDF belongs in this repository.
