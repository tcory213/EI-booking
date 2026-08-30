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
├── firebase.json        ← Firebase Hosting 設定
├── .firebaserc           ← Firebase 專案 ID
├── firestore.rules       ← Firestore 資料庫存取規則（內含重要資安提醒，請詳讀）
├── vercel.json            ← Vercel 設定
├── .gitignore              ← 排除不需要進版控的暫存檔案
└── README.md                ← 本說明檔
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

## 第 2 步：安裝工具並登入

在電腦的終端機（Terminal / 命令提示字元）安裝部署工具：

```bash
npm install -g firebase-tools vercel
firebase login
vercel login
```

這兩行都會開啟瀏覽器讓你用 Google 帳號登入授權。

## 第 3 步：部署到 Firebase Hosting + Firestore 規則

在 `ei-booking` 資料夾中執行：

```bash
cd ei-booking
firebase deploy --only hosting,firestore:rules
```

完成後終端機會顯示一個 `https://你的專案.web.app` 網址，這就是 Firebase 版本的網站。

## 第 4 步：部署到 Vercel

同樣在 `ei-booking` 資料夾中執行：

```bash
vercel --prod
```

第一次執行會問幾個問題（專案名稱、要不要連結既有專案等），
直接按 Enter 用預設值即可。完成後會顯示一個 `https://你的專案.vercel.app` 網址。

之後如果要更新網站內容，兩邊都各自重新執行一次
`firebase deploy --only hosting` 和 `vercel --prod` 就可以了。

---

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

## ⚠️ 關於資料安全，部署前請務必看過

目前 `firestore.rules` 為了讓網站能直接運作，允許**任何人**
讀寫預約資料，也就是任何知道你 Firebase 設定值的人，理論上都能用
瀏覽器打開 Firestore 直接看到所有小朋友的姓名、生日、電話、
主要問題等資訊，也能竄改或刪除資料。後台的 `0000` 密碼也只是
前端擋一下畫面，並不是真正的身分驗證。

這樣的安全等級**僅適合內部測試或展示**。如果之後要正式蒐集真實
兒童與家長的個人資料（尤其牽涉健康狀況，屬於較敏感的個資類別），
建議在正式上線前，請 Claude 協助你加上：

- **Firebase Authentication**：後台需要帳號密碼登入才能讀取完整病患資料
- **Firebase App Check**：限制只有你自己的網站網域能呼叫 Firestore
- 或改用 **Cloud Functions** 作為中介層，前端不直接讀寫資料庫

如果你想要，我也可以直接幫你把這個版本升級成有登入驗證保護的版本。

補充：`firebaseConfig` 裡的 `apiKey` 等設定值**不是密碼**，Google 官方
文件也說明這些值本來就會出現在前端程式碼中、可以安全地放進公開的
GitHub repo，真正的存取控制是靠 `firestore.rules`。但後台 PIN 碼、
如果你日後加上任何真正的密鑰或服務帳號金鑰，記得改放進有加進
`.gitignore` 的檔案，不要一起 commit 上去。
