import { normalizeOcrLayout } from './ocr-layout';

export function syntheticPage() {
  return {
    page: 1,
    width: 100,
    height: 200,
    coordinateSpace: 'preprocessed_page',
    lines: [
      {
        lineId: 'line_1',
        bbox: [5, 10, 90, 20],
        detectionBbox: [7, 12, 88, 18],
        text: 'Texto original uno',
        confidence: 0.7,
        order: 1,
      },
      { lineId: 'line_2', bbox: [5, 30, 90, 40], text: 'Texto original dos', order: 2 },
    ],
  };
}

describe('normalizeOcrLayout', () => {
  it('preserves line identity, crop and detector geometry without local paths', () => {
    const page = syntheticPage();
    const value = normalizeOcrLayout('run_1', [{ ...page, sourcePath: 'C:/private/source.png' }]);
    expect(value?.pages[0].lines[0]).toEqual(expect.objectContaining(page.lines[0]));
    expect(JSON.stringify(value)).not.toContain('private');
  });
  it.each([
    [null, [syntheticPage()]],
    ['run_1', undefined],
    ['../private', [syntheticPage()]],
    ['run_1', [{ ...syntheticPage(), width: null }]],
    [
      'run_1',
      [{ ...syntheticPage(), lines: [{ ...syntheticPage().lines[0], bbox: [-1, 0, 5, 6] }] }],
    ],
    ['run_1', [syntheticPage(), syntheticPage()]],
    ['run_1', [{ ...syntheticPage(), page: 2 }, syntheticPage()]],
  ])(
    'rejects malformed or legacy geometry instead of inventing or dropping lines',
    (run, pages) => {
      expect(normalizeOcrLayout(run, pages)).toBeNull();
    },
  );
  it('retains a dimensioned page with no detected lines', () => {
    expect(normalizeOcrLayout('run_1', [{ ...syntheticPage(), lines: [] }])?.pages).toHaveLength(1);
  });
});
