import { normalizeOcrLayout } from './ocr-layout';

function fixture() {
  return {
    page: 1,
    width: 100,
    height: 200,
    coordinateSpace: 'preprocessed_page',
    lines: [
      {
        lineId: 'line_1',
        bbox: [0, 4, 96, 21],
        detectionBbox: [7, 12, 88, 18],
        polygon: [
          [7, 12],
          [88, 12],
          [88, 18],
          [7, 18],
        ],
        rawPolygon: [
          [-0.5, 12],
          [100.5, 12],
          [100.5, 18],
          [-0.5, 18],
        ],
        detectorIndex: 9,
        text: 'SYNTHETIC ONE',
        order: 1,
        warnings: ['overlapping_detections_require_review'],
        cropProvenance: {
          policy: 'neighbor_padding_v1',
          originalPaddedBbox: [0, 4, 96, 26],
          requestedPaddingPx: 8,
          appliedPaddingPx: [7, 8, 8, 3],
          adjustedSides: ['bottom'],
          neighborLineIds: ['line_2'],
          overlappingLineIds: [],
        },
      },
      { lineId: 'line_2', bbox: [5, 24, 90, 40], text: 'SYNTHETIC TWO', order: 2 },
    ],
  };
}

describe('optional machine crop provenance', () => {
  it('retains exact crop, original detection, raw geometry and named policy, without private extra fields', () => {
    const source = fixture();
    const result = normalizeOcrLayout('run_new', [
      {
        ...source,
        sourcePath: 'C:/private/page.png',
        lines: source.lines.map((line) => ({
          ...line,
          cropProvenance: line.cropProvenance && {
            ...line.cropProvenance,
            path: 'C:/private/crop.png',
          },
        })),
      },
    ])!;
    expect(result.pages[0].lines[0]).toEqual(expect.objectContaining(source.lines[0]));
    expect(result.pages[0].lines.map((line) => line.lineId)).toEqual(['line_1', 'line_2']);
    expect(JSON.stringify(result)).not.toContain('private');
  });

  it('does not retain mutable references or retrofit a prior run when a later policy changes', () => {
    const source = fixture();
    const oldRun = normalizeOcrLayout('run_old', [source])!;
    const snapshot = JSON.stringify(oldRun);
    source.lines[0].cropProvenance!.originalPaddedBbox[0] = 1;
    source.lines[0].cropProvenance!.neighborLineIds.push('different');
    source.lines[0].rawPolygon![0][0] = 999;
    source.lines[0].polygon![0][0] = 999;
    source.lines[0].bbox[0] = 1;
    const newer = normalizeOcrLayout('run_new', [source])!;
    expect(JSON.stringify(oldRun)).toBe(snapshot);
    expect(newer.runId).toBe('run_new');
    expect(newer.pages[0].lines[0].cropProvenance).toBeUndefined();
    expect(oldRun.pages[0].lines[0].bbox).toEqual([0, 4, 96, 21]);
  });

  it.each([
    { policy: 'unknown' },
    { requestedPaddingPx: -1 },
    { requestedPaddingPx: 50001 },
    { requestedPaddingPx: true },
    { originalPaddedBbox: [0, 0, 99, 99] },
    { appliedPaddingPx: [7, 8, 8, 8] },
    { adjustedSides: ['top'] },
    { adjustedSides: ['bottom', 'bottom'] },
    { policy: 'fixed_padding' },
    { neighborLineIds: ['../private'] },
    { neighborLineIds: ['line_2', 'line_2'] },
    { neighborLineIds: ['line_1'] },
    { neighborLineIds: ['missing'] },
    { overlappingLineIds: ['missing'] },
    { neighborLineIds: Array.from({ length: 501 }, (_, i) => `line_${i}`) },
  ])(
    'omits inconsistent metadata with a warning, never silently removes geometry/OCR (%j)',
    (overrides) => {
      const page = fixture();
      const original = page.lines[0];
      const result = normalizeOcrLayout('run_1', [
        {
          ...page,
          lines: [
            { ...original, cropProvenance: { ...original.cropProvenance, ...overrides } },
            page.lines[1],
          ],
        },
      ])!;
      expect(result.pages[0].lines).toHaveLength(2);
      expect(result.pages[0].lines[0]).toMatchObject({
        text: original.text,
        bbox: original.bbox,
        detectionBbox: original.detectionBbox,
      });
      expect(result.pages[0].lines[0].cropProvenance).toBeUndefined();
      expect(result.pages[0].lines[0].warnings).toContain(
        'invalid_crop_provenance_requires_review',
      );
    },
  );

  it('checks neighbor provenance within the same page, not just globally unique IDs', () => {
    const first = fixture();
    const second = {
      ...fixture(),
      page: 2,
      lines: [{ lineId: 'other_page_line', text: 'OTHER', bbox: [0, 0, 40, 40] }],
    };
    first.lines[0].cropProvenance!.neighborLineIds = ['other_page_line'];
    const value = normalizeOcrLayout('run_1', [first, second])!;
    expect(value.pages[0].lines[0].cropProvenance).toBeUndefined();
  });

  it('preserves and flags a malformed machine crop that clips detector coverage, without shrinking the detector', () => {
    const page = fixture();
    page.lines[0].bbox = [10, 4, 85, 21];
    const line = normalizeOcrLayout('run_1', [page])!.pages[0].lines[0];
    expect(line.bbox).toEqual([10, 4, 85, 21]);
    expect(line.detectionBbox).toEqual([7, 12, 88, 18]);
    expect(line.cropProvenance).toBeUndefined();
    expect(line.warnings).toContain('machine_crop_clips_detection_requires_review');
  });

  it.each([NaN, Infinity, -1, 1.5, 1000001, true, '2'])(
    'omits invalid detector index %j with a warning',
    (detectorIndex) => {
      const page = fixture();
      const line = normalizeOcrLayout('run_1', [
        { ...page, lines: [{ ...page.lines[0], detectorIndex }, page.lines[1]] },
      ])!.pages[0].lines[0];
      expect(line.detectorIndex).toBeUndefined();
      expect(line.warnings).toContain('invalid_detector_index_requires_review');
    },
  );

  it.each([
    [[NaN, 2]],
    [[Infinity, 2]],
    [[1000001, 2]],
    [[1, 2, 3]],
    Array(65).fill([1, 2]),
    'path',
  ])('bounds raw polygon metadata (%j)', (rawPolygon) => {
    const page = fixture();
    const line = normalizeOcrLayout('run_1', [
      { ...page, lines: [{ ...page.lines[0], rawPolygon }, page.lines[1]] },
    ])!.pages[0].lines[0];
    expect(line.rawPolygon).toBeUndefined();
    expect(line.warnings).toContain('invalid_raw_polygon_requires_review');
  });

  it('accepts fixed padding and legacy missing/null metadata without inventing provenance', () => {
    const page = fixture();
    page.lines[0].bbox = [0, 4, 96, 26];
    page.lines[0].cropProvenance!.policy = 'fixed_padding';
    page.lines[0].cropProvenance!.appliedPaddingPx = [7, 8, 8, 8];
    page.lines[0].cropProvenance!.adjustedSides = [];
    const value = normalizeOcrLayout('run_1', [
      {
        ...page,
        lines: [page.lines[0], { ...page.lines[1], cropProvenance: null, detectorIndex: null }],
      },
    ])!;
    expect(value.pages[0].lines[0].cropProvenance?.policy).toBe('fixed_padding');
    expect(value.pages[0].lines[1].cropProvenance).toBeUndefined();
    expect(value.pages[0].lines[1].rawPolygon).toBeUndefined();
    expect(value.pages[0].lines[1].warnings).toEqual([]);
  });
});
