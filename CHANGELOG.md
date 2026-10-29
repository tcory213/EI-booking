# 更新紀錄（CHANGELOG）

> 以「新到舊」排列。日期為台灣時間。

## 2026-10-29 — 綁定成功後回傳基本資料給 AI Reply 後台
- `public/index.html`：LINE 綁定卡片說明文字改為「請幫我按加入好友。加入好友後會自動在輸入欄預填好綁定密碼，⚠️請幫我按【傳送】以完成綁定」。
- `functions/index.js`：`linkLineByCode` 綁定成功時，回應多帶 `name`（孩童姓名）與 `birth`（民國年七碼 `YYYMMDD`，例如 `0760213`，由新函式 `toBirth7` 從西元 `YYYY-MM-DD` 轉換），讓 AI Reply 後台直接建立「姓名＋生日＋LINE ID」客戶資料。
- 文件：`README.md` 補上說明；並修正兩處過時敘述（原寫「三支函式回傳不含姓名、生日」，現只有 `getTomorrowReminders`、`unlinkLine` 維持極簡）。
- 前端、規則、`package.json` 無變動。
- **留意**：此回傳仍受 `BOOKING_LINK_SECRET` 保護，只給 AI Reply 後台；兩個專案的密鑰務必保管好。一旦外洩，持有者只要猜中有效綁定碼（6 碼、到預約當天有效、每筆預約最多 2 個 LINE）即可取得該孩童姓名與生日，風險比先前回傳日期時間高，請妥善保管密鑰、必要時輪替。
- 部署：只改了 Functions，執行 `firebase deploy --only functions`。

## 2026-10-28 — LINE 預約提醒綁定（在另一個專案修改後併回）
**新功能**：預約成功後可一鍵綁定 LINE，預約前一天早上 10:00 自動收到提醒。

- `public/index.html`
  - 預約成功頁新增「一鍵綁定 LINE 提醒」卡片（`renderLineLinkCard`）：開啟官方帳號 `LINE_OA_BASIC_ID`（目前 `@719kid`），預填「綁定 XXXXXX」。
  - 預約建立時由前端產生 6 碼綁定碼（`genLinkCode`，排除 I/L/O/0/1），存進該筆預約的 `linkCode`。
  - 「查詢／取消預約」頁：每筆未來預約新增「🔔 綁定 LINE 提醒」，需再輸入預約時的聯絡手機，呼叫 `requestLinkCode` 重新取得綁定碼。
  - 後台預約列：已綁定的兒童顯示「🔔 已綁定 LINE 提醒」（讀取 `lineContacts`）。
- `functions/index.js`（新增 4 支，`lookupMyBookings` 一併調整）
  - `lookupMyBookings`：回傳資料排除 `linkCode`、`linkedUserIds`。
  - `requestLinkCode`（家長端 callable）：核對姓名＋生日＋手機後產生新綁定碼；舊碼失效，每筆預約最多重新取得 5 次。
  - `linkLineByCode`、`unlinkLine`、`getTomorrowReminders`（HTTP，給 AI Reply 後台呼叫）：用共用密鑰 `BOOKING_LINK_SECRET`（Secret Manager）保護，無密鑰一律 401；回傳不含姓名、生日、電話。
  - 綁定碼有效到預約當天；同一預約最多 2 個 LINE 可綁定；以「姓名＋生日」雜湊為鍵存 `lineContacts`，同一位兒童之後再預約免重綁。
- `firestore.rules`：新增 `lineContacts`（僅登入的管理員可讀，禁止任何前端寫入）。
- `README.md`：新增「LINE 預約提醒綁定」章節（部署步驟、官方帳號 ID 變更方式、注意事項）。

**部署**：先 `firebase functions:secrets:set BOOKING_LINK_SECRET`（兩個專案設同一組值），再 `firebase deploy --only hosting,firestore:rules,functions`。

**待留意**
- `lineContacts` 存有 LINE 使用者 ID，屬個資，請納入保留期限規劃（含每日備份）。
- `requestLinkCode` 以手機核對，但 `lookupMyBookings` 目前仍會回傳該筆預約的手機，所以這道核對只能擋掉「不知道姓名＋生日」的人；風險僅限於多一個人收到該預約的日期時間提醒。
- 官方帳號專屬 ID 一年後若不續購，改 `LINE_OA_BASIC_ID` 一行並重新部署 Hosting。

## 2026-10-27 — 打包最新版
- 重新打包完整專案 zip。

## 2026-10-26 — 討論
- 評估 LINE 提醒的可行性：LINE 只能發給 userId，需要綁定機制；輕用量方案每月 200 則免費（push 計費、reply 免費）。

## 2026-10-20 — 前端調整與 Node 升級
- **民國年生日選擇**：預約表單、語言候補表單、查詢頁、後台歷史查詢的生日改為「民國年／月／日」三個下拉（內部仍存西元 `YYYY-MM-DD`）。修正：只選了部分欄位時不再被重畫洗掉。
- **候補完成頁**：職能／語言候補皆顯示「您的資料已完成登入待排名單（姓名、民國生日、手機）」，並加上橘紅警示框（須候補到才會聯絡、通知順序參考個案狀況、候補常需半年以上、語言治療至少一年、可從首頁查詢確認）；移除「待排時間平均 6 個月」等字句。
- **後台入口**：移除右上角齒輪，改為點左上角「EI BOOKING」進入後台。
- **Functions Node 20 → 22**（`functions/package.json` 的 `engines.node`），因 Node 20 於 2026-10-30 停用；套件版本未動。

## 更早（摘要）
- 預約流程：姓名＋生日辨識兒童；一次只能有一筆未來預約；已完成兩次（或預約後未報到）改登記職能候補；累計 2 次爽約停止線上預約。
- 開放時段：每週二、五自動上架，開放到「最近一個週二起算四週」。
- 初步篩檢分流（含肌力弱／斜頸）、21 項問題勾選、備用電話、10 碼手機驗證。
- 後台：時段／職能候補／語言候補／歷史查詢／稽核；標記爽約；單筆 CSV 匯出（民國生日、文字格式手機）。
- 架構：Firebase Hosting＋Firestore＋Auth；Functions 僅保留 `checkQuota`、`lookupMyBookings`、`dailySlotRefresh`；已移除 Vercel。
