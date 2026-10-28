// Usage: npm run seed:history
// Fills a development database with three workouts (Push / Pull / Legs) and 18 months of finished
// sessions: a progression that slows down over time, a lighter week every 8 weeks, a 3-week break and
// a few missed reps, to try the history, records and charts (and their periods). Rows have fixed ids:
// running it again rewrites the same history.
import type { SetKind, SetTarget } from '@halko/shared';
import { and, eq, like } from 'drizzle-orm';
import { loadConfig } from '../config.ts';
import { ensureOwner, nextRev, openDb } from '../db/index.ts';
import * as schema from '../db/schema.ts';
import { sync } from '../sync.ts';

const weeks = 78;
// Weeks without any session, counted from the first one.
const BREAK = { from: 30, to: 32 };

// kg: starting load, step: kg added each week (0 for body weight), or seconds for a timed exercise.
interface Plan {
  // free-exercise-db id of the library exercise.
  ref: string;
  sets: number;
  reps: number;
  kg?: number;
  step?: number;
  seconds?: number;
  warmups?: number;
  restS: number;
}

const WORKOUTS: { key: string; name: string; items: Plan[] }[] = [
  {
    key: 'push',
    name: 'Push',
    items: [
      { ref: 'Barbell_Bench_Press_-_Medium_Grip', sets: 4, reps: 8, kg: 60, step: 2.5, warmups: 2, restS: 150 },
      { ref: 'Standing_Military_Press', sets: 3, reps: 8, kg: 35, step: 1.25, warmups: 1, restS: 120 },
      { ref: 'Side_Lateral_Raise', sets: 3, reps: 12, kg: 8, step: 0.5, restS: 60 },
      { ref: 'Dips_-_Triceps_Version', sets: 3, reps: 8, restS: 90 },
      { ref: 'Cable_Rope_Overhead_Triceps_Extension', sets: 3, reps: 12, kg: 20, step: 1, restS: 60 },
    ],
  },
  {
    key: 'pull',
    name: 'Pull',
    items: [
      { ref: 'Barbell_Deadlift', sets: 3, reps: 5, kg: 90, step: 5, warmups: 2, restS: 180 },
      { ref: 'Chin-Up', sets: 3, reps: 6, restS: 120 },
      { ref: 'Bent_Over_Barbell_Row', sets: 4, reps: 8, kg: 50, step: 2.5, restS: 90 },
      { ref: 'Wide-Grip_Lat_Pulldown', sets: 3, reps: 10, kg: 45, step: 2.5, restS: 90 },
      { ref: 'Face_Pull', sets: 3, reps: 15, kg: 15, step: 1, restS: 60 },
      { ref: 'Barbell_Curl', sets: 3, reps: 10, kg: 25, step: 1, restS: 60 },
    ],
  },
  {
    key: 'legs',
    name: 'Legs',
    items: [
      { ref: 'Barbell_Squat', sets: 4, reps: 6, kg: 70, step: 2.5, warmups: 2, restS: 180 },
      { ref: 'Leg_Press', sets: 3, reps: 10, kg: 120, step: 5, restS: 120 },
      { ref: 'Seated_Leg_Curl', sets: 3, reps: 12, kg: 35, step: 1.25, restS: 75 },
      { ref: 'Dumbbell_Lunges', sets: 3, reps: 10, kg: 14, step: 1, restS: 90 },
      { ref: 'Barbell_Seated_Calf_Raise', sets: 4, reps: 15, kg: 30, step: 2.5, restS: 60 },
      { ref: 'Plank', sets: 3, reps: 0, seconds: 45, restS: 60 },
    ],
  },
];

// Deterministic randomness, so the history is the same on every run.
let seed = 42;
const random = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);

const config = loadConfig();
const db = openDb(config.dataDir);
const userId = ensureOwner(db);

const exerciseId = (ref: string) => {
  const row = db
    .select({ id: schema.exercises.id })
    .from(schema.exercises)
    .where(and(eq(schema.exercises.source, 'builtin'), eq(schema.exercises.sourceRef, ref)))
    .get();
  if (!row) throw new Error(`Exercise not found: "${ref}". Run npm run import:exercises first.`);
  return row.id;
};

const now = Date.now();
const DAY = 86_400_000;
const g = (kg: number) => Math.round(kg * 1000);
const roundTo = (kg: number, step: number) => Math.round(kg / step) * step;

const workouts: unknown[] = [];
const workoutItems: unknown[] = [];
const sessions: unknown[] = [];
const setLogs: unknown[] = [];

// Load or reps of a plan for a given week. Progress is quick at first, then slows down (about 12 weekly
// steps in the first 3 months, 24 after 18), and every 8th week is a lighter one.
function load(plan: Plan, week: number) {
  const steps = 12 * Math.log(1 + week / 12);
  const deload = week % 8 === 7;
  if (plan.seconds !== undefined) return { seconds: plan.seconds + Math.round(steps) * 5 };
  if (plan.kg === undefined) return { reps: plan.reps + Math.floor(steps / 3) };
  const kg = roundTo((plan.kg + plan.step! * steps) * (deload ? 0.85 : 1), plan.step! < 1 ? 0.5 : 1.25);
  return { kg };
}

function targets(plan: Plan, week: number): SetTarget[] {
  const l = load(plan, week);
  const list: SetTarget[] = [];
  for (let w = 0; w < (plan.warmups ?? 0); w++) {
    list.push({ kind: 'warmup', reps: 8 - w * 3, weightG: g(roundTo((l.kg ?? 0) * (0.4 + w * 0.25), 2.5)), restS: 60 });
  }
  for (let s = 0; s < plan.sets; s++) {
    if (l.seconds !== undefined) list.push({ kind: 'normal', durationS: l.seconds, restS: plan.restS });
    else list.push({ kind: 'normal', reps: l.reps ?? plan.reps, ...(l.kg !== undefined && { weightG: g(l.kg) }), restS: plan.restS });
  }
  return list;
}

// Monday 18:00, (weeks - 1) weeks before the current one.
const start = new Date(now - (((new Date(now).getDay() + 6) % 7) + (weeks - 1) * 7) * DAY);
start.setHours(18, 0, 0, 0);

WORKOUTS.forEach((w, wi) => {
  workouts.push({ id: `seed-w-${w.key}`, sport: 'strength', name: w.name, note: null, position: 100 + wi, createdAt: start.getTime(), updatedAt: now, deleted: false });
  w.items.forEach((plan, ii) => {
    workoutItems.push({
      id: `seed-i-${w.key}-${ii}`,
      workoutId: `seed-w-${w.key}`,
      exerciseId: exerciseId(plan.ref),
      position: ii,
      mode: 'per_set',
      supersetGroup: null,
      // Warm-ups planned without values: the app works them out from the working sets.
      targets: targets(plan, weeks - 1).map((t) => (t.kind === 'warmup' ? { kind: 'warmup' as const, restS: t.restS } : t)),
      note: null,
      createdAt: start.getTime(),
      updatedAt: now,
      deleted: false,
    });
  });
});

// Monday Push, Wednesday Pull, Friday Legs; about one session in twelve is skipped.
let count = 0;
for (let week = 0; week < weeks; week++) {
  WORKOUTS.forEach((w, wi) => {
    const begin = start.getTime() + (week * 7 + wi * 2) * DAY + Math.round((random() - 0.5) * 2 * 3_600_000);
    if (begin > now - 3_600_000 || random() < 0.08 || (week >= BREAK.from && week <= BREAK.to)) return;
    const sessionId = `seed-s-${week}-${w.key}`;
    let at = begin + 5 * 60_000;
    w.items.forEach((plan, ii) => {
      targets(plan, week).forEach((t, setIndex) => {
        let reps = t.reps;
        // Heavy last sets sometimes fall a rep or two short.
        if (t.kind === 'normal' && reps && setIndex === (plan.warmups ?? 0) + plan.sets - 1 && random() < 0.3) reps -= 1 + Math.floor(random() * 2);
        at += (t.durationS ?? 40) * 1000 + (t.restS ?? 60) * 1000 * (0.9 + random() * 0.3);
        setLogs.push({
          id: `seed-l-${week}-${w.key}-${ii}-${setIndex}`,
          sessionId,
          exerciseId: exerciseId(plan.ref),
          workoutItemId: `seed-i-${w.key}-${ii}`,
          position: ii,
          setIndex,
          kind: t.kind as SetKind,
          ...(reps !== undefined && { reps }),
          ...(t.weightG !== undefined && { weightG: t.weightG }),
          ...(t.durationS !== undefined && { durationS: t.durationS }),
          completedAt: Math.round(at),
          createdAt: Math.round(at),
          updatedAt: now,
          deleted: false,
        });
      });
      at += 90_000;
    });
    sessions.push({ id: sessionId, workoutId: `seed-w-${w.key}`, sport: 'strength', name: w.name, startedAt: begin, endedAt: Math.round(at), note: null, createdAt: begin, updatedAt: now, deleted: false });
    count++;
  });
}

// Pushed like a device would, in the order the references need.
const rejected = [
  ...sync(db, userId, Number.MAX_SAFE_INTEGER, { workouts, workoutItems }).rejected,
  ...sync(db, userId, Number.MAX_SAFE_INTEGER, { sessions }).rejected,
  ...sync(db, userId, Number.MAX_SAFE_INTEGER, { setLogs }).rejected,
];

// Rows of an earlier run that this one did not write again (a session skipped this time…) are deleted,
// with a new revision so that devices drop them at their next sync.
const written = new Set([...sessions, ...setLogs].map((r) => (r as { id: string }).id));
let removed = 0;
db.transaction((tx) => {
  for (const table of [schema.sessions, schema.setLogs]) {
    for (const { id } of tx.select({ id: table.id }).from(table).where(and(like(table.id, 'seed-%'), eq(table.deleted, false))).all()) {
      if (written.has(id)) continue;
      tx.update(table).set({ deleted: true, updatedAt: now, rev: nextRev(tx) }).where(eq(table.id, id)).run();
      removed++;
    }
  }
});
db.$client.close();

if (rejected.length) {
  console.error(`${rejected.length} rows rejected:`, rejected.slice(0, 5));
  process.exit(1);
}
console.log(
  `${config.dataDir}: Push, Pull and Legs workouts, ${count} sessions done over ${weeks} weeks, ${setLogs.length} sets` +
    (removed ? `, ${removed} rows of a previous run deleted.` : '.'),
);
