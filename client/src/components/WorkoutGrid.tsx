import {
  type CollisionDetection,
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { SortableContext, type SortingStrategy, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useLiveQuery } from 'dexie-react-hooks';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { type LocalFolder, db } from '../db/db.ts';
import { moveToFolder, reorderHome } from '../db/folders.ts';
import { reorderWorkouts } from '../db/workouts.ts';
import { useStartSession } from '../lib/useStartSession.ts';
import { Icon } from './Icon.tsx';
import { t } from '../lib/i18n.ts';

// The workouts of a folder (null: those in none), in their order, with what they hold.
export function useWorkoutSummaries(folderId: string | null) {
  return useLiveQuery(async () => {
    const workouts = await db.workouts.orderBy('position').filter((w) => !w.deleted && w.folderId === folderId).toArray();
    const items = await db.workoutItems.filter((i) => !i.deleted).toArray();
    return workouts.map((w) => {
      const mine = items.filter((i) => i.workoutId === w.id);
      return {
        ...w,
        exercises: mine.length,
        sets: mine.reduce((n, i) => n + i.targets.length, 0),
      };
    });
  }, [folderId]);
}

type Summary = NonNullable<ReturnType<typeof useWorkoutSummaries>>[number];
type FolderSummary = { folder: LocalFolder; count: number };
type Entry = { key: string; position: number } & ({ workout: Summary } | { folder: FolderSummary });

const FOLDER = 'folder:';
const isFolder = (key: string | number) => String(key).startsWith(FOLDER);

// The inside of a workout card (also shown under the pointer while it is dragged).
function WorkoutContent({ workout }: { workout: Summary }) {
  return (
    <>
      <span className="card-icon num" aria-hidden="true">
        {workout.name.charAt(0).toUpperCase()}
      </span>
      <span className="grow stack" style={{ gap: 2 }}>
        <span className="ellipsis" style={{ fontWeight: 700 }}>
          {workout.name}
        </span>
        <span className="small muted">
          {t('exercises.count', { count: workout.exercises })} · {t('sets.count', { count: workout.sets })}
        </span>
      </span>
    </>
  );
}

function FolderContent({ folder, count }: FolderSummary) {
  return (
    <>
      <span className="card-icon" aria-hidden="true">
        <Icon name="folder" size={22} />
      </span>
      <span className="grow stack" style={{ gap: 2 }}>
        <span className="ellipsis" style={{ fontWeight: 700 }}>
          {folder.name}
        </span>
        <span className="small muted">{t('folder.count', { count })}</span>
      </span>
    </>
  );
}

// A card of the list: dragging it moves it, a plain click opens it. From the keyboard the card is the
// stop: Space picks it up (arrows, then Space to drop), Enter opens it.
function SortableCard({
  id,
  to,
  label,
  lit,
  action,
  corner,
  fixed,
  children,
}: {
  id: string;
  // Not draggable (the workouts page outside its edit mode).
  fixed?: boolean;
  to: string;
  label: string;
  lit?: boolean;
  // A button of the card, next to its link.
  action?: ReactNode;
  // A small button on its corner (a folder being edited: take the workout out).
  corner?: ReactNode;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled: fixed });
  return (
    <div
      ref={setNodeRef}
      className={`list-item${lit ? ' drop-over' : ''}`}
      style={{
        padding: '10px 10px 10px 14px',
        minHeight: 64,
        transform: CSS.Transform.toString(transform),
        transition,
        // Its place, while the card itself follows the pointer.
        opacity: isDragging ? 0.35 : 1,
        position: 'relative',
        userSelect: 'none',
      }}
      {...attributes}
      {...listeners}
      // Keys on a button inside are the button's; while the card is being moved, dnd-kit handles them.
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget || isDragging) return;
        if (e.key === 'Enter') navigate(to);
        else listeners?.onKeyDown?.(e);
      }}
      aria-roledescription={fixed ? undefined : t('home.draggable')}
      aria-label={label}
    >
      {/* For the mouse only (the card is the keyboard stop), and no native link drag. */}
      <Link to={to} tabIndex={-1} draggable={false} className="row grow" style={{ textDecoration: 'none', color: 'var(--text)', minWidth: 0 }}>
        {children}
      </Link>
      {action}
      {corner}
    </div>
  );
}

// Workouts (and, on the workouts page, folders) in their order. Cards are dragged to reorder them; a
// workout dropped on a folder goes into it. With `fixed`, they are not. With `onTakeOut` (a folder being
// edited), each workout has a small cross to take it out.
export function WorkoutGrid({
  workouts,
  folders,
  fixed = false,
  onTakeOut,
}: {
  workouts: Summary[];
  folders?: FolderSummary[];
  fixed?: boolean;
  onTakeOut?: (workoutId: string) => void;
}) {
  const start = useStartSession();
  const entries = useMemo<Entry[]>(
    () =>
      [
        ...(folders ?? []).map((f) => ({ key: FOLDER + f.folder.id, position: f.folder.position, folder: f })),
        ...workouts.map((w) => ({ key: w.id, position: w.position, workout: w })),
      ].sort((a, b) => a.position - b.position),
    [workouts, folders],
  );
  // Optimistic order while a move is being saved, to avoid a flicker back to the old order.
  const [order, setOrder] = useState<string[] | null>(null);
  useEffect(() => setOrder(null), [entries]);
  const ordered = useMemo(() => {
    if (!order) return entries;
    const byKey = new Map(entries.map((e) => [e.key, e]));
    return order.map((k) => byKey.get(k)).filter((e) => e !== undefined);
  }, [entries, order]);
  const keys = ordered.map((e) => e.key);

  const [dragged, setDragged] = useState<string | null>(null);
  const [overFolder, setOverFolder] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  // Dropping a card on its link must not open it (dnd-kit stops the click, not the link's navigation).
  const moved = useRef(false);
  useEffect(() => {
    const block = (e: MouseEvent) => moved.current && e.preventDefault();
    addEventListener('click', block, true);
    return () => removeEventListener('click', block, true);
  }, []);
  const settle = () => {
    setDragged(null);
    setOverFolder(null);
    setTimeout(() => (moved.current = false));
  };
  const onDragOver = ({ active, over }: DragOverEvent) =>
    setOverFolder(over && !isFolder(active.id) && isFolder(over.id) ? String(over.id) : null);
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    settle();
    if (!over || active.id === over.id) return;
    const from = String(active.id);
    const to = String(over.id);
    if (!isFolder(from) && isFolder(to)) {
      // Gone into the folder at once.
      setOrder(keys.filter((k) => k !== from));
      return void moveToFolder(from, to.slice(FOLDER.length));
    }
    const next = arrayMove(keys, keys.indexOf(from), keys.indexOf(to));
    setOrder(next);
    void (folders ? reorderHome(next) : reorderWorkouts(next));
  };
  // A workout over a folder goes into it: the others do not make room for it.
  const strategy: SortingStrategy = (args) =>
    !isFolder(keys[args.activeIndex] ?? '') && isFolder(keys[args.overIndex] ?? '') ? null : rectSortingStrategy(args);

  const draggedEntry = ordered.find((e) => e.key === dragged);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 10 }}>
      <DndContext
        sensors={sensors}
        collisionDetection={collision}
        onDragStart={({ active }) => {
          moved.current = true;
          setDragged(String(active.id));
        }}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={settle}
      >
        <SortableContext items={keys} strategy={strategy}>
          {ordered.map((e) =>
            'folder' in e ? (
              <SortableCard key={e.key} id={e.key} to={`/folders/${e.folder.folder.id}`} label={e.folder.folder.name} lit={overFolder === e.key} fixed={fixed}>
                <FolderContent {...e.folder} />
                <Icon name="chevron" size={18} />
              </SortableCard>
            ) : (
              <SortableCard
                key={e.key}
                id={e.key}
                to={`/workouts/${e.workout.id}`}
                label={e.workout.name}
                fixed={fixed}
                action={
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ minHeight: 44, padding: '0 14px' }}
                    onClick={() => start(e.workout.id)}
                    disabled={e.workout.exercises === 0}
                    aria-label={t('home.startName', { name: e.workout.name })}
                  >
                    <Icon name="play" size={18} />
                    {t('home.start')}
                  </button>
                }
                corner={
                  onTakeOut && (
                    <button
                      type="button"
                      className="card-remove"
                      onClick={() => onTakeOut(e.workout.id)}
                      // Not a drag of the card.
                      onPointerDown={(ev) => ev.stopPropagation()}
                      aria-label={t('folder.removeWorkout', { name: e.workout.name })}
                      title={t('folder.removeWorkout', { name: e.workout.name })}
                    >
                      <Icon name="close" size={14} />
                    </button>
                  )
                }
              >
                <WorkoutContent workout={e.workout} />
              </SortableCard>
            ),
          )}
        </SortableContext>
        {/* The card under the pointer, smaller over a folder (it goes in). */}
        <DragOverlay dropAnimation={overFolder ? null : undefined}>
          {draggedEntry && (
            <div className={`list-item drag-card${overFolder ? ' into-folder' : ''}`} style={{ padding: '10px 14px', minHeight: 64 }}>
              {'folder' in draggedEntry ? <FolderContent {...draggedEntry.folder} /> : <WorkoutContent workout={draggedEntry.workout} />}
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

// A workout dragged over a folder (pointer on it) goes into it; otherwise the nearest card is where it
// goes. A folder only moves among the others.
const collision: CollisionDetection = (args) => {
  if (isFolder(args.active.id)) return closestCenter(args);
  const folders = args.droppableContainers.filter((c) => isFolder(c.id));
  const onFolder = pointerWithin({ ...args, droppableContainers: folders });
  return onFolder.length ? onFolder : closestCenter({ ...args, droppableContainers: args.droppableContainers.filter((c) => !isFolder(c.id)) });
};
