/** Minimal stroke icon set (24px grid, 1.8 stroke). Names match `Category.icon`. */
const paths: Record<string, string> = {
  home: 'M4 11 12 4l8 7M6 9.5V20h12V9.5',
  inbox: 'M4 13h4l1.5 3h5L16 13h4M4 13l2-8h12l2 8v6H4z',
  message: 'M4 5h16v11H8l-4 4V5Z',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  wallet: 'M3 7h15a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V7Zm0 0 2.5-3H16M16 13.5h2',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  plus: 'M12 5v14M5 12h14',
  left: 'm15 6-6 6 6 6',
  right: 'm9 6 6 6-6 6',
  up: 'M12 19V5m-6 6 6-6 6 6',
  down: 'M12 5v14m6-6-6 6-6-6',
  chevdown: 'm6 9 6 6 6-6',
  x: 'M6 6l12 12M18 6 6 18',
  check: 'm5 12.5 4.5 4.5L19 7',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  'eye-off':
    'M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3 3.9M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2',
  ban: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM5.6 5.6l12.8 12.8',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21a8 8 0 0 1 16 0',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm9 2-4-4',
  card: 'M3 6h18v12H3zM3 10h18M7 15h4',
  bank: 'M3 10 12 4l9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18',
  cash: 'M3 7h18v10H3zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 10v.01M18 14v.01',
  phone: 'M7 3h10v18H7zM11 18h2',
  transfer: 'M4 8h14l-3-3M20 16H6l3 3',
  palette:
    'M12 21a9 9 0 1 1 9-9c0 2-1.5 3-3 3h-2a2 2 0 0 0-1.5 3.3A1.6 1.6 0 0 1 12 21ZM7.5 11h.01M10 7.5h.01M14.5 7.5h.01',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  utensils: 'M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10M17 3c-2 1-3 3.5-3 7h3v11',
  basket: 'M4 9h16l-1.5 10h-13L4 9Zm4 0 3-5M16 9l-3-5M9 13v3M15 13v3',
  car: 'M5 16V11l2-5h10l2 5v5M3 16h18v3H3zM7.5 13h.01M16.5 13h.01',
  bag: 'M5 8h14l-1 13H6L5 8Zm4 0a3 3 0 0 1 6 0',
  bolt: 'M13 3 5 13h6l-1 8 8-10h-6l1-8Z',
  film: 'M4 5h16v14H4zM8 5v14M16 5v14M4 9h4M4 15h4M16 9h4M16 15h4',
  heart: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z',
  plane:
    'M10 14 3 11l2-2 6 1 5-5c1-1 3-1 3 0s0 2-1 3l-5 5 1 6-2 2-3-7-3 3v2l-1.5 1L4 18l-2-1.5 1-1.5h2Z',
  repeat: 'M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4',
  book: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5Zm0 16a2 2 0 0 1 2-2h13',
  gift: 'M4 11h16v10H4zM3 7h18v4H3zM12 7v14M12 7S10.5 3 8 3.5 8 7 12 7Zm0 0s1.5-4 4-3.5S16 7 12 7Z',
  receipt: 'M6 3h12v18l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5L6 21V3Zm3 5h6M9 12h6M9 16h3',
  dots: 'M6 12h.01M12 12h.01M18 12h.01',
  briefcase: 'M4 8h16v11H4zM9 8V5h6v3M4 13h16',
  percent: 'M19 5 5 19M7 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm10 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
  sparkle: 'M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2 2-6Z',
};

export function Icon({
  name,
  size = 20,
  className,
}: {
  name: string;
  size?: number;
  className?: string;
}) {
  const d = paths[name] ?? paths.dots!;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d={d} />
    </svg>
  );
}

/** Icons offered when choosing a category icon. */
export const iconNames = [
  'utensils',
  'basket',
  'car',
  'bag',
  'bolt',
  'home',
  'film',
  'heart',
  'plane',
  'repeat',
  'book',
  'gift',
  'receipt',
  'briefcase',
  'percent',
  'sparkle',
  'phone',
  'card',
  'cash',
  'bank',
  'calendar',
  'dots',
];
