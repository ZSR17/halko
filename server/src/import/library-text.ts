import fs from 'node:fs';
import { EXERCISE_TYPE_IDS, type ExerciseType, type ExerciseTranslations, MUSCLE_IDS } from '@halko/shared';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { type Db, nextRev } from '../db/index.ts';
import { exercises } from '../db/schema.ts';

// Names and instructions of the built-in exercises, keyed by their free-exercise-db id: en.json is the
// original text (the reference), and each other <language>.json a translation, complete or not.
const textSchema = z.record(z.string(), z.object({ name: z.string().min(1), instructions: z.array(z.string()) }));

const muscles = z.array(z.enum(MUSCLE_IDS));
// Fixes to the community data, whatever the language: muscles where they were wrong or incomplete, and
// a few exercise types.
const fixesSchema = z.record(
  z.string(),
  z.object({
    type: z.enum(EXERCISE_TYPE_IDS as [ExerciseType, ...ExerciseType[]]).optional(),
    primary: muscles.optional(),
    secondary: muscles.optional(),
  }),
);

interface LibraryText {
  en: z.infer<typeof textSchema>;
  translations: Record<string, z.infer<typeof textSchema>>;
  fixes: z.infer<typeof fixesSchema>;
  // Exercises working one side at a time (unilateral.json, picked by hand: one arm, one leg, lunges,
  // side plank, stretches done side by side…).
  unilateral: Set<string>;
}

const DIR = new URL('./library/', import.meta.url);
const read = (file: string) => JSON.parse(fs.readFileSync(new URL(file, DIR), 'utf8')) as unknown;

export function loadLibraryText(): LibraryText {
  const translations: LibraryText['translations'] = {};
  for (const file of fs.readdirSync(DIR)) {
    const locale = /^([a-z]{2}(?:-[A-Z]{2})?)\.json$/.exec(file)?.[1];
    if (locale && locale !== 'en') translations[locale] = textSchema.parse(read(file));
  }
  return {
    en: textSchema.parse(read('en.json')),
    translations,
    fixes: fixesSchema.parse(read('fixes.json')),
    unilateral: new Set(z.array(z.string()).parse(read('unilateral.json'))),
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// Brings built-in exercises in line with the files: English text, every translation, the fixes, and which
// work one side at a time.
// Rows already up to date are left alone, so it runs at every start and only new or changed entries
// reach the devices.
export function applyLibraryText(db: Db, text: LibraryText = loadLibraryText()): number {
  let changed = 0;
  db.transaction((tx) => {
    const rows = tx.select().from(exercises).where(eq(exercises.source, 'builtin')).all();
    for (const row of rows) {
      const ref = row.sourceRef ?? '';
      const en = text.en[ref];
      const fix = text.fixes[ref];
      const translations: ExerciseTranslations = {};
      for (const [locale, entries] of Object.entries(text.translations)) {
        const entry = entries[ref];
        if (entry) translations[locale] = entry;
      }
      const next = {
        name: en?.name ?? row.name,
        instructions: en?.instructions ?? row.instructions,
        translations,
        exerciseType: fix?.type ?? row.exerciseType,
        primaryMuscles: fix?.primary ?? row.primaryMuscles,
        secondaryMuscles: fix?.secondary ?? row.secondaryMuscles,
        unilateral: text.unilateral.has(ref),
      };
      if (Object.entries(next).every(([k, v]) => same(v, row[k as keyof typeof row]))) continue;
      tx.update(exercises)
        .set({ ...next, updatedAt: Date.now(), rev: nextRev(tx) })
        .where(eq(exercises.id, row.id))
        .run();
      changed++;
    }
  });
  return changed;
}
