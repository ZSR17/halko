const PATHS = {
  home: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
  dumbbell: 'M6 7v10M3 9v6M18 7v10M21 9v6M6 12h12',
  chart: 'M4 20V11M10 20V5M16 20v-7M21 20H3',
  back: 'M15 6l-6 6 6 6',
  chevron: 'M9 6l6 6-6 6',
  plus: 'M12 5v14M5 12h14',
  play: 'M7 5l12 7-12 7z',
  cloud: 'M7 18a5 5 0 1 1 1-9.9A6 6 0 0 1 19 10a4 4 0 0 1 0 8z',
  close: 'M6 6l12 12M18 6L6 18',
  search: 'M20 20l-4-4M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14z',
  check: 'M5 12l5 5 9-10',
  pencil: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  grip: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
  link: 'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  copy: 'M8 8h12v12H8zM4 16V4h12',
  plate: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  percent: 'M19 5L5 19M7 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  undo: 'M4 12a8 8 0 1 0 2.5-5.8M4 4v5h5',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  folder: 'M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z',
  upload: 'M12 20V9M7 14l5-5 5 5M5 4h14',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1L7 17M17 7l2.1-2.1',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 22, strokeWidth = 2.1 }: { name: IconName; size?: number; strokeWidth?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={name === 'grip' ? 3 : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
