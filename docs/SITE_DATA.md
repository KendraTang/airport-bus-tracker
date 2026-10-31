# 網站資料格式

網站讀取的 JSON 由 `npm run export` 從 repo 內的原始資料產生，輸出到 `web/public/data/`，不進 repo。型別定義在 `src/export/types.ts`，網站與匯出程式共用。

所有時間都是台灣時間（`Asia/Taipei`）。

## summary.json

收集狀態。

| 欄位 | 說明 |
|---|---|
| `collectedDates` | 有首班車收集紀錄（`mode` 為 `daily`）的日期，新的在前 |
| `fullDayDates` | 有全天來回紀錄的日期，新的在前 |
| `testRuns` | 測試執行（`--once`）的次數，不算在收集天數內 |
| `lastUpdatedAt` | 所有執行紀錄中最晚的結束時間；還沒有任何紀錄時為 `null` |

## first-trips.json

每天往機場方向的首班車，由當天收集到的 A2 事件重建。首班車的判斷規則與收集器相同：當天首站發車、發車時間不早於 04:30 的班次中，最早的那一趟。

```json
{
  "stops": [{ "seq": 1, "stopUID": "THB289789", "name": "市府轉運站" }],
  "days": [
    {
      "date": "2026-10-31",
      "weekday": "六",
      "plate": "KKB-2179",
      "stopTimes": [
        { "arrival": null, "departure": { "state": "observed", "time": "04:42" } },
        { "arrival": { "state": "interval", "lower": "04:58", "upper": "05:34" }, "departure": { "state": "observed", "time": "05:34" } }
      ]
    }
  ]
}
```

| 欄位 | 說明 |
|---|---|
| `stops` | 往機場方向的站，依站序排列 |
| `days` | 一天一筆，新的在前 |
| `days[].weekday` | 星期，`日` 到 `六`。國定假日尚未納入判斷 |
| `days[].plate` | 首班車的車牌；當天紀錄中找不到首班車時為 `null`，各站時間都是 `missing` |
| `days[].stopTimes` | 與 `stops` 一一對應。`arrival` 為到站時間，在首站為 `null`；`departure` 為離站時間，在終點站為 `null` |

時間精度：A2 的事件時間到秒，這裡捨去秒數，只顯示到分鐘，與時鐘的讀法相同。

### 每個時間的可信度（`state`）

| `state` | 欄位 | 說明 |
|---|---|---|
| `observed` | `time` | 有 A2 事件 |
| `interval` | `lower`、`upper` | 沒有事件，只知道範圍；上下限任一側可以是 `null` |
| `estimated` | `time`、`lower`、`upper` | 沒有事件，依其他天同一段的典型時間（中位數）推算，並限制在範圍內 |
| `missing` | 無 | 沒有事件，也夾不出範圍 |
| `not_arrived_by_cutoff` | `lower`、`cutoff` | 收集在 `cutoff` 結束（安全上限、停滯或額度不足）前，沒有看到車輛到這一站；`lower` 為這台車在這之前的最後一筆紀錄 |

範圍的來源：

- 下限是同一趟前一個有紀錄的事件。
- 上限是同一趟後一個有紀錄的事件。到站沒有紀錄時，同一站的離站時間就是上限。
- 班次後段沒有紀錄時，以同一台車離開終點站的事件，或它下一趟的第一筆紀錄為上限。

推算用的典型時間，只取各天首班車都有紀錄的相鄰兩個事件；沒有任何一天有紀錄的段落，就只顯示範圍。

## app-driving-log.json

收集器上線前，從第三方 App 抄錄的首班車紀錄，格式見 `src/export/types.ts` 的 `ExternalLog`，來源說明見 `docs/APP_DRIVING_LOG.md`。時間的可信度與 `first-trips.json` 相同，但不會有 `not_arrived_by_cutoff`。
