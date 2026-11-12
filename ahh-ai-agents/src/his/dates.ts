import type { HisDateRange } from './client.js';

const HOSPITAL_TIMEZONE = 'Asia/Riyadh';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_MS = 24 * 60 * 60 * 1000;

/** "dd-MMM-yyyy" for a date as seen in the hospital's time zone. */
export function toHisDate(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: HOSPITAL_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('day')}-${MONTHS[Number(get('month')) - 1]}-${get('year')}`;
}

/** The last `days` days up to and including today, in HIS format. */
export function lastDaysRange(days: number, now = new Date()): HisDateRange {
  return { from: toHisDate(new Date(now.getTime() - days * DAY_MS)), to: toHisDate(now) };
}

/** "dd-MMM-yyyy HH:mm" → "dd-MMM-yyyy" (the format FetchPrevLabTestComponents expects for DOB). */
export function hisDateOnly(value: string | undefined): string | undefined {
  const m = /^(\d{1,2}-[A-Za-z]{3}-\d{4})/.exec(value?.trim() ?? '');
  return m?.[1];
}
