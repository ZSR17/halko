import { describe, expect, it } from 'vitest';
import { loadPlates } from '../src/lib/plates.ts';

const kg = (n: number) => n * 1000;
const owned = [
  { weightG: kg(5), count: 2 },
  { weightG: kg(2), count: 2 },
  { weightG: kg(1), count: 2 },
  { weightG: kg(0.5), count: 2 },
];

describe('loadPlates', () => {
  it('splits the weight to add between both sides', () => {
    expect(loadPlates(kg(10), kg(23), owned)).toEqual({
      exact: true,
      load: {
        totalG: kg(23),
        perSideG: kg(6.5),
        perSide: [
          { weightG: kg(5), count: 1 },
          { weightG: kg(1), count: 1 },
          { weightG: kg(0.5), count: 1 },
        ],
      },
    });
  });

  it('uses as few plates as possible', () => {
    const plates = [
      { weightG: kg(10), count: 2 },
      { weightG: kg(5), count: 4 },
    ];
    expect(loadPlates(kg(20), kg(40), plates)).toMatchObject({ exact: true, load: { perSide: [{ weightG: kg(10), count: 1 }] } });
    expect(loadPlates(kg(20), kg(50), plates)).toMatchObject({
      exact: true,
      load: { perSide: [{ weightG: kg(10), count: 1 }, { weightG: kg(5), count: 1 }] },
    });
  });

  it('needs plates in pairs', () => {
    const res = loadPlates(kg(10), kg(20), [{ weightG: kg(5), count: 3 }]);
    expect(res).toMatchObject({ exact: true, load: { perSide: [{ weightG: kg(5), count: 1 }] } });
    expect(loadPlates(kg(10), kg(30), [{ weightG: kg(5), count: 3 }])).toMatchObject({
      exact: false,
      below: { totalG: kg(20) },
      above: null,
    });
  });

  it('offers the nearest loads when the weight cannot be made', () => {
    expect(loadPlates(kg(10), kg(23), [{ weightG: kg(5), count: 4 }, { weightG: kg(2), count: 2 }])).toMatchObject({
      exact: false,
      below: { totalG: kg(20) },
      above: { totalG: kg(24) },
    });
    // 0.25 kg on each side is lighter than the smallest plate.
    expect(loadPlates(kg(10), kg(10.5), owned)).toMatchObject({ exact: false, below: { totalG: kg(10) }, above: { totalG: kg(11) } });
  });

  it('handles the bar alone and no plates', () => {
    expect(loadPlates(kg(20), kg(20), [])).toEqual({ exact: true, load: { totalG: kg(20), perSideG: 0, perSide: [] } });
    expect(loadPlates(kg(20), kg(30), [])).toMatchObject({ exact: false, below: { totalG: kg(20) }, above: null });
  });
});
