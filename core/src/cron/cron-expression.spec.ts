import { nextCronRun, parseCron } from './cron-expression';

describe('cron expressions', () => {
  it('parses valid expressions and rejects bad ones', () => {
    expect(parseCron('*/15 9-17 * * 1-5')).not.toBeNull();
    expect(parseCron('0 9 * * *')).not.toBeNull();
    expect(parseCron('0 0 1,15 * *')).not.toBeNull();
    expect(parseCron('bad')).toBeNull();
    expect(parseCron('* * * *')).toBeNull();
    expect(parseCron('60 * * * *')).toBeNull();
    expect(parseCron('* 24 * * *')).toBeNull();
    expect(parseCron('*/0 * * * *')).toBeNull();
  });

  it('computes the next run at minute resolution', () => {
    const from = new Date('2026-10-09T08:00:00');
    const next = nextCronRun('30 9 * * *', from);
    expect(next?.getHours()).toBe(9);
    expect(next?.getMinutes()).toBe(30);
    expect(next?.getDate()).toBe(9);
  });

  it('honours steps', () => {
    const next = nextCronRun('*/15 * * * *', new Date('2026-10-09T08:07:00'));
    expect(next?.getMinutes()).toBe(15);
    expect(next?.getHours()).toBe(8);
  });

  it('rolls to the next day when today is past', () => {
    const next = nextCronRun('0 6 * * *', new Date('2026-10-09T08:00:00'));
    expect(next?.getHours()).toBe(6);
    expect(next?.getDate()).toBe(10);
  });
});
