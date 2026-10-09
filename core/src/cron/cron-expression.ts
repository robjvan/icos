/**
 * M17d cron expressions: a minimal 5-field parser (minute hour dom month dow).
 * Supports star, exact values, ranges (a-b), lists (a,b), and steps
 * (star-slash-n, a-b/n). `dom` and `dow` are combined with AND (both must
 * match); most schedules leave one as star, so the distinction rarely matters.
 */

export interface CronFields {
  minute: number[];
  hour: number[];
  dom: number[];
  month: number[];
  dow: number[];
}

const MAX_MINUTES_AHEAD = 366 * 24 * 60;

export function parseCron(expr: string): CronFields | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const minute = parseField(parts[0], 0, 59);
  const hour = parseField(parts[1], 0, 23);
  const dom = parseField(parts[2], 1, 31);
  const month = parseField(parts[3], 1, 12);
  const dow = parseField(parts[4], 0, 6);
  if (!minute || !hour || !dom || !month || !dow) return null;
  return { minute, hour, dom, month, dow };
}

function parseField(field: string, min: number, max: number): number[] | null {
  const values = new Set<number>();
  for (const part of field.split(',')) {
    if (part === '') return null;
    const slash = part.indexOf('/');
    const range = slash === -1 ? part : part.slice(0, slash);
    const step = slash === -1 ? 1 : Number(part.slice(slash + 1));
    if (!Number.isInteger(step) || step < 1) return null;
    let start = min;
    let end = max;
    if (range !== '*') {
      const dash = range.indexOf('-');
      const startNum = Number(dash === -1 ? range : range.slice(0, dash));
      if (!Number.isInteger(startNum) || startNum < min || startNum > max) {
        return null;
      }
      start = startNum;
      if (dash !== -1) {
        const endNum = Number(range.slice(dash + 1));
        if (!Number.isInteger(endNum) || endNum < start || endNum > max) {
          return null;
        }
        end = endNum;
      } else {
        end = startNum;
      }
    }
    for (let value = start; value <= end; value += step) values.add(value);
  }
  return values.size > 0 ? [...values].sort((a, b) => a - b) : null;
}

/** The next minute the expression fires at or after `from`, or null. */
export function nextCronRun(expr: string, from: Date): Date | null {
  const fields = parseCron(expr);
  if (!fields) return null;
  const candidate = new Date(from.getTime());
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);
  for (let i = 0; i < MAX_MINUTES_AHEAD; i++) {
    if (
      fields.minute.includes(candidate.getMinutes()) &&
      fields.hour.includes(candidate.getHours()) &&
      fields.month.includes(candidate.getMonth() + 1) &&
      fields.dom.includes(candidate.getDate()) &&
      fields.dow.includes(candidate.getDay())
    ) {
      return candidate;
    }
    candidate.setMinutes(candidate.getMinutes() + 1);
  }
  return null;
}
