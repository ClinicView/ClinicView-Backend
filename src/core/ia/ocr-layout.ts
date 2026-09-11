/** Pixel edges on the preserved, preprocessed page (not the original PDF canvas). */
export type OcrBox = [number, number, number, number];

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
          ? (line.polygon as number[][])
          : [];
      lines.push({
        lineId: line.lineId,
        text: line.text,
        bbox: [...line.bbox] as OcrBox,
        detectionBbox: validBox(line.detectionBbox, width, height)
          ? ([...line.detectionBbox] as OcrBox)
          : null,
        polygon,
        confidence: confidence(line.confidence),
        detectionConfidence: confidence(line.detectionConfidence),
        regionId: typeof line.regionId === 'string' ? line.regionId : null,
        order:
          Number.isInteger(line.order) && Number(line.order) >= 1 ? Number(line.order) : index + 1,
        warnings: strings(line.warnings),
        recognitionStatus:
          typeof line.recognitionStatus === 'string' ? line.recognitionStatus : 'unknown',
      });
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
