import type { LocalWorkoutItem } from '../db/db.ts';
import { type ItemMode, toSimple } from './targets.ts';
import { newId } from './id.ts';

// Changes made to a workout's exercises while it is being edited. Nothing is saved until "Save"
// (saveWorkout), so each change returns a new list.

// A superset must be a run of ≥ 2 consecutive items: groups that became singletons are dropped, and a
// second run reusing a group id (after a move) gets its own.
function normalizeSupersets(items: LocalWorkoutItem[]): LocalWorkoutItem[] {
  const out = items.map((i) => ({ ...i }));
  const seen = new Set<string>();
  for (let start = 0; start < out.length; ) {
    const group = out[start]!.supersetGroup;
    let end = start;
    while (group && out[end + 1]?.supersetGroup === group) end++;
    if (group) {
      const replacement = end === start ? null : seen.has(group) ? newId() : group;
      for (let k = start; k <= end; k++) out[k]!.supersetGroup = replacement;
      seen.add(group);
    }
    start = end + 1;
  }
  return out;
}

// Links the item at `index` with the next one into a superset, or unlinks them if already linked.
export function toggleSuperset(items: LocalWorkoutItem[], index: number): LocalWorkoutItem[] {
  const cur = items[index];
  const next = items[index + 1];
  if (!cur || !next) return items;
  const out = items.map((i) => ({ ...i }));
  if (cur.supersetGroup && cur.supersetGroup === next.supersetGroup) {
    // Split the group after `cur`: everything from `next` on gets a fresh group.
    const fresh = newId();
    for (let k = index + 1; k < out.length && items[k]!.supersetGroup === cur.supersetGroup; k++) out[k]!.supersetGroup = fresh;
  } else {
    const group = cur.supersetGroup ?? next.supersetGroup ?? newId();
    out[index]!.supersetGroup = group;
    for (let k = index + 1; k < out.length; k++) {
      if (k > index + 1 && (next.supersetGroup === null || items[k]!.supersetGroup !== next.supersetGroup)) break;
      out[k]!.supersetGroup = group;
    }
  }
  return normalizeSupersets(out);
}

export function moveItem(items: LocalWorkoutItem[], from: number, to: number): LocalWorkoutItem[] {
  const out = [...items];
  out.splice(to, 0, ...out.splice(from, 1));
  return normalizeSupersets(out);
}

export function removeItemAt(items: LocalWorkoutItem[], index: number): LocalWorkoutItem[] {
  return normalizeSupersets(items.filter((_, k) => k !== index));
}

export function withMode(item: LocalWorkoutItem, mode: ItemMode): LocalWorkoutItem {
  return item.mode === mode ? item : { ...item, mode, targets: mode === 'simple' ? toSimple(item.targets) : item.targets };
}
