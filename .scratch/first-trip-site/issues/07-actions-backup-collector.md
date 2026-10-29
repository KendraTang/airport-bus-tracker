# 07 — GitHub Actions 備援收集

**What to build:** GitHub Actions 用第二把 TDX 金鑰，在清晨每 5 分鐘收集一次，資料寫入獨立的來源目錄與額度帳本。Mac mini 與 Actions 的資料合併並去重後，出現在每日紀錄表中；Mac mini 沒有收到資料的日子，紀錄表仍然能顯示備援的結果。

**Blocked by:** 03

**Status:** ready-for-agent

- [ ] 第二把金鑰只存放在 Repository Secrets，不出現在 log、資料檔或 commit 中
- [ ] 備援收集的排程時間與停止條件和 Mac mini 一致，排程延遲的情況有處理
- [ ] 資料與額度帳本使用獨立的來源目錄，不和 Mac mini 互相覆蓋
- [ ] 推上去的資料會觸發網站更新，與 Mac mini 的推送不會衝突
- [ ] 合併時同一事件只算一次，每個時間都能看出來自哪個來源
- [ ] 附上整月用量估算，確認兩把金鑰各自都在免費額度內
- [ ] 若 05 已完成，收集健康度能分別顯示兩個來源
