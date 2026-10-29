const taipeiFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Taipei',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export type TaipeiParts = { date: string; month: string; hhmm: string };

export function taipeiParts(d: Date): TaipeiParts {
  const p = Object.fromEntries(taipeiFormat.formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, month: `${p.year}-${p.month}`, hhmm: `${p.hour}:${p.minute}` };
}

export function taipeiIso(d: Date): string {
  const shifted = new Date(d.getTime() + 8 * 3600_000);
  return shifted.toISOString().replace('Z', '+08:00');
}
