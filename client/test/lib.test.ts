import { beforeEach, describe, expect, it } from 'vitest';
import { contrastRatio, onColor } from '../src/lib/color.ts';
import { newId } from '../src/lib/id.ts';
import { prefs } from '../src/lib/i18n.ts';
import { LB_G, distanceText, formatDuration, formatSetValues, formatWeight, niceWeight, parseDist, parseDuration, parseWeight, weightText } from '../src/lib/format.ts';
import { loadPlatesIn } from '../src/lib/plates.ts';
import { setVolumeG } from '../src/lib/session.ts';
import { countdownTotalS, timerView } from '../src/lib/timer.ts';
import { regionState, worksAsPicked } from '../src/lib/muscles.ts';
import { addSet, defaultTargets, doneSets, rankKey, removeSet, setSimpleCount, toKind, toSimple, updateAll, updateFrom, warmupPlan, withDone, withWarmups } from '../src/lib/targets.ts';

describe('color', () => {
  it('picks readable text on the accent colour', () => {
    expect(onColor('#D4FF3A')).toBe('#0E1012');
    expect(onColor('#1D3A8A')).toBe('#FFFFFF');
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21);
  });
});

describe('newId', () => {
  it('makes a UUID v4 even without crypto.randomUUID (plain HTTP)', () => {
    const native = crypto.randomUUID;
    Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true });
    try {
      const ids = new Set(Array.from({ length: 100 }, newId));
      expect(ids.size).toBe(100);
      for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    } finally {
      Object.defineProperty(crypto, 'randomUUID', { value: native, configurable: true });
    }
  });
});

describe('format', () => {
  beforeEach(() => prefs.set({ locale: 'fr', weight: 'kg', distance: 'km' }));

  it('writes decimals the way of the chosen language', () => {
    prefs.set({ locale: 'en' });
    expect(formatWeight(82500)).toBe('82.5');
    expect(parseWeight('82.5')).toBe(82500);
  });

  it('round-trips kilograms with French decimals', () => {
    expect(formatWeight(82500)).toBe('82,5');
    expect(formatWeight(80000)).toBe('80');
    expect(parseWeight('82,5')).toBe(82500);
    expect(parseWeight('12.25')).toBe(12250);
    expect(parseWeight('')).toBeNull();
    expect(parseWeight('-3')).toBeNull();
    expect(parseDist('5,2')).toBe(5200);
  });

  it('formats a performed set per exercise type', () => {
    expect(formatSetValues('weight_reps', { reps: 8, weightG: 80000 })).toBe('80 kg × 8');
    expect(formatSetValues('weighted_bw', { reps: 6, weightG: 10000 })).toBe('+10 kg × 6');
    expect(formatSetValues('assisted_bw', { reps: 6, weightG: 20000 })).toBe('−20 kg × 6');
    expect(formatSetValues('bw_reps', { reps: 12 })).toBe('12 reps');
    expect(formatSetValues('duration', { durationS: 60 })).toBe('1:00');
    expect(formatSetValues('distance_duration', { durationS: 1500, distanceM: 5200 })).toBe('5,2 km · 25:00');
    expect(formatSetValues('weight_distance', { weightG: 24000, distanceM: 40 })).toBe('24 kg · 40 m');
    expect(formatSetValues('duration', { durationS: 30, unilateral: true })).toBe('0:30 par côté');
    expect(formatSetValues('weight_reps', { reps: 10, weightG: 20000, unilateral: true })).toBe('20 kg × 10 par côté');
  });

  it('shows and reads pounds and miles when chosen', () => {
    prefs.set({ locale: 'en', weight: 'lb', distance: 'mi' });
    expect(formatWeight(parseWeight('45')!)).toBe('45');
    expect(weightText(parseWeight('2.5')!)).toBe('2.5 lb');
    expect(niceWeight(20000)).toBe(Math.round(45 * LB_G));
    expect(parseDist('1')).toBe(1609);
    expect(distanceText(40)).toBe('44 yd');
    expect(distanceText(8047)).toBe('5 mi');
    expect(formatSetValues('weight_reps', { reps: 5, weightG: parseWeight('225')! })).toBe('225 lb × 5');
  });

  it('loads plates in pounds exactly', () => {
    prefs.set({ locale: 'en', weight: 'lb', distance: 'mi' });
    const lb = (n: number) => parseWeight(String(n))!;
    const plates = [45, 25, 10, 5, 2.5].map((w) => ({ weightG: lb(w), count: 4 }));
    const result = loadPlatesIn('lb', lb(45), lb(225), plates);
    expect(result.exact).toBe(true);
    if (!result.exact) return;
    expect(result.load.perSide.map((p) => [formatWeight(p.weightG), p.count])).toEqual([['45', 2]]);
    expect(formatWeight(result.load.totalG)).toBe('225');
    expect(loadPlatesIn('lb', lb(45), lb(140), plates).exact).toBe(true);
  });

  it('parses and formats durations', () => {
    expect(formatDuration(75)).toBe('1:15');
    expect(formatDuration(3725)).toBe('1:02:05');
    expect(parseDuration('25')).toBe(25);
    expect(parseDuration('90')).toBe(90);
    expect(parseDuration('1:30')).toBe(90);
    // Timer keypad style: the last two digits are seconds.
    expect(parseDuration('130')).toBe(90);
    expect(parseDuration('200')).toBe(120);
    expect(parseDuration('1000')).toBe(600);
    expect(parseDuration('13000')).toBe(5400);
    expect(formatDuration(parseDuration('130')!)).toBe('1:30');
    expect(parseDuration('1:02:05')).toBe(3725);
    expect(parseDuration('1:x')).toBeNull();
  });
});

describe('warm-ups', () => {
  beforeEach(() => prefs.set({ locale: 'fr', weight: 'kg', distance: 'km' }));
  const kg = (plan: { weightG: number; reps: number }[]) => plan.map((w) => `${w.weightG / 1000}×${w.reps}`).join(' · ');
  const warmup = { kind: 'warmup' as const, restS: 60 };
  const work = { kind: 'normal' as const, reps: 5, weightG: 100000, restS: 180 };
  const squat = { exerciseType: 'weight_reps' as const, equipment: ['barbell'] };

  it('ramps from the empty bar, or 40 %, to 85 % of the working weight, reps going down', () => {
    expect(kg(warmupPlan(2, 100000, 20000))).toBe('20×10 · 85×2');
    expect(kg(warmupPlan(3, 100000, 20000))).toBe('20×10 · 52.5×5 · 85×2');
    expect(kg(warmupPlan(4, 100000, 20000))).toBe('20×10 · 42.5×5 · 62.5×3 · 85×2');
    expect(kg(warmupPlan(1, 100000, 20000))).toBe('60×5');
    // Dumbbells: to the kilo.
    expect(kg(warmupPlan(3, 30000, null))).toBe('12×10 · 19×3 · 26×2');
    // Never lighter than the bar, nor heavier than the working weight.
    expect(kg(warmupPlan(2, 25000, 20000))).toBe('20×10 · 22.5×2');
    expect(kg(warmupPlan(2, 15000, 20000))).toBe('15×10 · 15×2');
    prefs.set({ ...prefs.get(), weight: 'lb' });
    const lb = (n: number) => Math.round(n * 453.59237);
    expect(warmupPlan(3, lb(225), lb(45)).map((w) => [Math.round(w.weightG / 453.59237), w.reps])).toEqual([[45, 10], [120, 5], [190, 2]]);
  });

  it('works out the warm-ups left to work out, keeps those typed in', () => {
    const shown = withWarmups([warmup, { ...warmup, weightG: 30000 }, warmup, work], squat);
    expect(shown.map((s) => [s.weightG, s.reps])).toEqual([[20000, 10], [30000, 5], [85000, 2], [100000, 5]]);
    // Reps follow a weight typed in: 70 % calls for 3.
    expect(withWarmups([warmup, { ...warmup, weightG: 70000 }, work], squat)[1]!.reps).toBe(3);
    // Not for body weight exercises, nor without a loaded working set.
    expect(withWarmups([warmup, { kind: 'normal', reps: 10 }], { exerciseType: 'bw_reps', equipment: [] })[0]).toEqual(warmup);
    expect(withWarmups([warmup, { kind: 'normal', reps: 5 }], squat)[0]).toEqual(warmup);
  });

  it('makes a set a warm-up worked out, and back a working set with what it showed', () => {
    const targets = [{ ...work }, work];
    const asWarmup = toKind(targets, targets, 0, 'warmup', 'weight_reps');
    expect(asWarmup[0]).toEqual({ kind: 'warmup', restS: 180 });
    const back = toKind(asWarmup, withWarmups(asWarmup, squat), 0, 'normal', 'weight_reps');
    expect(back[0]).toMatchObject({ kind: 'normal', weightG: 60000, reps: 5 });
  });

  it('keeps warm-ups worked out after a session', () => {
    const targets = [warmup, { ...warmup, weightG: 30000, reps: 8 }, work];
    const done = doneSets([
      { key: rankKey(targets, 0), set: { kind: 'warmup', reps: 10, weightG: 20000 } },
      { key: rankKey(targets, 1), set: { kind: 'warmup', reps: 6, weightG: 35000 } },
      { key: rankKey(targets, 2), set: { kind: 'normal', reps: 5, weightG: 105000 } },
    ]);
    expect(withDone(targets, 'per_set', done).targets).toEqual([warmup, { ...warmup, weightG: 35000, reps: 6 }, { ...work, weightG: 105000 }]);
  });
});

describe('editing sets', () => {
  it('carries a value raised to the next sets below it, as in a session', () => {
    const sets = [
      { kind: 'warmup' as const },
      { kind: 'normal' as const, reps: 8, weightG: 100000 },
      { kind: 'normal' as const, reps: 8, weightG: 100000 },
      { kind: 'normal' as const, reps: 6, weightG: 120000 },
    ];
    const raised = updateFrom(sets, 1, 'weightG', 110000, 100000);
    expect(raised.map((s) => s.weightG)).toEqual([undefined, 110000, 110000, 120000]);
    expect(updateFrom(sets, 1, 'reps', 10, 8).map((s) => s.reps)).toEqual([undefined, 10, 10, 10]);
    // A decrease stays on its set; earlier sets and warm-ups left to work out do not move.
    expect(updateFrom(sets, 2, 'weightG', 90000, 100000).map((s) => s.weightG)).toEqual([undefined, 100000, 90000, 120000]);
    expect(updateFrom(sets, 0, 'weightG', 110000, 60000).map((s) => s.weightG)).toEqual([110000, 110000, 110000, 120000]);
  });
});

describe('targets', () => {
  it('uses the right fields per exercise type', () => {
    expect(defaultTargets('duration')[0]).toMatchObject({ durationS: 30 });
    expect(defaultTargets('duration')[0]!.reps).toBeUndefined();
    expect(defaultTargets('distance_duration')).toHaveLength(1);
  });

  it('switches from per-set to simple using the first working set', () => {
    const perSet = [
      { kind: 'warmup' as const, reps: 12, weightG: 50000 },
      { kind: 'normal' as const, reps: 8, weightG: 80000 },
      { kind: 'normal' as const, reps: 6, weightG: 85000 },
    ];
    expect(toSimple(perSet)).toEqual([
      { kind: 'normal', reps: 8, weightG: 80000 },
      { kind: 'normal', reps: 8, weightG: 80000 },
    ]);
  });

  it('edits simple mode as a whole', () => {
    const t = defaultTargets('weight_reps');
    expect(setSimpleCount(t, 5)).toHaveLength(5);
    expect(updateAll(t, { reps: 6 }).every((s) => s.reps === 6)).toBe(true);
    expect(addSet(t, 'weight_reps')).toHaveLength(4);
    expect(removeSet([t[0]!], 0)).toHaveLength(1);
  });
});

describe('body map regions', () => {
  it('groups lats and middle back on the upper back', () => {
    expect(regionState('upper-back', ['lats'], [])).toBe('primary');
    expect(regionState('upper-back', ['quads'], ['middleback'])).toBe('secondary');
    expect(regionState('chest', ['quads'], [])).toBe('idle');
    expect(regionState('head', ['quads'], [])).toBe('body');
  });

  it('finds exercises working the muscles picked, in their roles, area by area', () => {
    // Picked on the map: the glutes area also stands for the abductors.
    const picked = { primary: ['quads' as const], secondary: ['glutes', 'abductors', 'hamstrings'] as const };
    expect(worksAsPicked(picked, { primary: ['quads'], secondary: ['glutes', 'hamstrings'] })).toBe(true);
    // Other muscles too: still found.
    expect(worksAsPicked(picked, { primary: ['quads', 'chest'], secondary: ['calves', 'glutes', 'hamstrings', 'lowerback'] })).toBe(true);
    // A picked muscle missing, or in the other role: not found.
    expect(worksAsPicked(picked, { primary: ['quads'], secondary: ['glutes'] })).toBe(false);
    expect(worksAsPicked(picked, { primary: ['quads', 'glutes'], secondary: ['hamstrings'] })).toBe(false);
    // Lats and middle back are one area; a main muscle also listed as secondary is a main one.
    expect(worksAsPicked({ primary: ['lats', 'middleback'], secondary: [] }, { primary: ['lats'], secondary: ['middleback'] })).toBe(true);
    expect(worksAsPicked({ primary: [], secondary: ['lats'] }, { primary: ['lats'], secondary: ['middleback'] })).toBe(false);
  });
});


describe('set timer', () => {
  it('counts down one duration', () => {
    expect(timerView(0, 30, null)).toEqual({ phase: 'single', shownS: 30, progress: 0, valueS: 0 });
    expect(timerView(12_400, 30, null)).toMatchObject({ phase: 'single', shownS: 18, valueS: 12 });
    expect(countdownTotalS(30, null)).toBe(30);
  });

  it('counts down side 1, the time to change sides, then side 2', () => {
    expect(countdownTotalS(30, 5)).toBe(65);
    expect(timerView(10_000, 30, 5)).toMatchObject({ phase: 'side1', shownS: 20, valueS: 10 });
    expect(timerView(31_000, 30, 5)).toMatchObject({ phase: 'switch', shownS: 4, valueS: 30 });
    expect(timerView(35_000, 30, 5)).toMatchObject({ phase: 'side2', shownS: 30, valueS: 0 });
    expect(timerView(47_000, 30, 5)).toMatchObject({ phase: 'side2', shownS: 18, valueS: 12 });
    expect(timerView(65_000, 30, 5)).toEqual({ phase: 'done', shownS: 0, progress: 1, valueS: 30 });
    // No time to change sides: side 2 straight after side 1.
    expect(timerView(30_000, 30, 0)).toMatchObject({ phase: 'side2', shownS: 30 });
  });

  it('as a stopwatch, ends side 1 when told and records the shorter side', () => {
    expect(timerView(40_000, undefined, 5)).toMatchObject({ phase: 'side1', shownS: 40, valueS: 40 });
    expect(timerView(42_000, undefined, 5, 40_000)).toMatchObject({ phase: 'switch', shownS: 3, valueS: 40 });
    expect(timerView(65_000, undefined, 5, 40_000)).toMatchObject({ phase: 'side2', shownS: 20, valueS: 20 });
    expect(timerView(95_000, undefined, 5, 40_000)).toMatchObject({ phase: 'side2', shownS: 50, valueS: 40 });
  });
});

describe('volume', () => {
  it('counts both sides of a set done one side at a time', () => {
    expect(setVolumeG('weight_reps', { reps: 10, weightG: 20000 })).toBe(200000);
    expect(setVolumeG('weight_reps', { reps: 10, weightG: 20000, unilateral: true })).toBe(400000);
  });
});
