# 01 — 部署管線打通

**What to build:** push 到 `main` 後，GitHub Actions 會自動建置並部署 GitHub Pages 網站。頁面先只顯示「已收集幾天」與「最後更新時間」。這些數字由一個最小的匯出步驟從已收集的原始資料產生，建置時一併執行，不手動維護。這張票打通「原始資料 → 匯出 JSON → 網頁 → 部署」整條路，之後的票只需要在這條路上加內容。

**Blocked by:** None — can start immediately

**Status:** done

- [x] 依 PRD 的技術選擇建立網頁專案骨架，並能在本機建置
- [x] 匯出步驟讀取所有來源的原始資料，產生頁面所需的 JSON，有對應的測試
- [x] GitHub Actions workflow 在 push 到 `main` 時建置並部署到 GitHub Pages
- [x] 在 repo 設定中啟用 Pages（來源為 GitHub Actions）；這是對外動作，執行前先向使用者確認
- [x] 網站子路徑設定正確，部署後的網址可以正常開啟，資源都能載入
- [x] 頁面顯示的收集天數與最後更新時間和 repo 中的原始資料一致
- [x] repo、commit 訊息與網站內容不含任何個人資訊
