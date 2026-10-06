import { BadRequestException } from '@nestjs/common';

/** Parses a YYYY-MM-DD string to a UTC-midnight Date (matches Postgres DATE columns). */
export function parseDate(value: string, label = 'Date'): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException(`${label} must be in YYYY-MM-DD format`);
  const d = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) throw new BadRequestException(`${label} is not a valid date`);
  return d;
}

export const monthStart = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));

/** The owner's time zone. Every "today", "issued on" and "received on" follows it, never the server clock (UTC on Render). */
export const appTimeZone = () => process.env.APP_TIMEZONE || 'Asia/Kolkata';

const formatters = new Map<string, Intl.DateTimeFormat>();
/** Calendar day of an instant in the app's time zone, as a UTC-midnight Date (matches Postgres DATE columns). */
export function localDateOf(instant: Date, timeZone = appTimeZone()): Date {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    formatters.set(timeZone, f);
  }
  const parts = f.formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return new Date(Date.UTC(get('year'), get('month') - 1, get('day')));
}

/** Today in the app's time zone (India by default). Between 00:00 and 05:30 IST the UTC date is still yesterday. */
export const todayLocal = () => localDateOf(new Date());

/** First and last day of the month containing `d`, as UTC-midnight Dates. */
export const monthBounds = (d: Date) => ({ start: monthStart(d), end: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)) });
export const isoDate = (d: Date) => d.toISOString().slice(0, 10);
