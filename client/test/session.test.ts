import { beforeEach, describe, expect, it } from 'vitest';
import { type LocalExercise, HalkoDb } from '../src/db/db.ts';
import {
  addExtraSet,
  removeLastSet,
  unlogSet,
  exerciseHistory,
  finishSession,
  getLive,
  liftedSets,
  logSet,
  previousPerformance,
  sessionLogs,
  startSession,
  updateLive,
} from '../src/db/sessions.ts';
import { createWorkout, deleteWorkout, liveItems } from '../src/db/workouts.ts';
import { addItem, toggleSupersetWithNext, updateItem } from './workout-helpers.ts';
import { metricsForType, recordFor } from '../src/lib/progress.ts';
import { type PlanItem, buildSteps, estimate1RM, increase, nextOpenStep, prefill, proposedValues, raised, restAfter, setCount } from '../src/lib/session.ts';

const plan = (items: Partial<PlanItem>[]): PlanItem[] =>
  items.map((p, k) => ({
    itemId: `i${k}`,
    exerciseId: `e${k}`,
    exerciseType: 'weight_reps',
    equipment: [],
    supersetGroup: null,
    targets: [{ kind: 'normal', reps: 8, restS: 90 }],
    note: null,
    ...p,
  }));

const sets = (n: number, restS = 90) => Array.from({ length: n }, () => ({ kind: 'normal' as const, reps: 8, restS }));

describe('steps', () => {
  it('runs plain exercises in order with their rest', () => {
    const p = plan([{ targets: sets(2, 120) }, { targets: sets(1) }]);
    const steps = buildSteps(p);
    expect(steps.map((s) => [s.item, s.set])).toEqual([[0, 0], [0, 1], [1, 0]]);
    expect(restAfter(p, steps, 0)).toBe(120);
    expect(restAfter(p, steps, 2)).toBe(0);
  });

  it('interleaves supersets and only rests after a full round', () => {
    const p = plan([
      { supersetGroup: 'A', targets: sets(3, 60) },
      { supersetGroup: 'A', targets: sets(2, 90) },
      { targets: sets(1) },
    ]);
    const steps = buildSteps(p);
    expect(steps.map((s) => [s.item, s.set])).toEqual([[0, 0], [1, 0], [0, 1], [1, 1], [0, 2], [2, 0]]);
    expect(restAfter(p, steps, 0)).toBe(0); // A1 -> B1
    expect(restAfter(p, steps, 1)).toBe(90); // B1 -> A2
    expect(restAfter(p, steps, 3)).toBe(90); // B2 -> A3 (A finishes alone)
  });

  it('adds extra sets and finds the next open one', () => {
    const p = plan([{ targets: sets(2) }]);
    const steps = buildSteps(p, { i0: 1 });
    expect(steps).toHaveLength(3);
    expect(nextOpenStep(p, steps, new Set(['i0:0', 'i0:2']), 0)).toBe(1);
    expect(nextOpenStep(p, steps, new Set(['i0:0', 'i0:1', 'i0:2']), 0)).toBe(-1);
  });

  it('prefills with the plan (last time unless changed since), last time for what it leaves to work out', () => {
    const target = { kind: 'normal' as const, reps: 8, weightG: 80000 };
    expect(prefill(target, undefined)).toMatchObject({ reps: 8, weightG: 80000 });
    expect(prefill(target, { reps: 7, weightG: 82500 })).toMatchObject({ reps: 8, weightG: 80000 });
    expect(prefill({ kind: 'warmup' }, { reps: 12, weightG: 20000 })).toMatchObject({ reps: 12, weightG: 20000 });
  });

  it("proposes last time's warm-ups, worked out again when they follow the working weight and it went up", () => {
    const targets = [{ kind: 'warmup' as const, restS: 60 }, { kind: 'warmup' as const, restS: 60 }, { kind: 'normal' as const, reps: 5, weightG: 100000, restS: 180 }];
    const p = plan([{ equipment: ['barbell'], targets }]);
    // Never done: worked out from the plan (100 kg).
    expect(proposedValues(p, 0, 1, undefined, undefined)).toMatchObject({ weightG: 85000, reps: 2 });
    // Last time: warm-ups at 20 and 60 kg, working set at 100 kg, as planned: last time's warm-ups.
    const previous = new Map([
      [0, { reps: 12, weightG: 20000 }],
      [1, { reps: 6, weightG: 60000 }],
      [2, { reps: 5, weightG: 100000 }],
    ]);
    expect(proposedValues(p, 0, 1, previous, undefined)).toMatchObject({ weightG: 60000, reps: 6 });
    // Load raised in the workout since (120 kg): worked out again from it.
    const raisedPlan = plan([{ equipment: ['barbell'], targets: [...targets.slice(0, 2), { ...targets[2]!, weightG: 120000 }] }]);
    expect(proposedValues(raisedPlan, 0, 2, previous, undefined)).toMatchObject({ weightG: 120000 });
    expect(proposedValues(raisedPlan, 0, 1, previous, undefined)).toMatchObject({ weightG: 102500, reps: 2 });
    // Or reached on an earlier set of the session (115 kg).
    expect(proposedValues(p, 0, 1, previous, { 'i0:2': { weightG: 115000 } })).toMatchObject({ weightG: 97500, reps: 2 });
    // A warm-up typed in the plan is not worked out, heavier or not.
    const typed = plan([{ equipment: ['barbell'], targets: [{ kind: 'warmup', reps: 8, weightG: 40000 }, ...targets.slice(2)] }]);
    expect(proposedValues(typed, 0, 0, new Map([[0, { reps: 12, weightG: 20000 }], [1, { reps: 5, weightG: 110000 }]]), { 'i0:1': { weightG: 115000 } })).toMatchObject({ weightG: 40000, reps: 8 });
  });

  it('estimates a 1RM', () => {
    expect(estimate1RM(100000, 1)).toBe(100000);
    expect(estimate1RM(80000, 8)).toBe(101333);
  });
});

describe('session flow', () => {
  let db: HalkoDb;
  let n = 0;
  const squat: LocalExercise = {
    id: 'squat',
    source: 'builtin',
    name: 'Squat',
    sport: 'strength',
    exerciseType: 'weight_reps',
    category: 'strength',
    level: null,
    equipment: [],
    primaryMuscles: ['quads'],
    secondaryMuscles: [],
    instructions: [],
    mediaIds: [],
    mediaUrls: [],
    sourceRef: null,
    unilateral: false,
    customized: false,
    createdAt: 0,
    deleted: 0,
    dirty: 0,
    updatedAt: 0,
  };
  const plank: LocalExercise = { ...squat, id: 'plank', name: 'Plank', exerciseType: 'duration' };

  beforeEach(async () => {
    db = new HalkoDb(`session-${n++}`);
    await db.exercises.bulkAdd([squat, plank]);
  });

  async function doSession(workoutId: string, weights: number[]) {
    await startSession(workoutId, db);
    for (const w of weights) {
      const live = (await getLive(db))!;
      await logSet(live, live.cursor, { reps: 8, weightG: w }, db);
    }
    return finishSession(db);
  }

  it('logs sets, rests, finishes and remembers the previous performance', async () => {
    const w = await createWorkout('Legs', db);
    await addItem(w, squat, db);
    const [item] = await liveItems(db, w);
    await updateItem(item!.id, { targets: sets(2, 120) }, db);

    const sessionId = await startSession(w, db);
    let live = (await getLive(db))!;
    expect(live.plan[0]!.targets).toHaveLength(2);
    await logSet(live, 0, { reps: 8, weightG: 80000 }, db);
    live = (await getLive(db))!;
    expect(live.cursor).toBe(1);
    expect(live.restTotalS).toBe(120);
    expect(live.restEndsAt).toBeGreaterThan(Date.now());

    // The added set comes last: the current set stays the next one to do.
    await addExtraSet(live, 0, db);
    live = (await getLive(db))!;
    expect(live.cursor).toBe(1);
    expect(setCount(live.plan, live.extra, 0)).toBe(3);

    await logSet(live, 1, { reps: 7, weightG: 82500 }, db);
    expect(await sessionLogs(sessionId, db)).toHaveLength(2);
    expect(await finishSession(db)).toBe(sessionId);
    expect(await getLive(db)).toBeNull();

    const prev = await previousPerformance('squat', 'another', db);
    expect(prev.get(1)).toMatchObject({ reps: 7, weightG: 82500 });
  });

  it('records the sets of an exercise done one side at a time as per side', async () => {
    await db.exercises.update('plank', { unilateral: true });
    const w = await createWorkout('Core', db);
    await addItem(w, (await db.exercises.get('plank'))!, db);
    await addItem(w, squat, db);
    const [side, both] = await liveItems(db, w);
    await updateItem(side!.id, { switchS: 8 }, db);
    expect(await db.workoutItems.get(side!.id)).toMatchObject({ switchS: 8, dirty: 1 });
    await startSession(w, db);
    const live = (await getLive(db))!;
    expect(live.plan.map((p) => [p.unilateral, p.switchS])).toEqual([[true, 8], [undefined, undefined]]);
    await logSet(live, 0, { durationS: 30 }, db);
    const steps = buildSteps(live.plan, live.extra);
    await logSet((await getLive(db))!, steps.findIndex((s) => s.item === 1), { reps: 5, weightG: 100000 }, db);
    const logs = await sessionLogs(live.sessionId, db);
    expect(logs.find((l) => l.workoutItemId === side!.id)).toMatchObject({ durationS: 30, unilateral: true });
    expect(logs.find((l) => l.workoutItemId === both!.id)).not.toHaveProperty('unilateral');
    await finishSession(db);

    // Without the pause to change sides, the workout does it as a plain set.
    await updateItem(side!.id, { bySide: false }, db);
    await startSession(w, db);
    const plain = (await getLive(db))!;
    expect(plain.plan[0]).not.toHaveProperty('unilateral');
    await logSet(plain, 0, { durationS: 45 }, db);
    expect((await sessionLogs(plain.sessionId, db))[0]).not.toHaveProperty('unilateral');
  });

  it('lists the loaded sets of finished sessions, for load-and-reps exercises only', async () => {
    const w = await createWorkout('Legs', db);
    await addItem(w, squat, db);
    await addItem(w, plank, db);
    await startSession(w, db);
    await logSet((await getLive(db))!, 0, { reps: 5, weightG: 100000 }, db);
    await logSet((await getLive(db))!, 1, { durationS: 60 }, db);
    expect(await liftedSets(db)).toEqual([]); // not finished yet
    await finishSession(db);
    await startSession(w, db);
    await logSet((await getLive(db))!, 0, { reps: 3, weightG: 110000 }, db);

    const lifted = await liftedSets(db);
    expect(lifted.map((l) => l.exercise.id)).toEqual(['squat']);
    expect(lifted[0]!.sets).toMatchObject([{ reps: 5, weightG: 100000 }]);
  });

  it('removes sets during a session, down to skipping an exercise, but never a done one or the whole session', async () => {
    const w = await createWorkout('Legs', db);
    await addItem(w, squat, db);
    await addItem(w, plank, db);
    const [sq, pl] = await liveItems(db, w);
    await updateItem(sq!.id, { targets: sets(2) }, db);
    await updateItem(pl!.id, { targets: [{ kind: 'normal', durationS: 30, restS: 60 }] }, db);
    await startSession(w, db);
    const count = async (item: number) => setCount((await getLive(db))!.plan, (await getLive(db))!.extra, item);

    // The last set left is done: it stays.
    await logSet((await getLive(db))!, 0, { reps: 8, weightG: 80000 }, db);
    await removeLastSet((await getLive(db))!, 0, db);
    expect(await count(0)).toBe(1);
    await removeLastSet((await getLive(db))!, 0, db);
    expect(await count(0)).toBe(1);

    // The plank's only set can go: it is skipped. Then the squat's set is the only one left in the session.
    await removeLastSet((await getLive(db))!, 1, db);
    expect(await count(1)).toBe(0);
    expect((await getLive(db))!.cursor).toBe(0);
  });

  it('updates the workout plan with the values done', async () => {
    const w = await createWorkout('Legs', db);
    await addItem(w, squat, db);
    await addItem(w, plank, db);
    const [simple, perSet] = await liveItems(db, w);
    await updateItem(simple!.id, { mode: 'simple', targets: sets(3).map((t) => ({ ...t, weightG: 80000 })) }, db);
    await updateItem(perSet!.id, { mode: 'per_set', targets: [30, 30].map((d) => ({ kind: 'normal' as const, durationS: d, restS: 60 })) }, db);

    await startSession(w, db);
    let live = (await getLive(db))!;
    await logSet(live, 0, { reps: 10, weightG: 82500 }, db);
    live = (await getLive(db))!;
    await logSet(live, 1, { reps: 9, weightG: 85000 }, db);
    live = (await getLive(db))!;
    await logSet(live, 3, { durationS: 45 }, db);
    await finishSession(db);

    const [a, b] = await liveItems(db, w);
    // Identical sets done differently: each set keeps what was done, the set not done keeps its plan.
    expect(a!.mode).toBe('per_set');
    expect(a!.targets.map((t) => [t.weightG, t.reps, t.restS])).toEqual([
      [82500, 10, 90],
      [85000, 9, 90],
      [80000, 8, 90],
    ]);
    // Per set: only the sets done change.
    expect(b!.targets.map((t) => t.durationS)).toEqual([45, 30]);
    expect(b!.dirty).toBe(1);
  });

  it('keeps identical sets identical when they were all done the same way', async () => {
    const w = await createWorkout('Legs', db);
    await addItem(w, squat, db);
    const [item] = await liveItems(db, w);
    await updateItem(item!.id, { mode: 'simple', targets: sets(3).map((t) => ({ ...t, weightG: 80000 })) }, db);
    await doSession(w, [85000, 85000]);
    const [after] = await liveItems(db, w);
    expect(after!.mode).toBe('simple');
    expect(after!.targets).toEqual(Array.from({ length: 3 }, () => ({ kind: 'normal', reps: 8, weightG: 85000, restS: 90 })));
  });

  it('updates every workout planning the same exercise', async () => {
    const legs = await createWorkout('Legs', db);
    await addItem(legs, squat, db);
    const full = await createWorkout('Full body', db);
    await addItem(full, squat, db);
    const old = await createWorkout('Old', db);
    await addItem(old, squat, db);
    await deleteWorkout(old, db);
    const [legsSquat] = await liveItems(db, legs);
    const [fullSquat] = await liveItems(db, full);
    await updateItem(legsSquat!.id, { mode: 'per_set', targets: sets(2) }, db);
    // Same exercise with a warm-up first: matched by working set, the warm-up is left alone.
    const warmup = { kind: 'warmup' as const, reps: 12, weightG: 40000, restS: 60 };
    await updateItem(fullSquat!.id, { mode: 'per_set', targets: [warmup, ...sets(3)] }, db);

    await startSession(legs, db);
    let live = (await getLive(db))!;
    await logSet(live, 0, { reps: 6, weightG: 100000 }, db);
    live = (await getLive(db))!;
    await logSet(live, 1, { reps: 5, weightG: 102500 }, db);
    await finishSession(db);

    expect((await liveItems(db, full))[0]!.targets.map((t) => [t.kind, t.reps, t.weightG])).toEqual([
      ['warmup', 12, 40000],
      ['normal', 6, 100000],
      ['normal', 5, 102500],
      ['normal', 8, undefined],
    ]);
    const [oldSquat] = await db.workoutItems.where('workoutId').equals(old).toArray();
    expect(oldSquat!.targets[0]!.weightG).not.toBe(100000);
  });

  it('starts an exercise added again from what is known of it', async () => {
    // Never done, in no workout: the defaults of its type.
    const fresh = await createWorkout('New', db);
    await addItem(fresh, plank, db);
    expect((await liveItems(db, fresh))[0]!.targets).toEqual(Array.from({ length: 3 }, () => ({ kind: 'normal', durationS: 30, restS: 60 })));

    // Done once, then its workout deleted: the sets done last time.
    const legs = await createWorkout('Legs', db);
    await addItem(legs, squat, db);
    await doSession(legs, [70000, 72500]);
    await deleteWorkout(legs, db);
    const again = await createWorkout('Again', db);
    await addItem(again, squat, db);
    const [first] = await liveItems(db, again);
    expect(first!.mode).toBe('per_set');
    expect(first!.targets.map((t) => [t.reps, t.weightG])).toEqual([[8, 70000], [8, 72500]]);

    // Planned in another workout: that plan (sets, rests), which already has the values done.
    await updateItem(first!.id, { targets: first!.targets.map((t) => ({ ...t, restS: 150 })) }, db);
    const other = await createWorkout('Other', db);
    await addItem(other, squat, db);
    expect((await liveItems(db, other))[0]!.targets).toEqual(first!.targets.map((t) => ({ ...t, restS: 150 })));
  });

  it('carries an increase to the following sets of the exercise', async () => {
    const w = await createWorkout('Legs', db);
    await addItem(w, squat, db);
    const [item] = await liveItems(db, w);
    await updateItem(item!.id, { targets: sets(3).map((t) => ({ ...t, weightG: 80000 })) }, db);
    await startSession(w, db);
    const offered = { reps: 8, weightG: 80000 };

    let live = (await getLive(db))!;
    await logSet(live, 0, { reps: 8, weightG: 82500 }, db, offered);
    live = (await getLive(db))!;
    expect(live.bumps).toEqual({ [`${item!.id}:1`]: { weightG: 82500 }, [`${item!.id}:2`]: { weightG: 82500 } });

    // Offered 82.5 kg x 8, done 85 kg x 9: the last set must reach both.
    await logSet(live, 1, { reps: 9, weightG: 85000 }, db, raised(offered, live.bumps![`${item!.id}:1`]));
    live = (await getLive(db))!;
    expect(live.bumps![`${item!.id}:2`]).toEqual({ weightG: 85000, reps: 9 });

    // The next sets take the value reached, not the difference; one planned higher stays higher.
    expect(raised({ reps: 10 }, increase({ reps: 15 }, { reps: 11 }))).toEqual({ reps: 15 });
    expect(raised({ weightG: 210000 }, increase({ weightG: 90000 }, { weightG: 85000 }))).toEqual({ weightG: 210000 });

    // A decrease is not carried.
    expect(increase({ reps: 6, weightG: 80000 }, offered)).toEqual({});
  });

  it('undoes a set validated by mistake: it is the set to do again', async () => {
    const w = await createWorkout('Legs', db);
    await addItem(w, squat, db);
    const [item] = await liveItems(db, w);
    await updateItem(item!.id, { targets: sets(3).map((t) => ({ ...t, weightG: 80000 })) }, db);
    const sessionId = await startSession(w, db);
    await logSet((await getLive(db))!, 0, { reps: 8, weightG: 80000 }, db);
    await logSet((await getLive(db))!, 1, { reps: 8, weightG: 80000 }, db);
    expect((await getLive(db))!.cursor).toBe(2);

    await unlogSet((await getLive(db))!, 0, 1, db);
    expect((await sessionLogs(sessionId, db)).map((l) => l.setIndex)).toEqual([0]);
    expect((await getLive(db))!.cursor).toBe(1);

    // The increase it carried to the next set is taken back.
    const offered = { reps: 8, weightG: 80000 };
    await logSet((await getLive(db))!, 1, { reps: 8, weightG: 85000 }, db, offered);
    expect((await getLive(db))!.bumps).toEqual({ [`${item!.id}:2`]: { weightG: 85000 } });
    await unlogSet((await getLive(db))!, 0, 1, db);
    expect((await getLive(db))!.bumps).toEqual({});
  });

  it('corrects a set done without restarting the rest', async () => {
    const w = await createWorkout('Legs', db);
    await addItem(w, squat, db);
    await startSession(w, db);
    let live = (await getLive(db))!;
    await logSet(live, 0, { reps: 8, weightG: 80000 }, db);
    live = (await getLive(db))!;
    await updateLive({ restEndsAt: null }, db);
    // Back on set 1 to correct it: no new rest, and the cursor returns to the next set to do.
    await updateLive({ cursor: 0 }, db);
    await logSet((await getLive(db))!, 0, { reps: 9, weightG: 80000 }, db);
    live = (await getLive(db))!;
    expect(live.restEndsAt).toBeNull();
    expect(live.cursor).toBe(1);
  });

  it('discards a session without any set', async () => {
    const w = await createWorkout('Empty', db);
    await addItem(w, squat, db);
    const id = await startSession(w, db);
    expect(await finishSession(db)).toBeNull();
    expect((await db.sessions.get(id))!.deleted).toBe(1);
  });

  it('runs a superset without rest inside a round', async () => {
    const w = await createWorkout('SS', db);
    await addItem(w, squat, db);
    await addItem(w, plank, db);
    await toggleSupersetWithNext((await liveItems(db, w))[0]!, db);
    await startSession(w, db);
    const live = (await getLive(db))!;
    await logSet(live, 0, { reps: 8, weightG: 60000 }, db);
    const after = (await getLive(db))!;
    expect(after.cursor).toBe(1);
    expect(after.restEndsAt).toBeNull();
  });

  it('detects records against earlier sessions', async () => {
    const w = await createWorkout('Legs', db);
    await addItem(w, squat, db);
    await doSession(w, [60000, 70000, 70000]);
    await doSession(w, [60000, 75000, 70000]);
    const history = await exerciseHistory('squat', db);
    expect(history).toHaveLength(2);
    const [maxWeight] = metricsForType('weight_reps');
    expect(recordFor(maxWeight!, [history[0]!.sets], history[1]!.sets)).toEqual({ value: 75000, previous: 70000 });
    expect(recordFor(maxWeight!, [], history[0]!.sets)).toBeNull();
  });

  it('measures the session volume, the best set volume and the total reps', () => {
    const sets = [
      { kind: 'warmup', reps: 10, weightG: 40000 },
      { kind: 'normal', reps: 8, weightG: 80000 },
      { kind: 'normal', reps: 6, weightG: 85000 },
    ];
    const best = (id: string) => metricsForType('weight_reps').find((m) => m.id === id)!.best(sets);
    expect(best('volume')).toBe(8 * 80000 + 6 * 85000);
    expect(best('set-volume')).toBe(8 * 80000);
    expect(best('total-reps')).toBe(14);
  });
});
