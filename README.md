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

1. 前往 Firebase Console → 左側選單「建構」→「App Check」
2. 點「開始使用」，找到你的 Web 應用程式，點「註冊」
3. Provider 選擇 **reCAPTCHA v3**，會需要你去
   https://www.google.com/recaptcha/admin/create 建立一組 reCAPTCHA v3 的
   Site Key（網域填你之後會用到的網址，例如 `ei-booking.web.app`、
   `ei-booking.vercel.app`，兩個都要加，之後有新網域也記得回來加）
4. 拿到 Site Key 後，打開 `index.html` **和** `public/index.html`，
   找到這一行，把 `REPLACE_WITH_YOUR_RECAPTCHA_V3_SITE_KEY` 換成你的 Site Key
   （兩份檔案都要改，內容要一致）：
   ```js
   const RECAPTCHA_V3_SITE_KEY = "REPLACE_WITH_YOUR_RECAPTCHA_V3_SITE_KEY";
   ```
5. **先不要急著開「強制」**：App Check 畫面上有個 Enforce（強制）開關，
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

## 🔧 這個版本做了什麼（Cloud Functions 中介層架構）

現在前端已經**完全不會直接讀寫**病患資料（姓名、生日、電話、主要問題）。
所有涉及個資的操作，都改成呼叫 Cloud Functions（在 `functions/index.js` 裡），
由伺服器端的程式碼驗證身分、檢查配額、確認管理員權限後才真正讀寫資料庫，
Firestore 規則對這些 collection 直接設成「一律拒絕前端存取」。
只有時段的公開時間表（`slots`，不含個資）還是前端直接讀取，維持速度與免費額度。

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

這個版本已經完成三項重要的安全升級：

1. **後台登入用 Firebase Authentication**：真正的帳號密碼驗證，不是寫死在程式碼裡的密碼
2. **Cloud Functions 中介層**：前端完全不會直接讀寫病患資料，所有涉及個資的操作
   （預約、查詢、取消、後台管理）都經過伺服器端程式碼驗證身分與權限後才執行，
   Firestore 對 `bookings`／`waitlist`／`templateMeta` 這幾個 collection
   直接設成「拒絕前端存取」——就算有人繞過網站畫面、直接打開瀏覽器主控台
   呼叫 Firestore API，也完全看不到、改不了任何病患資料
3. **Firebase App Check**：確認呼叫 Cloud Functions／Firestore 的請求，
   真的是來自你自己網站上跑的瀏覽器，能有效擋掉多數自動化腳本與機器人攻擊

到這個階段，資料安全的等級已經相當紮實，不是「前端隨便防一下」的水準了。
但仍然誠實補充兩個殘留的限制，讓你了解目前的邊界在哪：

- 家長查詢／取消自己的預約，是用「電話 + 生日是否吻合」來確認身分，
  而不是真正登入帳號。這代表如果有人剛好知道某位家長的電話和孩子生日
  （例如認識的親友），理論上可以用網站畫面查到、甚至取消那筆預約。
  如果需要更強的保護，可以加上簡訊驗證碼（Firebase Phone Auth），
  讓家長真正「登入」後才能操作，之後有需要可以再回來加。
- `slots`（時段時間表）本身仍是任何人都能讀取的公開資料（不含個資），
  這是刻意設計，讓家長瀏覽可預約時段不需要每次都呼叫 Cloud Function、
  節省成本與速度；如果之後想連時段時間表都不公開瀏覽，也可以改。

補充：`firebaseConfig` 裡的 `apiKey` 等設定值**不是密碼**，Google 官方
文件也說明這些值本來就會出現在前端程式碼中、可以安全地放進公開的
GitHub repo，真正的存取控制是靠 `firestore.rules` 與 Cloud Functions
的權限檢查。但 `functions/` 資料夾如果之後有任何第三方服務的 API 金鑰，
建議改用 `firebase functions:secrets:set` 設定，不要直接寫進程式碼或
commit 上 GitHub。


