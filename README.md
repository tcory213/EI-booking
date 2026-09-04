# EI Booking — 家歡診所兒童早療暨門診評估預約表 部署包

這個資料夾是可直接部署到 **Firebase Hosting** 與 **Vercel** 的靜態網站，
兩個網址會共用同一個 **Firebase Firestore** 資料庫，所以不管家長或後台
從哪個網址進去，看到的預約時段、候補名單都是同一份、即時同步的資料。

⚠️ **無法由 Claude 代為部署**：部署到你的 Firebase / Vercel 帳號，需要你自己
登入並授權（Claude 沒有你的帳號存取權限）。以下步驟大約 10～15 分鐘可完成。

---

## 檔案結構

```
ei-booking/
├── index.html          ← 給 Vercel 用（放在根目錄，Vercel 會自動偵測）
├── public/
│   └── index.html      ← 給 Firebase Hosting 用（內容與上面完全相同）
├── functions/
│   ├── index.js          ← Cloud Functions 中介層程式碼（所有病患資料存取都在這裡）
│   └── package.json       ← functions 的相依套件設定
├── firebase.json        ← Firebase Hosting + Functions 設定
├── .firebaserc           ← Firebase 專案 ID
├── firestore.rules       ← Firestore 資料庫存取規則
├── migrate-old-data.js    ← 選用：把更早期版本的資料搬到新架構的腳本
├── vercel.json              ← Vercel 設定
├── .gitignore                ← 排除不需要進版控的暫存檔案
└── README.md                  ← 本說明檔
```

`index.html` 和 `public/index.html` 內容完全一樣，兩份都要記得同步修改
（尤其是下面第 2 步要填的 Firebase 設定值）。

---

## 第 1 步：確認 Firebase 設定值

這份專案的 `index.html` 和 `public/index.html` 裡已經填好你的
Firebase 專案（`ei-booking`）設定值，`.firebaserc` 的專案 ID 也已對應好，
不需要再手動填寫。

若之後要換成別的 Firebase 專案，打開 `index.html` 和 `public/index.html`，
找到這一段（在 `<script>` 開頭附近）換成新專案的設定值即可（**兩份檔案都要改**）：

```js
const firebaseConfig = {
  apiKey: "...",
  authDomain: "...",
  projectId: "...",
  storageBucket: "...",
  messagingSenderId: "...",
  appId: "..."
};
```

同時記得把 `.firebaserc` 裡的專案 ID 也一併換掉。

別忘了到 [Firebase Console](https://console.firebase.google.com) 確認該專案的
Firestore Database 已經啟用（左側選單「建構」→「Firestore Database」）。

## 第 2 步：升級 Firebase 專案為 Blaze 方案（Cloud Functions 必要條件）

Cloud Functions 是 Google 要求一定要開通「Blaze（用量計費）方案」才能使用的功能，
即使實際用量在免費額度內、帳單金額是 0 元，也需要先綁定一組付款方式。

1. 前往 https://console.firebase.google.com ，選擇 `ei-booking` 專案
2. 左下角「升級」（Upgrade）或專案設定裡的方案頁面，選擇 **Blaze**
3. 依指示綁定信用卡等付款方式（一般小型診所的使用量，帳單金額通常是 $0）

## 第 3 步：安裝工具、登入、安裝 functions 套件

在電腦的終端機（Terminal / 命令提示字元）安裝部署工具：

```bash
npm install -g firebase-tools vercel
firebase login
vercel login
```

這兩行都會開啟瀏覽器讓你用 Google 帳號登入授權。

接著安裝 Cloud Functions 需要的套件（只需要做一次）：

```bash
cd ei-booking/functions
npm install
cd ..
```

## 第 4 步：註冊 Firebase App Check（防止非本站的自動化請求）

⚠️ Google 已將舊版 reCAPTCHA v3 標示為淘汰，Firebase Console 現在會引導你
改用 **reCAPTCHA Enterprise**（免費額度為每月 10,000 次評估，一般小型診所
用量完全用不完）。

1. 前往 Firebase Console → 左側選單「建構」→「App Check」
2. 點「開始使用」，找到你的 Web 應用程式，點「註冊」
3. 這時會看到「reCAPTCHA Enterprise」和「reCAPTCHA」兩個選項，
   **選「reCAPTCHA Enterprise」**（「reCAPTCHA」那個已淘汰，選了會出現警告）
4. 依畫面引導操作（可能會要求先啟用 reCAPTCHA Enterprise API），
   網域填 `ei-booking.web.app`、`ei-booking.firebaseapp.com`、
   `ei-booking.vercel.app`，之後有新網域也記得回來加
5. 完成後複製這組 **Site Key**，打開 `index.html` **和** `public/index.html`，
   找到這一行，把 `REPLACE_WITH_YOUR_RECAPTCHA_ENTERPRISE_SITE_KEY`
   換成你的 Site Key（兩份檔案都要改，內容要一致）：
   ```js
   const RECAPTCHA_ENTERPRISE_SITE_KEY = "REPLACE_WITH_YOUR_RECAPTCHA_ENTERPRISE_SITE_KEY";
   ```
6. **先不要急著開「強制」**：App Check 畫面上有個 Enforce（強制）開關，
   剛啟用時建議先保持「監控中／未強制」，觀察幾天確認網站功能都正常、
   Console 裡看得到合法的請求流量後，再回來把 Firestore 和 Cloud Functions
   這兩個項目的 Enforce 打開。

## 第 5 步：部署到 Firebase Hosting + Firestore 規則 + Cloud Functions

在 `ei-booking` 資料夾中執行：

```bash
cd ei-booking
firebase deploy --only hosting,firestore:rules,functions
```

第一次部署 functions 可能需要幾分鐘。完成後終端機會顯示一個
`https://你的專案.web.app` 網址，這就是 Firebase 版本的網站。

## 第 6 步：部署到 Vercel

同樣在 `ei-booking` 資料夾中執行：

```bash
vercel --prod
```

第一次執行會問幾個問題（專案名稱、要不要連結既有專案等），
直接按 Enter 用預設值即可。完成後會顯示一個 `https://你的專案.vercel.app` 網址。

之後如果要更新網站內容：
- 只改了 `index.html`／`public/index.html` → `firebase deploy --only hosting` + `vercel --prod`
- 改了 `functions/index.js` → 記得加上 `firebase deploy --only functions`
- 改了 `firestore.rules` → 記得加上 `firebase deploy --only firestore:rules`
- 三個都要更新，最簡單就是整串一起跑：
  ```bash
  firebase deploy --only hosting,firestore:rules,functions
  vercel --prod
  ```

---

## 🔧 這個版本做了什麼（精簡版 Cloud Functions 架構）

依照「不能讓外人取得非特定人士個資，但不太在意違規寫入/刪除（靠每日備份因應）」
這個原則，重新檢視了每一支 Cloud Function 是否真的需要保護，把 Cloud Functions
從原本 12 支精簡到只剩 **3 支**：

**留在 Cloud Functions（給「完全沒登入」的家長用，Firestore 規則沒辦法安全限制
查詢範圍，只能在伺服器端程式碼裡控管要回傳什麼）**
- `checkQuota`：查詢配額
- `lookupMyBookings`：家長查詢自己的預約
- `dailySlotRefresh`：每日排程，跟這次討論無關，維持不變

**後台的兩支讀取（`adminGetDashboardData`、`adminGetAuditLogs`）也拿掉了**，
因為後台使用者是「真的有登入 Firebase Auth」，不是完全匿名，Firestore 規則
可以直接寫「已登入才能讀」（`allow read: if request.auth != null`）安全地做到
一樣的保護，不需要額外經過 Cloud Function，登入後台的等待時間也會因此再縮短。

**改成前端直接寫 Firestore（純寫入，不涉及讀取他人資料，速度更快，減少冷啟動延遲）**
- 家長端：建立預約、送出候補登記、自行取消預約
- 後台：新增/刪除時段、取消某筆預約、恢復已停開的固定時段（這幾項**仍要求
  已登入管理員**，只是驗證方式從「Cloud Function 裡檢查」改成「Firestore
  規則裡檢查」，保護力沒有降低）
- 後台移除候補登記（這項**不需要登入**，因為只是刪除一筆已知的候補資料）

**拿掉的功能**
- 手動「🔄 重新產生固定時段」按鈕已移除，固定時段完全交給每日自動排程
  （`dailySlotRefresh`）處理，不再需要這個手動選項

### 每日自動補齊固定時段（不需要管理員登入）

`functions/index.js` 裡的 `dailySlotRefresh` 是一支**排程函式**，
每天台灣時間凌晨 3 點會自動執行一次，把「未來三個月內」缺少的固定時段
（週二 09:20/10:00/10:40、週三 20:00、週五 17:50/18:50）自動補齊，
完全不需要管理員登入後台觸發。它只會「新增缺少的」，不會刪除或動到
任何已存在的時段（已被預約的、手動加開的、既有的固定時段都不受影響）。

⚠️ **第一次部署這支函式時，可能會遇到跟先前部署 functions 類似的狀況**——
Google 需要幫這個新專案啟用 Cloud Scheduler 相關 API，偶爾第一次部署會
失敗，通常**單純重新執行一次 `firebase deploy --only functions` 就會成功**，
跟你們之前遇過的狀況一樣，不用太意外。

### 稽核紀錄（Audit Log）

每一次呼叫 Cloud Function（家長預約查詢、取消，或每日排程）都會自動
記一筆到 `auditLogs`：時間、來源 IP、瀏覽器 User-Agent、若 Google 有附上國別
資訊也會一併記下、若是管理員操作會記下是哪個帳號。這個 collection 前端
只有「已登入的管理員」能讀取，一般訪客完全無法直接讀寫，登入後台、點
「稽核紀錄」分頁即可直接看到（不再經過 Cloud Function），目前顯示最近 200 筆。

用途：萬一日後懷疑遭到入侵或有異常存取（例如短時間內大量查詢、或看到明顯
不像正常使用行為的紀錄），可以用這份紀錄裡的 IP 位址去查詢地理位置與歸屬
（用任何 IP 查詢工具，例如 https://ipinfo.io/ 或 https://whois.domaintools.com/ ，
把 IP 貼進去查），佐證是否來自境外或特定可疑來源。國別欄位如果是空的，
代表 Google 那次沒有附上該資訊，不影響 IP 本身仍然可查。

這個功能會讓 Firestore 每次呼叫都多一次寫入，用量極小（一般小型診所的流量，
遠低於免費額度），不需要額外設定就能運作，只要照上面步驟部署 `functions` 即可。

### 是否要搬移舊資料？

之前版本用的是 `clinicData`（單一 JSON blob）或 `patients/{雜湊}/bookings`
這兩種架構，跟現在這版的 `slots` / `bookings` collection **不會自動互通**。

- 如果目前資料庫裡都還是測試資料，**可以直接略過這步**，用新版重新開始即可。
- 如果有想保留的真實預約資料，需要手動搬移；這個資料夾裡的
  `migrate-old-data.js` 是針對「上一版」（patients/雜湊架構）寫的，
  如果你是從那個版本升級上來、且有真實資料要保留，跟我說一聲，
  我可以幫你寫一個對應現在這版架構的搬移腳本。


## 推上 GitHub

這個資料夾已經是一個 Git 專案（已執行過 `git init` 並完成第一次
commit），解壓縮後可以直接推上你自己的 GitHub。

**1. 在 GitHub 建立一個新的空 repo**（不要勾選「Add a README」，
避免和本地端衝突）：
前往 https://github.com/new ，輸入 repo 名稱（例如 `ei-booking`），建立。

**2. 在本機的 `ei-booking` 資料夾中，接上遠端並推送：**

```bash
cd ei-booking
git remote add origin https://github.com/你的帳號/ei-booking.git
git branch -M main
git push -u origin main
```

推送時會要求登入 GitHub 帳號授權（或使用 Personal Access Token）。

> 目前 commit 是用暫時的身分 `EI Booking Setup` 建立的。如果想改成你自己的
> 名字/信箱，推送前可以先執行：
> ```bash
> git config user.name "你的名字"
> git config user.email "你的信箱"
> git commit --amend --reset-author --no-edit
> ```

### 之後接上自動部署（選用，但推薦）

推上 GitHub 之後，可以讓每次 `git push` 自動更新網站，不用再手動下部署指令：

- **Vercel**：到 https://vercel.com/new ，選擇「Import Git Repository」，
  選你剛剛建立的 `ei-booking` repo，其他設定保持預設直接部署。
  之後每次 push 到 `main` 分支，Vercel 會自動重新部署。
- **Firebase Hosting**：在 `ei-booking` 資料夾中執行：
  ```bash
  firebase init hosting:github
  ```
  依照互動式問答完成設定（會需要授權 Firebase 的 GitHub App），
  之後每次 push 也會自動幫你重新部署到 Firebase Hosting。

---

## ⚠️ 關於資料安全（重要，請務必看過）

這個版本的設計原則是：**「讀取」他人資料一律嚴格保護，「寫入」則依你的
風險承受度（靠每日備份因應誤刪/亂改）適度放寬，換取更快的操作速度。**

**嚴格保護的部分（讀取，防止外人一次取得非特定人士的個資）：**
1. **後台登入用 Firebase Authentication**：真正的帳號密碼驗證
2. **家長端查詢類操作維持 Cloud Functions**：`checkQuota`／`lookupMyBookings`
   這兩支給「完全沒登入」的家長用，前端無法繞過畫面直接查詢
3. **後台讀取需要已登入**：後台看時段/病患/候補/稽核紀錄，都是直接讀
   Firestore，但 `bookings`／`waitlist`／`templateMeta`／`auditLogs`
   這幾個 collection 的規則都要求 `request.auth != null`，一般訪客
   （沒登入）一律讀不到
4. **Firebase App Check**：確認請求真的來自你自己網站上跑的瀏覽器

**刻意放寬的部分（寫入，依你的要求，靠每日備份因應風險）：**
- 家長建立自己的預約、送出候補登記、自行取消自己的預約 → 直接寫
  Firestore，**不需要驗證身分**。也就是說，如果有人知道某個孩子的姓名
  和生日，理論上可以用網站畫面查到甚至取消他的預約
- 後台移除候補登記 → 直接刪除，**不需要登入**
- 後台其他管理操作（新增/刪除時段、取消預約、恢復時段）→ 改成前端
  直接寫 Firestore，但**仍要求已登入管理員**才能執行（保護力沒有降低，
  只是驗證的地方從 Cloud Function 換成 Firestore 規則）
- `slots`（時段時間表）本身仍是任何人都能讀取的公開資料（不含個資）

如果之後想把「寫入」也拉高保護等級（例如家長需要簡訊驗證碼才能取消
預約），或想把某幾項操作改回 Cloud Function 驗證，都可以再回來調整，
只要告訴我要調整哪一項即可。

補充：`firebaseConfig` 裡的 `apiKey` 等設定值**不是密碼**，Google 官方
文件也說明這些值本來就會出現在前端程式碼中、可以安全地放進公開的
GitHub repo，真正的存取控制是靠 `firestore.rules` 與 Cloud Functions
的權限檢查。但 `functions/` 資料夾如果之後有任何第三方服務的 API 金鑰，
建議改用 `firebase functions:secrets:set` 設定，不要直接寫進程式碼或
commit 上 GitHub。



