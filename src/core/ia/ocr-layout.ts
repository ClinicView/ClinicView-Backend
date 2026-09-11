/** Pixel edges on the preserved, preprocessed page (not the original PDF canvas). */
export type OcrBox = [number, number, number, number];

export type CropSide = 'left' | 'top' | 'right' | 'bottom';
export interface CropProvenance {
  policy: 'fixed_padding' | 'neighbor_padding_v1';
  originalPaddedBbox: OcrBox;
  requestedPaddingPx: number;
  appliedPaddingPx: OcrBox;
  adjustedSides: CropSide[];
  neighborLineIds: string[];
  overlappingLineIds: string[];
}

export interface MachineOcrLine {
  lineId: string;
  text: string;
  confidence: number | null;
  detectionConfidence: number | null;
  bbox: OcrBox;
  detectionBbox: OcrBox | null;
  polygon: number[][];
  regionId: string | null;
  order: number;
  warnings: string[];
  recognitionStatus: string;
  cropProvenance?: CropProvenance;
  detectorIndex?: number;
  rawPolygon?: number[][];
}

export interface MachineOcrPage {
  page: number;
  width: number;
  height: number;
  coordinateSpace: string;
  segmentationMethod: string | null;
  readingOrderMethod: string | null;
  lines: MachineOcrLine[];
  warnings: string[];
}

export interface MachineOcrLayout {
  schemaVersion: 1;
  runId: string;
  pages: MachineOcrPage[];
}

export const OCR_IDENTIFIER = /^[A-Za-z0-9_-]{1,120}$/;

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function confidence(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string').slice(0, 100)
    : [];
}

export function validBox(value: unknown, width: number, height: number): value is OcrBox {
  return (
    Array.isArray(value) &&
    value.length === 4 &&
    value.every((number) => Number.isInteger(number) && number >= 0) &&
    value[0] < value[2] &&
    value[1] < value[3] &&
    value[2] <= width &&
    value[3] <= height
  );
}

function containsBox(outer: OcrBox, inner: OcrBox): boolean {
  return (
    outer[0] <= inner[0] && outer[1] <= inner[1] && outer[2] >= inner[2] && outer[3] >= inner[3]
  );
}

function validRawPolygon(value: unknown): value is number[][] {
  return (
    Array.isArray(value) &&
    value.length <= 64 &&
    value.every(
      (point) =>
        Array.isArray(point) &&
        point.length === 2 &&
        point.every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1_000_000),
    )
  );
}

/** Machine metadata is advisory. Invalid metadata never removes a detected line. */
function cropProvenance(
  value: unknown,
  crop: OcrBox,
  detection: OcrBox | null,
  width: number,
  height: number,
): CropProvenance | null {
  const data = object(value);
  if (
    !data ||
    !detection ||
    !containsBox(crop, detection) ||
    !['fixed_padding', 'neighbor_padding_v1'].includes(String(data.policy)) ||
    !Number.isInteger(data.requestedPaddingPx) ||
    Number(data.requestedPaddingPx) < 0 ||
    Number(data.requestedPaddingPx) > 50000 ||
    !validBox(data.originalPaddedBbox, width, height)
  )
    return null;
  const padding = Number(data.requestedPaddingPx);
  const expectedOriginal = [
    Math.max(0, detection[0] - padding),
    Math.max(0, detection[1] - padding),
    Math.min(width, detection[2] + padding),
    Math.min(height, detection[3] + padding),
  ];
  if (
    data.originalPaddedBbox.some((n, index) => n !== expectedOriginal[index]) ||
    !containsBox(data.originalPaddedBbox, crop)
  )
    return null;
  const applied = [
    detection[0] - crop[0],
    detection[1] - crop[1],
    crop[2] - detection[2],
    crop[3] - detection[3],
  ];
  if (
    !Array.isArray(data.appliedPaddingPx) ||
    data.appliedPaddingPx.length !== 4 ||
    data.appliedPaddingPx.some((n, index) => n !== applied[index])
  )
    return null;
  const sides: CropSide[] = ['left', 'top', 'right', 'bottom'];
  const adjustedSides = sides.filter((_, index) => crop[index] !== expectedOriginal[index]);
  if (
    !Array.isArray(data.adjustedSides) ||
    data.adjustedSides.length !== adjustedSides.length ||
    data.adjustedSides.some((side, index) => side !== adjustedSides[index])
  )
    return null;
  for (const ids of [data.neighborLineIds, data.overlappingLineIds]) {
    if (
      !Array.isArray(ids) ||
      ids.length > 500 ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => typeof id !== 'string' || !OCR_IDENTIFIER.test(id))
    )
      return null;
  }
  if (data.policy === 'fixed_padding' && adjustedSides.length) return null;
  return {
    policy: data.policy as CropProvenance['policy'],
    originalPaddedBbox: [...data.originalPaddedBbox] as OcrBox,
    requestedPaddingPx: padding,
    appliedPaddingPx: applied as OcrBox,
    adjustedSides,
    neighborLineIds: [...(data.neighborLineIds as string[])],
    overlappingLineIds: [...(data.overlappingLineIds as string[])],
  };
}

/** Do not invent geometry for legacy responses or partially discard malformed pages. */
export function normalizeOcrLayout(runId: unknown, rawPages: unknown): MachineOcrLayout | null {
  if (
    typeof runId !== 'string' ||
    !OCR_IDENTIFIER.test(runId) ||
    !Array.isArray(rawPages) ||
    !rawPages.length ||
    rawPages.length > 1000
  )
    return null;
  const pages: MachineOcrPage[] = [];
  const pageIds = new Set<number>();
  const lineIds = new Set<string>();
  for (const rawPage of rawPages) {
    const page = object(rawPage);
    if (
      !page ||
      !Number.isInteger(page.page) ||
      Number(page.page) < 1 ||
      pageIds.has(Number(page.page)) ||
      !Number.isInteger(page.width) ||
      !Number.isInteger(page.height) ||
      Number(page.width) < 1 ||
      Number(page.height) < 1 ||
      Number(page.width) > 50000 ||
      Number(page.height) > 50000 ||
      typeof page.coordinateSpace !== 'string' ||
      !page.coordinateSpace ||
      !Array.isArray(page.lines)
    )
      return null;
    const width = Number(page.width),
      height = Number(page.height);
    const lines: MachineOcrLine[] = [];
    for (const [index, rawLine] of page.lines.entries()) {
      const line = object(rawLine);
      if (
        !line ||
        typeof line.lineId !== 'string' ||
        !OCR_IDENTIFIER.test(line.lineId) ||
        lineIds.has(line.lineId) ||
        typeof line.text !== 'string' ||
        !validBox(line.bbox, width, height)
      )
        return null;
      lineIds.add(line.lineId);
      if (lineIds.size > 20000) return null;
      const polygon =
        Array.isArray(line.polygon) &&
        line.polygon.every(
          (point) =>
            Array.isArray(point) &&
            point.length === 2 &&
            point.every((n) => typeof n === 'number' && Number.isFinite(n)) &&
            point[0] >= 0 &&
            point[0] <= width &&
            point[1] >= 0 &&
            point[1] <= height,
        )
          ? (line.polygon as number[][]).map((point) => [...point])
          : [];
      const detectionBbox = validBox(line.detectionBbox, width, height)
        ? ([...line.detectionBbox] as OcrBox)
        : null;
      const warnings = strings(line.warnings);
      if (detectionBbox && !containsBox(line.bbox, detectionBbox)) {
        warnings.push('machine_crop_clips_detection_requires_review');
      }
      const metadata = cropProvenance(line.cropProvenance, line.bbox, detectionBbox, width, height);
      if (line.cropProvenance != null && !metadata)
        warnings.push('invalid_crop_provenance_requires_review');
      const detectorIndex =
        Number.isInteger(line.detectorIndex) &&
        Number(line.detectorIndex) >= 0 &&
        Number(line.detectorIndex) <= 1_000_000
          ? Number(line.detectorIndex)
          : undefined;
      if (line.detectorIndex != null && detectorIndex === undefined)
        warnings.push('invalid_detector_index_requires_review');
      const rawPolygon = validRawPolygon(line.rawPolygon)
        ? line.rawPolygon.map((point) => [...point])
        : undefined;
      if (line.rawPolygon != null && !rawPolygon)
        warnings.push('invalid_raw_polygon_requires_review');
      lines.push({
        lineId: line.lineId,
        text: line.text,
        bbox: [...line.bbox] as OcrBox,
        detectionBbox,
        polygon,
        confidence: confidence(line.confidence),
        detectionConfidence: confidence(line.detectionConfidence),
        regionId: typeof line.regionId === 'string' ? line.regionId : null,
        order:
          Number.isInteger(line.order) && Number(line.order) >= 1 ? Number(line.order) : index + 1,
        warnings: [...new Set(warnings)],
        recognitionStatus:
          typeof line.recognitionStatus === 'string' ? line.recognitionStatus : 'unknown',
        ...(metadata ? { cropProvenance: metadata } : {}),
        ...(detectorIndex === undefined ? {} : { detectorIndex }),
        ...(rawPolygon ? { rawPolygon } : {}),
      });
    }
    const pageLineIds = new Set(lines.map((line) => line.lineId));
    for (const line of lines) {
      const metadata = line.cropProvenance;
      if (
        metadata &&
        [...metadata.neighborLineIds, ...metadata.overlappingLineIds].some(
          (id) => id === line.lineId || !pageLineIds.has(id),
        )
      ) {
        delete line.cropProvenance;
        line.warnings.push('invalid_crop_provenance_requires_review');
      }
    }
    pageIds.add(Number(page.page));
    pages.push({
      page: Number(page.page),
      width,
      height,
      coordinateSpace: page.coordinateSpace,
      segmentationMethod:
        typeof page.segmentationMethod === 'string' ? page.segmentationMethod : null,
      readingOrderMethod:
        typeof page.readingOrderMethod === 'string' ? page.readingOrderMethod : null,
      lines: lines.sort((a, b) => a.order - b.order),
      warnings: strings(page.warnings),
    });
  }
  return { schemaVersion: 1, runId, pages: pages.sort((a, b) => a.page - b.page) };
}
