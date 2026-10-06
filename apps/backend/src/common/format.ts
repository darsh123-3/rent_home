import { localDateOf } from './dates';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Indian digit grouping: 150000 -> 1,50,000 (no Intl dependency, so it behaves the same everywhere). */
export function formatINR(value: number | string | null | undefined, opts: { decimals?: boolean } = {}): string {
  const n = Number(value ?? 0);
  const neg = n < 0;
  const abs = Math.abs(n);
  const hasFraction = Math.round(abs * 100) % 100 !== 0;
  const fixed = abs.toFixed(opts.decimals || hasFraction ? 2 : 0);
  const [intPart, decPart] = fixed.split('.');
  const grouped = intPart.length > 3
    ? intPart.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + intPart.slice(-3)
    : intPart;
  return `${neg ? '-' : ''}₹${grouped}${decPart ? `.${decPart}` : ''}`;
}

const readDate = (value: Date | string | null | undefined) => {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const formatDate = (value?: Date | string | null) => {
  const date = readDate(value);
  if (!date) return '-';
  return `${String(date.getUTCDate()).padStart(2, '0')} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
};

/** A timestamp (e.g. when a bill was created) shown as its calendar day in the app's time zone (India), not the server's. */
export const formatDateLocal = (value?: Date | string | null) => {
  const date = readDate(value);
  if (!date) return '-';
  return formatDate(localDateOf(date));
};

export const formatMonth = (value?: Date | string | null) => {
  const date = readDate(value);
  if (!date) return '-';
  return `${MONTHS_LONG[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
};

export const formatMonthShort = (value?: Date | string | null) => {
  const date = readDate(value);
  if (!date) return '-';
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
};

export const formatShortDate = (value?: Date | string | null) => {
  const date = readDate(value);
  if (!date) return '-';
  return `${String(date.getUTCDate()).padStart(2, '0')} ${MONTHS[date.getUTCMonth()]}`;
};
