# TDX API 與欄位說明

本文件記錄本專案使用的 TDX API、各 API 能取得的資料，以及每個欄位的意思。

**最後更新：** 2026-10-30

每項資訊都標註來源：

- **【規格】**：TDX 官方 OpenAPI 規格。
- **【指引】**：TDX 資料使用指引（公車動態資料注意事項）。
- **【實測】**：對 1960 的實際查詢結果（2026-10-29 起），以及與會員中心用量紀錄的對照。
- **【推論】**：依上述資料推得，尚未直接驗證。

---

## 1. 總覽

### 1.1 本專案使用的 API

| 用途 | API | 服務類別 | 每點次數 | 狀態 |
|---|---|---|---|---|
| 路線資訊 | Route | 基礎 | 1,500 次 | 已實測 |
| 站牌與站序 | StopOfRoute | 基礎 | 1,500 次 | 已實測 |
| **車輛進離站事件（主要資料）** | RealTimeNearStop（A2） | 基礎 | 1,500 次 | 已實測 |
| 車輛 GPS 位置（備援） | RealTimeByFrequency（A1） | 基礎 | 1,500 次 | 已實測 |
| 班表與首班車時間 | Schedule、DailyTimeTable、FirstLastTripInfo | 基礎 | 1,500 次 | 未實測 |
| 歷史進離站事件 | Historical RealTimeNearStop（A2） | 歷史 | **10 次** | 已實測，**免費額度內不可行**（見第 6 節） |
| 歷史 GPS 位置 | Historical RealTimeByFrequency（A1） | 歷史 | **10 次** | 未實測，資料量大於 A2，同樣不可行 |

### 1.2 不使用的 API

| API | 不使用的原因 |
|---|---|
| EstimatedTimeOfArrival（N1） | 預估到站時間，不能當作實際時間，而且會消耗額度。 |
| 各 API 的 Streaming（逐筆更新）版本 | 以 UDP 傳輸，資料可能遺失【指引】。本專案用每分鐘輪詢，批次版本已足夠。 |
| S2STravelTime | 站間預估行駛時間，屬於統計估計值，不是實際觀測。 |

---

## 2. 共通事項

### 2.1 網址與認證

| 項目 | 值 |
|---|---|
| 取得 Token | `POST https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token` |
| 基礎服務 | `https://tdx.transportdata.tw/api/basic` |
| 歷史服務 | `https://tdx.transportdata.tw/api/historical` |

- 取得 Token 時使用 `grant_type=client_credentials`，帶入 `client_id` 與 `client_secret`。
- Token 有效期為 86,400 秒，也就是 24 小時【實測】。
- 呼叫資料 API 時帶入 `Authorization: Bearer {token}` 標頭。

### 2.2 常用查詢參數（基礎服務）

| 參數 | 說明 | 本專案用法 |
|---|---|---|
| `{RouteName}`（路徑參數） | 路線名稱 | 可直接用 `/InterCity/1960` |
| `$filter` | OData 篩選條件 | `RouteName/Zh_tw eq '1960'` |
| `$select` | 只取部分欄位 | 不使用，原始資料完整保存 |
| `$format` | 回傳格式 | `JSON` |

**注意：歷史服務不支援 `$filter`**，見第 6 節。

### 2.3 頻率限制【實測】

每次回應都會附上以下標頭，程式可以據此節流：

| 標頭 | 意思 | 實測值 |
|---|---|---|
| `x-ratelimit-limit-minute` | 每分鐘上限 | 5 |
| `x-ratelimit-remaining-minute` | 本分鐘剩餘次數 | 依序為 4、3、2、1 |
| `ratelimit-reset` | 幾秒後重置 | 3 到 4 |

取得 Token 的呼叫不計入資料 API 的頻率限制【實測】。

### 2.4 回傳大小【實測】

以 1960 篩選時，伺服器以 gzip 壓縮傳輸：

| API | 解壓後 | 傳輸大小 |
|---|---|---|
| Route | 1,610 bytes | 722 bytes |
| StopOfRoute | 5,595 bytes | 1,556 bytes |
| A1（2 台車） | 1,162 bytes | 434 bytes |
| A2（2 台車） | 1,335 bytes | 536 bytes |

每次測試的完整紀錄見 [API_TEST_LOG.md](API_TEST_LOG.md)。

### 2.4.1 計費方式【實測】

以 2026-10-29 的實際呼叫，對照會員中心隔日結算的用量：

| 服務 | 次數 | 會員中心的資料量 | 會員中心的點數 |
|---|---|---|---|
| 基礎服務 | 6 | 4 KB | 0.004 |
| 歷史服務 | 1 | 159 KB | 0.108 |
| 合計 | 7 | 163 KB | 0.112 |

由此確認：

- **次數與資料量分別換算點數後相加**，不是擇一扣點。歷史服務 1 次換算 0.1 點，159 KB ÷ 20MB 約 0.008 點，合計 0.108 點；若是取較大者，會是 0.1 點。
- **資料量以壓縮後的傳輸量計算。** 該次歷史 A2 解壓後為 1,964,680 bytes，gzip 傳輸為 162,731 bytes（約 159 KB），會員中心記錄的是後者。
- 取得 Token 不計入次數。
- 會員中心以日為單位結算，隔日才看得到前一日的用量。

本專案的額度帳本記錄的是解壓後的大小，因此估算的點數會比會員中心高。即時 A2、A1 每次只有約 1KB，點數幾乎全部來自次數，兩者差距可以忽略；只有歷史服務這類大檔案會明顯高估。帳本高估只會讓收集器提早停止，不會超過額度，所以維持這個保守的算法。

### 2.5 共通欄位

以下欄位在多個 API 中重複出現，意思相同【規格】：

| 欄位 | 意思 | 1960 的值【實測】 |
|---|---|---|
| `RouteUID` | 路線唯一識別碼，規則為「業管機關簡碼 + RouteID」 | `THB1960` |
| `RouteID` | 業者使用的路線代碼 | `1960` |
| `RouteName` | 路線名稱，含 `Zh_tw`、`En` 等語言 | `1960` |
| `SubRouteUID` | 子路線唯一識別碼 | 往機場 `THB196001`；往市區 `THB196002` |
| `SubRouteID` | 業者使用的子路線代碼 | `196001`、`196002` |
| `Direction` | 去返程：0 去程、1 返程、2 迴圈、10 循環線、255 未知 | 往機場為 0，往市區為 1 |
| `StopUID` | 站牌唯一識別碼，規則為「業管機關簡碼 + StopID」 | 見 3.2 節 |
| `StopSequence` | 路線經過站牌的順序 | 往機場方向 1 到 6 |
| `OperatorID` | 營運業者代碼 | `49`（大有巴士） |
| `OperatorNo` | 交通部票證系統定義的業者編號 | `0302` |
| `UpdateTime` | TDX 平台的資料更新時間 | |
| `VersionID` | 靜態資料的版本號 | Route 為 `7921` |

**本專案一律以 `StopUID` 比對站牌，不以站名比對。**

### 2.6 時間欄位的差異

動態資料（A1、A2）有多個時間欄位，代表資料流經的不同階段【規格】：

| 欄位 | 意思 | 1960 是否提供【實測】 |
|---|---|---|
| `GPSTime` | **車機時間**，A2 中代表「觸發進離站事件的 GPS 時間」 | 有 |
| `TransTime` | 車機資料傳輸時間，多數單位不提供 | 無 |
| `SrcRecTime` | 來源平台（公路局）接收時間 | 有 |
| `SrcTransTime` | 來源平台資料傳出時間，只有公路局系統提供 | 有 |
| `SrcUpdateTime` | 來源平台資料更新時間，只有非公路局系統提供 | 無 |
| `UpdateTime` | TDX 平台資料更新時間 | 有 |

**本專案以 `GPSTime` 作為事件發生時間。** 注意事項：

- `GPSTime` 是車上設備的時鐘。若來源端沒有校時，可能出現時間順序錯亂【指引】。
- 實測中 `GPSTime` 到 `UpdateTime` 約延遲 6 秒，例如 `19:43:44` 發生的事件，TDX 於 `19:43:50` 更新【實測】。指引寫批次更新延遲約 60 秒，實際延遲可能因時段而異。

---

## 3. 靜態資料

### 3.1 Route：路線資訊

```
GET /api/basic/v2/Bus/Route/InterCity/{RouteName}
```

| 欄位 | 意思 | 1960 的值【實測】 |
|---|---|---|
| `BusRouteType` | 路線類別：11 市區公車、12 公路客運、13 國道客運、14 接駁車 | 13（國道客運） |
| `HasSubRoutes` | 是否有多條子路線 | `true` |
| `AuthorityID` | 業管機關代碼 | `010` |
| `Operators[]` | 營運業者清單，含 `OperatorID`、`OperatorName` | 大有巴士 |
| `DepartureStopNameZh` | 起站名稱 | 市府轉運站 |
| `DestinationStopNameZh` | 終點站名稱 | 桃園機場第一航廈 |
| `SubRoutes[]` | 子路線清單，見下表 | |

`SubRoutes[]` 內的欄位：

| 欄位 | 意思 | 1960 的值【實測】 |
|---|---|---|
| `Headsign` | 車頭顯示文字 | 往機場為「臺北市→臺灣桃園國際機場」 |
| `FirstBusTime` | 平日第一班發車時間 | **`null`，未提供** |
| `LastBusTime` | 規格寫「平日返程第一班發車時間」，命名與說明不一致 | `null` |
| `HolidayFirstBusTime` | 假日去程第一班發車時間 | `null` |

1960 的 Route 資料沒有提供首班車時間，首班車資訊需改用第 5 節的班表 API 查詢。

### 3.2 StopOfRoute：站牌與站序

```
GET /api/basic/v2/Bus/StopOfRoute/InterCity/{RouteName}
```

每個子路線（每個方向）一筆，內含 `Stops[]`：

| 欄位 | 意思 |
|---|---|
| `StopUID`、`StopID` | 站牌識別碼 |
| `StopName` | 站牌名稱 |
| `StopSequence` | 站序，從 1 開始 |
| `StopBoarding` | 上下車限制：-1 只能下車、0 可上下車、1 只能上車 |
| `StopPosition` | 站牌座標（WGS84 經緯度與 GeoHash），可用於 A1 位置推算 |
| `StationID` | 站牌所屬的站位 ID |

**1960 往機場方向（`Direction 0`，`SubRouteUID THB196001`）【實測】：**

| 站序 | 站名 | StopUID | 上下車 | 緯度 | 經度 |
|---|---|---|---|---|---|
| 1 | 市府轉運站 | `THB289789` | 只能上車 | 25.040448 | 121.564772 |
| 2 | 台北君悅酒店 | `THB256678` | 只能上車 | 25.03531 | 121.56335 |
| 3 | 遠東國際飯店 | `THB258650` | 只能上車 | 25.0266546 | 121.5489483 |
| 4 | 福華飯店 | `THB255379` | 只能上車 | 25.03731 | 121.54354 |
| 5 | 桃園機場第二航廈 | `THB301065` | 只能下車 | 25.07809 | 121.232575 |
| 6 | **桃園機場第一航廈** | `THB295119` | 只能下車 | 25.08279 | 121.2377 |

往市區方向（`Direction 1`）有 9 站，站序與往機場方向不對稱。兩個方向的同名站牌，StopUID 可能相同也可能不同，例如福華飯店兩個方向都是 `THB255379`，但台北君悅酒店往市區方向是 `THB253592`。

---

## 4. 即時動態資料

### 4.1 共通行為【指引】

- TDX 對公路局（公總）的 A1、A2 **只保留每台車的最新一筆**。
- 平台**只保留最近兩小時**的資料。
- A2 為不定期更新，只有車輛進站或離站時才會產生新事件。站距長的路段，A2 更新會較慢。

### 4.2 A2：RealTimeNearStop（車輛定點資料）

```
GET /api/basic/v2/Bus/RealTimeNearStop/InterCity/{RouteName}
```

**本專案的主要資料來源。** 車輛每次進站或離站時產生一個事件。

| 欄位 | 意思【規格】 | 本專案用途 |
|---|---|---|
| `PlateNumb` | 車牌號碼 | 區分不同車輛 |
| `SubRouteUID`、`Direction` | 子路線與方向 | 只取 `Direction 0`（往機場） |
| `StopUID`、`StopName`、`StopSequence` | 事件發生的站牌 | 對應到各站的到站與離站時間 |
| `A2EventType` | **0 離站、1 進站** | 區分到站與離站時間 |
| `GPSTime` | 觸發進離站事件的車機時間 | **事件發生時間** |
| `TripStartTime` | 首站發車時間 | **辨識首班車** |
| `TripStartTimeType` | 發車時間類型：**0 實際發車時間、1 預估發車時間、2 無法推估** | 判斷 `TripStartTime` 的可信度 |
| `DutyStatus` | 勤務狀態：0 正常、1 開始、2 結束 | 參考用，見下方說明 |
| `BusStatus` | 行車狀況：0 正常、1 車禍、2 故障、3 塞車、4 緊急求援、5 加油、90 不明、91 去回不明、98 偏移路線、99 非營運狀態、100 客滿、101 包車出租、255 未知 | 標記異常狀況 |
| `MessageType` | 資料型態：0 未知、1 定期、2 非定期 | A2 為 2【實測】 |
| 時間欄位 | 見 2.6 節 | |

欄位補充：

- **`TripStartTime`**：若有實際首站發車時間就使用實際值；沒有的話，依站間行駛時間推估；兩者都沒有則無法推估【指引】。實測中兩筆都是 `TripStartTimeType 0`，也就是實際發車時間。
- **`DutyStatus`**：指引的說明是「0 通常為開機後的狀態，1 表示趟次開始，2 表示完成路線」。但實測中一台已發車、正在行駛的車輛（KKA-3258）仍顯示 0，所以**這個欄位不可靠，不用來判斷趟次**。
- **`BusStatus = 100`（客滿）**：規格中有這個值，但是否真的會回報、回報是否準確，都未經驗證。PRD 仍將客滿風險列為不納入分析。
- **`BusStatus = 99`（非營運狀態）**：此時 `DutyStatus` 會被設為 2，平台也會停止推估該車的到站時間【指引】。

**輪詢的限制【推論】：** 因為每台車只保留最新一筆事件，每分鐘查詢一次時，若同一台車在一分鐘內連續發生兩個事件，例如在第一航廈「進站」後很快「離站」，就只會看到後面那一個。本專案每分鐘查詢一次，所以：

- 第一航廈的「進站」事件有可能被「離站」事件覆蓋。
- 遇到這種情況時，以「離站」時間作為抵達時間的上限，並標記可信度。

**第一航廈進站事件的實測結果【實測】：** 2026-10-31 全天每分鐘查詢一次，往機場方向共 13 趟：

| 第一航廈的 A2 事件 | 趟數 | 班次（首站實際發車） |
|---|---|---|
| 有進站事件，之後沒有離站事件，進站事件持續顯示 20 到 43 分鐘 | 7 | 04:42、05:23、07:24、08:49、09:45、11:05、12:26 |
| 有進站事件，只顯示 1 分鐘，隨後出現離站事件 | 2 | 19:34、23:07 |
| 只有離站事件，沒有進站事件 | 1 | 16:03 |
| 完全沒有事件，第二航廈的離站事件持續顯示 39 分鐘，直到這台車開始下一趟 | 1 | 06:00 |
| 機場兩站都沒有事件（這台車的 A2 在途中就中斷） | 2 | 17:34、21:03 |

- **進站事件不一定會出現**，就算每分鐘查詢也一樣。只有離站事件時，無法分辨是被覆蓋，還是根本沒有產生。
- 首班車在 10/30 和 10/31 都有第一航廈的進站事件。
- 首班車在這兩天都**沒有第二航廈的進站事件**，只有離站事件。
- 網站的處理方式：沒有進站事件時，以同一趟在該站的離站時間為上限；連離站都沒有時，以這台車下一趟的第一筆紀錄為上限，並標示為範圍。

**實測範例**（往機場方向，車輛剛離開台北君悅酒店）：

```json
{
  "PlateNumb": "KKA-3258",
  "OperatorID": "49",
  "RouteUID": "THB1960",
  "SubRouteUID": "THB196001",
  "Direction": 0,
  "StopUID": "THB256678",
  "StopName": { "Zh_tw": "台北君悅酒店", "En": "Grand Hyatt Taipei" },
  "StopSequence": 2,
  "MessageType": 2,
  "DutyStatus": 0,
  "BusStatus": 0,
  "A2EventType": 0,
  "GPSTime": "2026-10-29T19:43:44+08:00",
  "TripStartTimeType": 0,
  "TripStartTime": "2026-10-29T19:35:21+08:00",
  "SrcRecTime": "2026-10-29T19:43:45+08:00",
  "SrcTransTime": "2026-10-29T19:43:45+08:00",
  "UpdateTime": "2026-10-29T19:43:50+08:00"
}
```

解讀：這台車 19:35:21 從市府轉運站發車，19:43:44 離開台北君悅酒店。

### 4.3 A1：RealTimeByFrequency（車輛定時資料）

```
GET /api/basic/v2/Bus/RealTimeByFrequency/InterCity/{RouteName}
```

**本專案的備援資料。** 車輛定時回報的 GPS 位置，與是否在站牌無關。當 A2 漏掉某站的事件時，用來推算車輛經過的時間。

| 欄位 | 意思【規格】 | 本專案用途 |
|---|---|---|
| `PlateNumb` | 車牌號碼 | 與 A2 對應同一台車 |
| `SubRouteUID`、`Direction` | 子路線與方向 | |
| `BusPosition` | 車輛位置：`PositionLat`、`PositionLon`（WGS84）、`GeoHash` | 與站牌座標比對距離 |
| `Speed` | 行駛速度（公里／小時） | 判斷是否停靠 |
| `Azimuth` | 方位角 | 判斷行進方向 |
| `DutyStatus`、`BusStatus` | 同 A2 | |
| `MessageType` | 資料型態 | A1 為 1（定期）【實測】 |
| `GPSTime` | 車機時間 | 位置的觀測時間 |
| 其他時間欄位 | 見 2.6 節 | |

A1 **沒有** `StopUID`、`A2EventType`、`TripStartTime`，所以無法單獨辨識首班車，必須透過車牌與 A2 對應。

**實測範例**（往機場方向，停在路上）：

```json
{
  "PlateNumb": "KKA-3258",
  "SubRouteUID": "THB196001",
  "Direction": 0,
  "BusPosition": { "PositionLon": 121.559888333333, "PositionLat": 25.0329016666667, "GeoHash": "wsqqqjj5n" },
  "Speed": 0,
  "Azimuth": 265,
  "DutyStatus": 0,
  "BusStatus": 0,
  "MessageType": 1,
  "GPSTime": "2026-10-29T19:47:44+08:00",
  "SrcRecTime": "2026-10-29T19:47:45+08:00",
  "SrcTransTime": "2026-10-29T19:47:45+08:00",
  "UpdateTime": "2026-10-29T19:47:50+08:00"
}
```

---

## 5. 班表資料（未實測）

1960 的 Route 資料沒有首班車時間，以下 API 可以補足。三者都屬於基礎服務，查詢一次即可，額度影響極小。

### 5.1 Schedule：預定班表

```
GET /api/basic/v2/Bus/Schedule/InterCity/{RouteName}
```

| 欄位 | 意思【規格】 |
|---|---|
| `Timetables[].TripID` | 班次代碼 |
| `Timetables[].ServiceDay` | 週一到週日、國定假日是否營運（0 否、1 是） |
| `Timetables[].SpecialDays` | 特殊營運日：日期、`ServiceStatus`（0 正常、1 加班、2 取消或停駛） |
| `Timetables[].StopTimes[]` | 各站的 `ArrivalTime`、`DepartureTime`（格式 `HH:mm`） |
| `Frequencys[]` | 班距式時刻表：起訖時間、最小與最大班距 |

### 5.2 DailyTimeTable：每日營運時刻表

```
GET /api/basic/v2/Bus/DailyTimeTable/InterCity/{RouteName}
```

與 Schedule 類似，但以日期（`BusDate`）為單位。`StopTimes[].TimeType` 標示時間類型：**0 估算時間、1 表訂時間**。可用來確認某一天的首班車是否有營運。

### 5.3 FirstLastTripInfo：首末班車

```
GET /api/basic/v2/Bus/FirstLastTripInfo/InterCity
```

| 欄位 | 意思【規格】 |
|---|---|
| `FirstLastTrips[].FirstTripDepTime` | 頭班車發車時間（`HH:mm`） |
| `FirstLastTrips[].LastTripDepTime` | 末班車發車時間 |
| `FirstLastTrips[].ServiceDay` | 適用日型態，含國定假日、假日前後一日、颱風假 |

此 API 沒有 `{RouteName}` 路徑參數，需搭配 `$filter` 篩選 1960。

---

## 6. 歷史資料

### 6.1 歷史 A2、A1【規格】

```
GET /api/historical/v2/Historical/Bus/RealTimeNearStop/InterCity
GET /api/historical/v2/Historical/Bus/RealTimeByFrequency/InterCity
```

| 參數 | 說明 |
|---|---|
| `Dates`（必填） | 查詢日期，格式 `yyyy-MM-dd`。可用逗號列出多日、用 `~` 表示區間，**一次最多 7 天** |
| `$format`（必填） | `JSONL` 或 `CSV`（不支援 JSON） |
| `$top` | 取前幾筆，預設 30 |
| `Meta` | 設為 `true` 時回傳這個 API 的統計資訊 |

- 資料範圍：2021 年 6 月至昨天，**每天早上 8 點更新前一天的資料**。
- 計費：每 10 次 1 點，加上每 20MB 傳輸量（壓縮後）1 點，兩者相加（見 2.4.1 節）。
- 回傳欄位與即時 A2、A1 相同（見第 4 節）。
- `Meta=true` 會回傳 HTTP 249 與「統計資訊」，但規格沒有定義內容。
- 整份歷史服務規格中沒有任何 `$filter` 參數，也沒有 `$skip`。

### 6.2 實測結果【實測】

2026-10-29 以 `$filter=RouteUID eq 'THB1960'`、`$top=3000` 查詢 10/28 的歷史 A2，詳見 [API_TEST_LOG.md](API_TEST_LOG.md) 測試 2：

- **`$filter` 被忽略**，回傳的 3,000 筆中沒有 1960。
- 資料**依 RouteUID 排序**，伺服器回傳預先產生的全日檔案，`$top` 只從開頭截斷。
- 不支援 `$skip`，無法跳過排在 1960 之前的路線。
- 前 5 條路線就佔約 2MB，取得 1960 所需的下載量推估遠超過每月免費額度的 60MB。
- **時間欄位為 UTC（`+00:00`）**，與即時資料的台灣時間不同。
- 檔案開頭有 UTF-8 BOM。

**結論：在免費額度內，無法透過歷史 API 回填 1960 的資料。** 會員中心的「歷史資料申請」（以檔案訂購）是否有以路線為單位的選項，尚待確認。

---

## 7. 對本專案的影響

| 項目 | 結論 |
|---|---|
| 首班車辨識 | 用 A2 的 `TripStartTime` 搭配 `TripStartTimeType`，不用 `DutyStatus` |
| 事件時間 | 用 A2 的 `GPSTime`，查詢時間只作為收集紀錄 |
| 到站與離站 | 用 `A2EventType` 區分：0 離站、1 進站 |
| 站牌比對 | 用 `StopUID`，站序與代碼見 3.2 節 |
| 上車站的時間 | 第 1 到 4 站只能上車，主要看「離站」事件；「進站」事件若有，作為到站時間 |
| 第一航廈的時間 | 只能下車的終點站，以「進站」事件為抵達時間；若被「離站」覆蓋，以離站時間為上限並標記 |
| 歷史回填 | 歷史 API 在免費額度內不可行；歷史資料檔案訂購尚待確認 |

## 8. 參考資料

- [TDX 公共運輸-公車 基礎服務 OpenAPI 規格（v2）](https://tdx.transportdata.tw/webapi/File/Swagger/V3/2998e851-81d0-40f5-b26d-77e2f5ac4118)
- [TDX 公共運輸-公車 歷史服務 OpenAPI 規格（v2）](https://tdx.transportdata.tw/webapi/File/Swagger/V3/39472fde-f790-42b9-9c8b-88282118e6b1)
- [TDX 資料使用指引：公車動態資料](https://motc-ptx.gitbook.io/tdx-zi-liao-shi-yong-kui-hua-bao-dian/data_notice/public_transportation_data/bus_dynamic_data)
- [TDX Swagger 介面](https://tdx.transportdata.tw/api-service/swagger)
