import { useEffect, useState } from 'react';
import type { Summary } from '../../src/export/types.ts';

type Load = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; summary: Summary };

const taipeiTime = new Intl.DateTimeFormat('zh-TW', {
  timeZone: 'Asia/Taipei',
  dateStyle: 'medium',
  timeStyle: 'short',
  hourCycle: 'h23',
});

export function App() {
  const [load, setLoad] = useState<Load>({ state: 'loading' });

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/summary.json`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<Summary>;
      })
      .then((summary) => setLoad({ state: 'ready', summary }))
      .catch((err: Error) => setLoad({ state: 'error', message: err.message }));
  }, []);

  return (
    <main>
      <h1>1960 首班車紀錄</h1>
      <p className="lede">記錄大有巴士 1960 往機場方向平日首班車的實際發車時間，以及各站的到站時間。</p>
      {load.state === 'loading' && <p>載入中⋯</p>}
      {load.state === 'error' && <p className="error">資料載入失敗（{load.message}）</p>}
      {load.state === 'ready' && <Status summary={load.summary} />}
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
        <dt>最後更新</dt>
        <dd>{summary.lastUpdatedAt ? taipeiTime.format(new Date(summary.lastUpdatedAt)) : '尚無資料'}</dd>
      </div>
    </dl>
  );
}
