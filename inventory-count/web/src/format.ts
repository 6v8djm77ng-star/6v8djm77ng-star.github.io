import type { Comparison, ItemState, RoundStatus } from './api/client';

const nf = new Intl.NumberFormat('he-IL');
const LRM = '\u200E'; // keeps "+5" / "-5" from flipping inside RTL text
export const num = (n: number | null | undefined) => (n === null || n === undefined ? '—' : LRM + nf.format(n));
export const signed = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : LRM + (n > 0 ? `+${nf.format(n)}` : nf.format(n));
export const pct = (p: number) => `${Math.round(p * 100)}%`;

const dtf = new Intl.DateTimeFormat('he-IL', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Jerusalem' });
const tf = new Intl.DateTimeFormat('he-IL', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem' });
export const dateTime = (iso: string | null | undefined) => (iso ? dtf.format(new Date(iso)) : '—');
export const time = (iso: string | null | undefined) => (iso ? tf.format(new Date(iso)) : '—');

export const STATUS_HE: Record<RoundStatus, string> = { open: 'פתוח', paused: 'מושהה', review: 'בבקרה', closed: 'סגור' };
export const STATE_HE: Record<ItemState, string> = {
  not_counted: 'טרם נספר',
  counted: 'נספר',
  recount: 'ספירה חוזרת',
  approved: 'אושר',
};
export const CMP_HE: Record<Comparison, string> = { higher: 'גבוה מ-SAP', lower: 'נמוך מ-SAP', match: 'תואם ל-SAP' };
export const TYPE_HE: Record<string, string> = { count: 'ספירה', recount: 'ספירה חוזרת', correction: 'תיקון' };
