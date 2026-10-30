import { useEffect, useState } from 'react';
import type { ExternalLog, StopTime, Summary } from '../../src/export/types.ts';

interface SiteData {
  summary: Summary;
  appLog: ExternalLog | null;
}

type Load = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; data: SiteData };

const taipeiTime = new Intl.DateTimeFormat('zh-TW', {
  timeZone: 'Asia/Taipei',
  dateStyle: 'medium',
  timeStyle: 'short',
  hourCycle: 'h23',
});

async function fetchJson<T>(name: string): Promise<T> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/${name}`);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export function App() {
  const [load, setLoad] = useState<Load>({ state: 'loading' });

  useEffect(() => {
    Promise.all([fetchJson<Summary>('summary.json'), fetchJson<ExternalLog | null>('app-driving-log.json')])
      .then(([summary, appLog]) => setLoad({ state: 'ready', data: { summary, appLog } }))
      .catch((err: Error) => setLoad({ state: 'error', message: err.message }));
  }, []);

  return (
    <main>
      <h1>1960 首班車紀錄</h1>
      <p className="lede">記錄大有巴士 1960 往機場方向平日首班車的實際發車時間，以及各站的到站時間。</p>
      {load.state === 'loading' && <p>載入中⋯</p>}
      {load.state === 'error' && <p className="error">資料載入失敗（{load.message}）</p>}
      {load.state === 'ready' && (
        <>
          <Status summary={load.data.summary} />
          {load.data.appLog && <AppDrivingLog log={load.data.appLog} />}
        </>
      )}
    </main>
  );
}

function Status({ summary }: { summary: Summary }) {
  return (
    <dl className="status">
      <div>
        <dt>已收集</dt>
        <dd>
          {summary.collectedDates.length} 天
          {summary.collectedDates.length === 0 && <span className="note">（尚無正式收集資料）</span>}
        </dd>
      </div>
      <div>
        <dt>全天來回紀錄</dt>
        <dd>
          {summary.fullDayDates.length} 天
          <span className="note">（每 6 天一次，記錄全天所有班次）</span>
        </dd>
      </div>
      <div>
        <dt>最後更新</dt>
        <dd>{summary.lastUpdatedAt ? taipeiTime.format(new Date(summary.lastUpdatedAt)) : '尚無資料'}</dd>
      </div>
    </dl>
  );
}

function AppDrivingLog({ log }: { log: ExternalLog }) {
  const first = log.trips.filter((t) => t.rank === 1);
  const second = log.trips.filter((t) => t.rank === 2);
  const { start, end } = { start: first.at(-1)?.date, end: first[0]?.date };
  return (
    <section>
      <h2>收集器上線前的紀錄（第三方 App）</h2>
      <p className="note">
        {start && end && `${shortDate(start)} 至 ${shortDate(end)}，`}
        抄錄自「{log.source.app}」的行車紀錄，非本專案收集。App 未區分進站與離站，精度到分鐘，也未標示資料來源。
      </p>
      <h3>往機場方向首班車</h3>
      <TripTable stops={log.stops} trips={first} />
      {second.length > 0 && (
        <details>
          <summary>往機場方向第二班</summary>
          <p className="note">10/23 與 10/24 的紀錄稀疏，清單上的第二班不一定是當天實際的第二班車。</p>
          <TripTable stops={log.stops} trips={second} />
        </details>
      )}
      <Legend />
    </section>
  );
}

function TripTable({ stops, trips }: { stops: ExternalLog['stops']; trips: ExternalLog['trips'] }) {
  return (
    <div className="table-scroll">
      <table className="trips">
        <thead>
          <tr>
            <th>日期</th>
            <th>車牌</th>
            {stops.map((s) => (
              <th key={s.stopUID}>{s.name.replace('桃園機場', '')}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {trips.map((trip) => (
            <tr key={`${trip.date}-${trip.rank}`} className={trip.weekday === '六' || trip.weekday === '日' ? 'weekend' : undefined}>
              <td>
                {shortDate(trip.date)}（{trip.weekday}）
              </td>
              <td>{trip.plate}</td>
              {trip.stopTimes.map((st, i) => (
                <td key={stops[i]!.stopUID}>
                  <StopTimeCell value={st} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StopTimeCell({ value }: { value: StopTime }) {
  switch (value.state) {
    case 'observed':
      return <span>{value.time}</span>;
    case 'estimated':
      return (
        <span className="estimated" title={`推算值，範圍 ${range(value.lower, value.upper)}`}>
          ≈{value.time}
          <small>{range(value.lower, value.upper)}</small>
        </span>
      );
    case 'interval':
      return <span className="interval">{range(value.lower, value.upper)}</span>;
    case 'missing':
      return <span className="missing">—</span>;
  }
}

function Legend() {
  return (
    <dl className="legend">
      <div>
        <dt>05:39</dt>
        <dd>有紀錄的時間</dd>
      </div>
      <div>
        <dt className="estimated">≈05:37</dt>
        <dd>沒有紀錄，依其他天的站間時間推算；下方為前後紀錄夾出的範圍</dd>
      </div>
      <div>
        <dt className="interval">05:33–05:54</dt>
        <dd>沒有紀錄，只知道範圍</dd>
      </div>
      <div>
        <dt className="missing">—</dt>
        <dd>沒有紀錄，也無法推算</dd>
      </div>
      <div>
        <dt className="weekend-swatch">週六日</dt>
        <dd>以底色標示；國定假日尚未納入判斷</dd>
      </div>
    </dl>
  );
}

function range(lower: string | null, upper: string | null): string {
  if (lower && upper) return `${lower}–${upper}`;
  if (upper) return `≤${upper}`;
  if (lower) return `≥${lower}`;
  return '';
}

function shortDate(date: string): string {
  const [, m, d] = date.split('-');
  return `${Number(m)}/${Number(d)}`;
}
