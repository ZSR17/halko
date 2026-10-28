import {
  type PlanItem,
  type SetValues,
  type Step,
  buildSteps,
  doneBySide,
  increase,
  lowered,
  nextOpenStep,
  proposedValues,
  raised,
  restAfter,
  setCount,
  stepKey,
} from '../lib/session.ts';
import { currentLocale } from '../lib/i18n.ts';
import { type DoneSets, doneSets, rankKey, withDone } from '../lib/targets.ts';
import { type LocalExercise, type LocalSession, type LocalSetLog, type HalkoDb, db as defaultDb } from './db.ts';
import { liveItems } from './workouts.ts';
import { newId } from '../lib/id.ts';

// State of the session being performed. Device-local (never synced): only the session row and its
// set logs are shared. Timers are stored as timestamps so they survive the app being suspended.
export interface LiveState {
  sessionId: string;
  workoutId: string | null;
  plan: PlanItem[];
  extra: Record<string, number>;
  cursor: number;
  restEndsAt: number | null;
  restTotalS: number;
  // Values reached above the plan on a set, that the following sets of the same exercise must reach, by stepKey.
  bumps?: Record<string, SetValues>;
}

const LIVE = 'live';
const touched = () => ({ updatedAt: Date.now(), dirty: 1 as const });

export async function getLive(db: HalkoDb = defaultDb): Promise<LiveState | null> {
  return ((await db.meta.get(LIVE))?.value as LiveState | undefined) ?? null;
}

async function saveLive(db: HalkoDb, live: LiveState) {
  await db.meta.put({ key: LIVE, value: live });
}

export async function updateLive(patch: Partial<LiveState>, db: HalkoDb = defaultDb) {
  const live = await getLive(db);
  if (live) await saveLive(db, { ...live, ...patch });
}

export async function startSession(workoutId: string, db: HalkoDb = defaultDb): Promise<string> {
  const existing = await getLive(db);
  if (existing) return existing.sessionId;
  const workout = await db.workouts.get(workoutId);
  if (!workout) throw new Error('workout not found');
  const items = await liveItems(db, workoutId);
  const exercises = await db.exercises.bulkGet(items.map((i) => i.exerciseId));
  const plan: PlanItem[] = items.map((i, k) => ({
    itemId: i.id,
    exerciseId: i.exerciseId,
    exerciseType: exercises[k]?.exerciseType ?? 'weight_reps',
    equipment: exercises[k]?.equipment ?? [],
    supersetGroup: i.supersetGroup,
    targets: i.targets,
    ...(doneBySide(exercises[k], i) && { unilateral: true, switchS: i.switchS ?? null }),
    note: i.note,
  }));
  const sessionId = newId();
  const t = Date.now();
  await db.transaction('rw', db.sessions, db.meta, async () => {
    await db.sessions.add({
      id: sessionId,
      workoutId,
      sport: workout.sport,
      name: workout.name,
      startedAt: t,
      endedAt: null,
      note: null,
      createdAt: t,
      updatedAt: t,
      deleted: 0,
      dirty: 1,
    });
    await saveLive(db, { sessionId, workoutId, plan, extra: {}, cursor: 0, restEndsAt: null, restTotalS: 0 });
  });
  return sessionId;
}

export async function sessionLogs(sessionId: string, db: HalkoDb = defaultDb): Promise<LocalSetLog[]> {
  const logs = await db.setLogs.where('sessionId').equals(sessionId).toArray();
  return logs.filter((l) => !l.deleted).sort((a, b) => a.completedAt - b.completedAt);
}

export function doneKeys(logs: LocalSetLog[]): Set<string> {
  return new Set(logs.map((l) => `${l.workoutItemId}:${l.setIndex}`));
}

// Records a performed set, then moves to the next open set and starts the rest timer (not when a set
// already done is corrected: the rest going on, if any, carries on). `startedFrom`:
// the values the set was offered with; what was added to them is added to the following sets too.
export async function logSet(
  live: LiveState,
  stepIndex: number,
  values: SetValues,
  db: HalkoDb = defaultDb,
  startedFrom?: SetValues,
) {
  const steps = buildSteps(live.plan, live.extra);
  const step = steps[stepIndex];
  if (!step) return;
  const item = live.plan[step.item]!;
  const t = Date.now();
  await db.transaction('rw', db.setLogs, db.meta, async () => {
    const already = (await sessionLogs(live.sessionId, db)).find(
      (l) => l.workoutItemId === item.itemId && l.setIndex === step.set,
    );
    const row: LocalSetLog = {
      id: already?.id ?? newId(),
      sessionId: live.sessionId,
      exerciseId: item.exerciseId,
      workoutItemId: item.itemId,
      position: step.item,
      setIndex: step.set,
      kind: step.target.kind,
      ...values,
      ...(item.unilateral && { unilateral: true }),
      completedAt: t,
      createdAt: already?.createdAt ?? t,
      updatedAt: t,
      deleted: 0,
      dirty: 1,
    };
    await db.setLogs.put(row);
    const done = doneKeys(await sessionLogs(live.sessionId, db));
    const rest = restAfter(live.plan, steps, stepIndex);
    const next = nextOpenStep(live.plan, steps, done, stepIndex);
    const bumps = { ...live.bumps };
    const added = startedFrom ? increase(values, startedFrom) : {};
    if (Object.keys(added).length) {
      for (let set = step.set + 1; set < setCount(live.plan, live.extra, step.item); set++) {
        const key = `${item.itemId}:${set}`;
        bumps[key] = raised(bumps[key] ?? {}, added);
      }
    }
    await saveLive(db, {
      ...live,
      bumps,
      cursor: next === -1 ? stepIndex : next,
      ...(already ? {} : { restEndsAt: rest > 0 && next !== -1 ? t + rest * 1000 : null, restTotalS: rest }),
    });
  });
}


// The set to do: the first one not done yet, in the order of the session (the last one when all are done).
// The current set is always this one: it cannot be chosen.
function firstOpen(plan: PlanItem[], steps: Step[], done: Set<string>): number {
  const open = steps.findIndex((s) => !done.has(stepKey(plan, s)));
  return open === -1 ? steps.length - 1 : open;
}

export async function addExtraSet(live: LiveState, item: number, db: HalkoDb = defaultDb) {
  const itemId = live.plan[item]!.itemId;
  const extra = { ...live.extra, [itemId]: (live.extra[itemId] ?? 0) + 1 };
  const done = doneKeys(await sessionLogs(live.sessionId, db));
  await saveLive(db, { ...live, extra, cursor: firstOpen(live.plan, buildSteps(live.plan, extra), done) });
}

// Drops the last set of an exercise for this session (`extra` then goes below 0), unless it is done.
// Down to no set at all, the exercise is skipped; the session itself always keeps one set.
export async function removeLastSet(live: LiveState, item: number, db: HalkoDb = defaultDb) {
  const itemId = live.plan[item]!.itemId;
  const last = setCount(live.plan, live.extra, item) - 1;
  const done = doneKeys(await sessionLogs(live.sessionId, db));
  if (last < 0 || done.has(`${itemId}:${last}`)) return;
  const extra = { ...live.extra, [itemId]: (live.extra[itemId] ?? 0) - 1 };
  const steps = buildSteps(live.plan, extra);
  if (!steps.length) return;
  await saveLive(db, { ...live, extra, cursor: firstOpen(live.plan, steps, done) });
}

// Undoes a set validated by mistake: its log is removed and it is the set to do again. The increase it
// carried to the next sets is taken back (it comes back if the set is validated again).
export async function unlogSet(live: LiveState, item: number, set: number, db: HalkoDb = defaultDb) {
  const { itemId, exerciseId } = live.plan[item]!;
  const previous = await previousPerformance(exerciseId, live.sessionId, db);
  await db.transaction('rw', db.setLogs, db.meta, async () => {
    const log = (await sessionLogs(live.sessionId, db)).find((l) => l.workoutItemId === itemId && l.setIndex === set);
    if (!log) return;
    await db.setLogs.update(log.id, { deleted: 1, updatedAt: Date.now(), dirty: 1 });
    const startedFrom = proposedValues(live.plan, item, set, previous, live.bumps);
    const added = increase(log, startedFrom);
    const bumps = { ...live.bumps };
    for (let next = set + 1; next < setCount(live.plan, live.extra, item); next++) {
      const key = `${itemId}:${next}`;
      const left = lowered(bumps[key], added);
      if (left) bumps[key] = left;
      else delete bumps[key];
    }
    const done = doneKeys(await sessionLogs(live.sessionId, db));
    await saveLive(db, { ...live, bumps, cursor: firstOpen(live.plan, buildSteps(live.plan, live.extra), done) });
  });
}

export async function finishSession(db: HalkoDb = defaultDb): Promise<string | null> {
  const live = await getLive(db);
  if (!live) return null;
  const logs = await sessionLogs(live.sessionId, db);
  if (logs.length === 0) {
    await discardSession(db);
    return null;
  }
  await db.transaction('rw', db.sessions, db.workouts, db.workoutItems, db.meta, async () => {
    await db.sessions.update(live.sessionId, { endedAt: Date.now(), ...touched() });
    await updatePlans(db, live.plan, logs);
    await db.meta.delete(LIVE);
  });
  return live.sessionId;
}

// Every workout using an exercise just done takes the values done, so editing any of them shows them.
// An exercise planned twice in the session: its own item uses its own sets, other workouts the first
// occurrence.
async function updatePlans(db: HalkoDb, plan: PlanItem[], logs: LocalSetLog[]) {
  const done = new Map<string, DoneSets>();
  for (const p of plan) {
    const own = logs
      .filter((l) => l.workoutItemId === p.itemId && l.setIndex < p.targets.length)
      .sort((a, b) => a.setIndex - b.setIndex);
    if (own.length) done.set(p.itemId, doneSets(own.map((l) => ({ key: rankKey(p.targets, l.setIndex), set: l }))));
  }
  const byExercise = new Map<string, string>();
  for (const p of plan) if (done.has(p.itemId) && !byExercise.has(p.exerciseId)) byExercise.set(p.exerciseId, p.itemId);

  const items = await db.workoutItems.where('exerciseId').anyOf([...byExercise.keys()]).toArray();
  for (const item of items) {
    const source = done.get(item.id) ?? done.get(byExercise.get(item.exerciseId)!);
    if (item.deleted || !source || (await db.workouts.get(item.workoutId))?.deleted) continue;
    const { mode, targets } = withDone(item.targets, item.mode, source);
    if (mode !== item.mode || JSON.stringify(targets) !== JSON.stringify(item.targets)) {
      await db.workoutItems.update(item.id, { mode, targets, ...touched() });
    }
  }
}

export async function discardSession(db: HalkoDb = defaultDb) {
  const live = await getLive(db);
  if (!live) return;
  await deleteSession(live.sessionId, db);
}

export async function deleteSession(sessionId: string, db: HalkoDb = defaultDb) {
  await db.transaction('rw', db.sessions, db.setLogs, db.meta, async () => {
    await db.sessions.update(sessionId, { deleted: 1, ...touched() });
    await db.setLogs.where('sessionId').equals(sessionId).modify({ deleted: 1, ...touched() });
    const live = await getLive(db);
    if (live?.sessionId === sessionId) await db.meta.delete(LIVE);
  });
}

export async function finishedSessions(db: HalkoDb = defaultDb): Promise<LocalSession[]> {
  const rows = await db.sessions.orderBy('startedAt').reverse().toArray();
  return rows.filter((s) => !s.deleted && s.endedAt !== null);
}

// All logs of an exercise in finished sessions, grouped by session, oldest first.
export async function exerciseHistory(exerciseId: string, db: HalkoDb = defaultDb) {
  const logs = (await db.setLogs.where('[exerciseId+completedAt]').between([exerciseId, 0], [exerciseId, Infinity]).toArray()).filter(
    (l) => !l.deleted,
  );
  const sessions = new Map((await finishedSessions(db)).map((s) => [s.id, s]));
  const bySession = new Map<string, LocalSetLog[]>();
  for (const l of logs) {
    if (!sessions.has(l.sessionId)) continue;
    bySession.set(l.sessionId, [...(bySession.get(l.sessionId) ?? []), l]);
  }
  return [...bySession.entries()]
    .map(([id, sets]) => ({ session: sessions.get(id)!, sets: sets.sort((a, b) => a.setIndex - b.setIndex) }))
    .sort((a, b) => a.session.startedAt - b.session.startedAt);
}

// Finished sessions of a workout, oldest first, each with its logged sets.
export async function workoutHistory(workoutId: string, db: HalkoDb = defaultDb): Promise<{ session: LocalSession; sets: LocalSetLog[] }[]> {
  const sessions = (await finishedSessions(db)).filter((s) => s.workoutId === workoutId).reverse();
  const logs = (await db.setLogs.where('sessionId').anyOf(sessions.map((s) => s.id)).toArray()).filter((l) => !l.deleted);
  return sessions.map((session) => ({ session, sets: logs.filter((l) => l.sessionId === session.id) }));
}

// Working sets with a load and reps, from finished sessions, for each load-and-reps exercise (by name).
export async function liftedSets(db: HalkoDb = defaultDb): Promise<{ exercise: LocalExercise; sets: LocalSetLog[] }[]> {
  const sessions = new Set((await finishedSessions(db)).map((s) => s.id));
  const logs = (await db.setLogs.toArray()).filter(
    (l) => !l.deleted && sessions.has(l.sessionId) && l.kind !== 'warmup' && l.weightG && l.reps,
  );
  const byExercise = new Map<string, LocalSetLog[]>();
  for (const l of logs) byExercise.set(l.exerciseId, [...(byExercise.get(l.exerciseId) ?? []), l]);
  const exercises = await db.exercises.bulkGet([...byExercise.keys()]);
  return exercises
    .filter((e): e is LocalExercise => !!e && !e.deleted && e.exerciseType === 'weight_reps')
    .map((exercise) => ({ exercise, sets: byExercise.get(exercise.id)! }))
    .sort((a, b) => a.exercise.name.localeCompare(b.exercise.name, currentLocale()));
}

// What was done for each set index the last time this exercise was performed (outside this session).
export async function previousPerformance(
  exerciseId: string,
  excludeSessionId: string,
  db: HalkoDb = defaultDb,
): Promise<Map<number, LocalSetLog>> {
  const history = (await exerciseHistory(exerciseId, db)).filter((h) => h.session.id !== excludeSessionId);
  const last = history[history.length - 1];
  return new Map((last?.sets ?? []).map((s) => [s.setIndex, s]));
}
