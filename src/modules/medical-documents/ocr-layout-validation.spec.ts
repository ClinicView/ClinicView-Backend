import { BadRequestException } from '@nestjs/common';
import { normalizeOcrLayout } from '../../core/ia/ocr-layout';
import { validateOcrReviewLines } from './ocr-layout-validation';

const layout = normalizeOcrLayout('run_1', [
  {
    page: 1,
    width: 100,
    height: 100,
    coordinateSpace: 'preprocessed_page',
    lines: [
      { lineId: 'one', text: 'Uno', bbox: [0, 0, 50, 10] },
      { lineId: 'two', text: 'Dos', bbox: [0, 15, 50, 25] },
    ],
  },
  {
    page: 2,
    width: 100,
    height: 100,
    coordinateSpace: 'preprocessed_page',
    lines: [],
  },
])!;

const initial = () =>
  layout.pages[0].lines.map((line) => ({
    lineId: line.lineId,
    page: 1,
    bbox: line.bbox,
    order: line.order,
    text: line.text,
    reviewed: false,
    sourceLineIds: [line.lineId],
  }));

describe('validateOcrReviewLines', () => {
  it('orders pages/lines deterministically and does not modify the machine source', () => {
    const before = JSON.stringify(layout);
    const lines = initial().reverse();
    expect(validateOcrReviewLines(layout, lines).correctedText).toBe('Uno\nDos');
    expect(JSON.stringify(layout)).toBe(before);
  });
  it('supports explicit merging and splitting with complete lineage', () => {
    const merged = [
      { ...initial()[0], lineId: 'merged', text: 'Uno Dos', sourceLineIds: ['one', 'two'] },
    ];
    expect(validateOcrReviewLines(layout, merged).lines).toHaveLength(1);
    const split = [
      ...initial(),
      { ...initial()[0], lineId: 'split', order: 3, text: 'Segunda parte' },
    ];
    expect(validateOcrReviewLines(layout, split).lines).toHaveLength(3);
  });
  it('supports a justified manual region, but never omits a detected origin', () => {
    const manual = {
      ...initial()[0],
      lineId: 'manual',
      sourceLineIds: [],
      reason: 'Renglón omitido por el detector',
      order: 3,
    };
    expect(validateOcrReviewLines(layout, [...initial(), manual]).lines).toHaveLength(3);
    expect(() => validateOcrReviewLines(layout, [manual])).toThrow(BadRequestException);
  });
  it.each([
    (lines: ReturnType<typeof initial>) => lines.slice(1),
    (lines: ReturnType<typeof initial>) => [{ ...lines[0], bbox: [-1, 0, 40, 10] }, lines[1]],
    (lines: ReturnType<typeof initial>) => [{ ...lines[0], bbox: [0, 0, 101, 10] }, lines[1]],
    (lines: ReturnType<typeof initial>) => [{ ...lines[0], bbox: [0, 0, 0, 10] }, lines[1]],
    (lines: ReturnType<typeof initial>) => [{ ...lines[0], bbox: [0.5, 0, 40, 10] }, lines[1]],
    (lines: ReturnType<typeof initial>) => [{ ...lines[0], page: 2 }, lines[1]],
    (lines: ReturnType<typeof initial>) => [{ ...lines[0], sourceLineIds: ['unknown'] }, lines[1]],
    (lines: ReturnType<typeof initial>) => [{ ...lines[0], sourceLineIds: ['two'] }, lines[1]],
    (lines: ReturnType<typeof initial>) => [lines[0], { ...lines[1], lineId: 'one' }],
    (lines: ReturnType<typeof initial>) => [lines[0], { ...lines[1], order: 1 }],
    (lines: ReturnType<typeof initial>) => [
      ...lines,
      { ...lines[0], lineId: 'manual', sourceLineIds: [], order: 3 },
    ],
  ])('rejects omission, invalid geometry, cross-page lineage and ambiguous IDs/order', (mutate) => {
    expect(() => validateOcrReviewLines(layout, mutate(initial()))).toThrow(BadRequestException);
  });
});
