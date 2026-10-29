# TDX API 測試紀錄

記錄每一次對 TDX API 的實際呼叫，包含目的、請求內容、結果與額度花費。

- 原始回傳內容存放於 `docs/api-tests/{測試日期}/`，未經任何修改。
- 回傳內容不含憑證或 Access Token。
- 欄位意思見 [TDX_API.md](TDX_API.md)。

## 額度使用累計

| 月份 | 基礎服務次數 | 歷史服務次數 | 歷史服務資料量 | 備註 |
|---|---|---|---|---|
| 2026-10 | 6 | 1 | 1.96MB（壓縮後 163KB） | 另取 Token 3 次，不計入資料 API |

TDX 會員中心於每日凌晨結算前一日用量，實際扣點以會員中心為準。

本表只記錄開發期間的測試。收集器每次呼叫都會自動寫入 `data/usage/{來源}/{月份}.jsonl` 額度帳本，正式收集的用量以帳本為準。

---

## 2026-10-29

### 測試 1：即時 API 與靜態資料

**時間：** 2026-10-29 19:47:56（台灣時間）  
**目的：** 確認認證可用、1960 的路線與站序，以及即時 A1、A2 的實際內容。  
**花費：** 基礎服務 4 次，取 Token 1 次。

| 請求 | HTTP | 回傳大小 | 傳輸大小 | 原始檔案 |
|---|---|---|---|---|
| Token | 200 | | | 不保存 |
| `GET /api/basic/v2/Bus/Route/InterCity?$filter=RouteName/Zh_tw eq '1960'&$format=JSON` | 200 | 1,610 bytes | 722 bytes | [route.json](api-tests/2026-10-29/route.json) |
| `GET /api/basic/v2/Bus/StopOfRoute/InterCity?$filter=RouteName/Zh_tw eq '1960'&$format=JSON` | 200 | 5,595 bytes | 1,556 bytes | [stopOfRoute.json](api-tests/2026-10-29/stopOfRoute.json) |
| `GET /api/basic/v2/Bus/RealTimeByFrequency/InterCity?$filter=RouteName/Zh_tw eq '1960'&$format=JSON` | 200 | 1,162 bytes | 434 bytes | [a1.json](api-tests/2026-10-29/a1.json) |
| `GET /api/basic/v2/Bus/RealTimeNearStop/InterCity?$filter=RouteName/Zh_tw eq '1960'&$format=JSON` | 200 | 1,335 bytes | 536 bytes | [a2.json](api-tests/2026-10-29/a2.json) |

**結果：**

- Token 有效期 86,400 秒（24 小時）。
- 1960 的 RouteUID 為 `THB1960`；往機場方向為 `Direction 0`（`THB196001`），共 6 站，先到第二航廈再到第一航廈。
- 第一航廈為 `THB295119`。
- 當時有 2 台車在線上，A1、A2 各回傳 2 筆，每台車一筆。
- A2 含 `TripStartTime`，`TripStartTimeType` 為 0（實際發車時間）。
- 即時資料的時間欄位為台灣時間（`+08:00`）。
- 頻率限制為每分鐘 5 次，取 Token 不計入。
- Route 資料中 1960 的 `FirstBusTime` 為 `null`。

### 測試 2：歷史 A2 是否支援路線篩選

**時間：** 2026-10-29 22:30:59（台灣時間）  
**目的：** 歷史 API 規格沒有列出 `$filter`。測試它實際上是否能以路線篩選，若可以，歷史回填才可能在免費額度內完成。  
**花費：** 歷史服務 1 次，資料量 1.96MB（壓縮後 163KB），取 Token 1 次。

**請求：**

```
GET https://tdx.transportdata.tw/api/historical/v2/Historical/Bus/RealTimeNearStop/InterCity
    ?Dates=2026-10-28
    &$format=JSONL
    &$top=3000
    &$filter=RouteUID eq 'THB1960'
```

`$top=3000` 的理由：一次呼叫的成本等於 2MB 資料量，一筆 A2 約 650 bytes，3,000 筆約 2MB，可以充分利用這次呼叫。

| 項目 | 值 |
|---|---|
| HTTP | 200 |
| 回傳筆數 | 3,000 筆（達到 `$top` 上限） |
| 回傳大小 | 1,964,680 bytes |
| 傳輸大小 | 162,731 bytes（gzip） |
| 回應時間 | 1,737ms |
| Content-Type | `text/ndjson; charset=utf-8` |
| Content-Disposition | `inline; filename=v2-Historical-Bus-RealTimeNearStop-InterCity-20261028.jsonl` |
| 原始檔案 | [historical-a2-2026-10-28.jsonl](api-tests/2026-10-29/historical-a2-2026-10-28.jsonl) |
| 回應標頭 | [historical-a2-2026-10-28.meta.json](api-tests/2026-10-29/historical-a2-2026-10-28.meta.json) |

**回傳內容的路線分布：**

| RouteUID | 筆數 |
|---|---|
| THB0968 | 89 |
| THB1031 | 461 |
| THB1032 | 471 |
| THB1061 | 1,107 |
| THB1062 | 872 |
| **THB1960** | **0** |

**結果：**

1. **`$filter` 被忽略**。沒有回傳錯誤，但完全沒有套用篩選，回傳的 3,000 筆中沒有任何 1960 的資料。
2. **資料依 RouteUID 排序**，每條路線的資料連續排列。從檔名看來，伺服器是回傳一份預先產生的全日檔案，`$top` 只是從開頭截斷。
3. 歷史 API 不支援 `$skip`，所以**無法跳過排在前面的路線**。要取得 1960，必須把排在它之前的所有路線一起下載。
4. 這 5 條路線就佔了約 2MB。1960 排在許多 1xxx 路線之後，取得一天的 1960 資料所需的下載量，推估會遠超過每月免費額度的 60MB。
5. **歷史資料的時間欄位是 UTC（`+00:00`）**，與即時資料的台灣時間（`+08:00`）不同，處理時必須轉換時區。
6. 檔案開頭有 UTF-8 BOM（`EF BB BF`），解析第一行前需要移除。
7. 欄位與即時 A2 相同，含 `UpdateTime`。

**結論：在免費額度內，無法透過歷史 A2 API 回填 1960 的資料。** 歷史 A1 的資料量比 A2 更大，同樣不可行。

### 測試 3：以 cron 執行收集器（單次輪詢）

**時間：** 2026-10-29 23:09:01（台灣時間）  
**目的：** 驗證 cron 排程、執行環境（node 路徑、工作目錄、`.env` 讀取）、log 寫入、原始資料保存與額度帳本，整條流程能在真實 API 上跑通。  
**花費：** 基礎服務 2 次，取 Token 1 次。

**作法：** 暫時加入一行 cron，在 23:09 執行 `node src/cli/collect.ts --once`，輸出寫入 `logs/collect.log`。執行完畢後已移除這行臨時排程，只保留每日 04:40 的正式排程。

| 請求 | HTTP | 回傳大小 | 原始檔案 |
|---|---|---|---|
| Token | 200 | | 不保存 |
| `GET /api/basic/v2/Bus/RealTimeNearStop/InterCity?$filter=RouteName/Zh_tw eq '1960'&$format=JSON` | 200 | 1,369 bytes | `data/raw/mac-mini/2026-10-29/a2.jsonl` |
| `GET /api/basic/v2/Bus/RealTimeByFrequency/InterCity?$filter=RouteName/Zh_tw eq '1960'&$format=JSON` | 200 | 1,156 bytes | `data/raw/mac-mini/2026-10-29/a1.jsonl` |

**結果：**

- cron 正常觸發，log 正確寫入，`.env` 正確讀取。
- 原始回傳完整保存於 `data/raw/mac-mini/2026-10-29/`，執行摘要寫入同目錄的 `runs.jsonl`。
- 額度帳本 `data/usage/mac-mini/2026-10.jsonl` 正確記錄 3 筆（Token 1 筆、基礎服務 2 筆）。
- 首班車判斷邏輯選中 23:06:27 發車的 KKA-3258。測試時段不是清晨，所以選中的是當時最早發車的往機場班次，符合預期。
- **新發現：** KKA-3258 在市府轉運站的離站事件 `GPSTime` 為 `23:06:27`，與 `TripStartTime` 完全相同，`TripStartTimeType` 為 0。這顯示 `TripStartTime` 就是車輛實際離開首站的時間。
