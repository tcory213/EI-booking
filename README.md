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
├── firestore.rules       ← Firestore 資料庫存取規則（公開時段/私密病患資料分離，請詳讀）
├── migrate-old-data.js    ← 選用：把舊版資料搬到新架構的一次性腳本
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

⚠️ **這個專案已改用「公開時段資訊 / 私密病患資料分離」的架構**，部署後還需要完成
兩個一次性設定，網站才會完全正常，請務必往下看完「資料架構更新後的必要設定」。

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

## 🔧 資料架構更新後的必要設定

這個版本把資料庫拆成「公開的時段時間表」和「私密的病患資料」兩個部分，
安全性比之前好很多，但需要完成以下設定網站才能正常運作：

### A. 建立 Firestore 索引（collectionGroup 查詢用）

後台「時段管理」頁面需要用到一種叫 collectionGroup 的查詢方式，橫跨所有病患資料。
**第一次登入後台時，這個查詢通常會失敗一次**，並在瀏覽器主控台（F12 打開）
印出一則錯誤訊息，裡面會附一個藍色連結，長得像：

```
https://console.firebase.google.com/project/ei-booking/firestore/indexes?create_composite=...
```

**點那個連結**，會直接開啟 Firebase Console 並幫你把索引欄位都填好，
按「建立索引」（Create Index），等 1-2 分鐘讓它建立完成，
之後重新整理網站、重新登入後台，就會正常顯示了。

### B. 是否要搬移舊資料？

舊版用的是 `clinicData` 這個 collection（單一 JSON 檔案的存法），
新版改用 `slots` / `patients` 這兩個 collection。**兩者不會自動互通**。

- 如果目前資料庫裡都還是測試資料，**可以直接略過這步**，用新版重新開始即可
  （舊資料留在 `clinicData` 裡不會被存取，之後想清理再手動去 Firebase Console 刪除即可）。
- 如果有需要保留的真實預約資料，這個資料夾裡有一個 `migrate-old-data.js`，
  打開它、照裡面的說明操作（登入後台後貼到瀏覽器 Console 執行一次）即可搬移。



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

這個版本已經做了兩項重要的安全升級：

1. **後台登入改用 Firebase Authentication**（真正的帳號密碼驗證，不是寫死在程式碼裡的密碼）
2. **資料庫拆成「公開時段」與「私密病患資料」兩個部分**：
   - `slots`（時段時間表）任何人都能看到，但**不含任何病患個資**
   - `patients/{電話雜湊}/bookings`（病患資料）依電話號碼分區存放，
     一般訪客隨意打開 Firestore，**不會再看到全部病患的名單一次列出來**
   - 後台完整病患清單，只有登入的管理員才能讀取

比起最早的版本（任何人一鍵就能看到所有小朋友的姓名、生日、電話），
這已經是很大幅度的改善。但誠實地說，這**仍然不是最高等級的保護**：

- 病患資料是用「知道電話號碼才能算出對應的存取路徑」來保護的，
  對隨機路人、搜尋引擎、意外瀏覽已經足夠安全，但如果有心人士寫程式
  暴力窮舉所有可能的台灣手機號碼組合，理論上仍有機會找到特定一筆資料
  （只會拿到那一筆，不會拿到全部病患名單）
- `slots` 時段的「開放↔已預約」狀態切換，目前仍允許未登入的使用者操作
  （這是為了讓家長不需要註冊帳號就能自行預約/取消），
  代表有心人士理論上可以惡意把時段亂標記成已預約，造成別人無法預約
  （但看不到任何病患個資）

如果之後要正式大量蒐集真實兒童與家長的個人資料，建議進一步加上：

- **Firebase App Check**：限制只有你自己的網站網域能呼叫 Firestore，
  能有效擋掉多數自動化腳本與機器人攻擊
- **Cloud Functions 中介層**：讓所有讀寫都經過你自己寫的伺服器端程式碼驗證，
  而不是前端直接讀寫資料庫，是目前業界最推薦的做法
- 讓每位家長透過 **手機簡訊驗證碼（Firebase Phone Auth）** 登入後才能預約，
  這樣就能確保「這支電話真的是本人在操作」

如果你想要，都可以再回來請我協助升級。

補充：`firebaseConfig` 裡的 `apiKey` 等設定值**不是密碼**，Google 官方
文件也說明這些值本來就會出現在前端程式碼中、可以安全地放進公開的
GitHub repo，真正的存取控制是靠 `firestore.rules`。但如果你日後加上任何
真正的密鑰或服務帳號金鑰，記得改放進有加進 `.gitignore` 的檔案，
不要一起 commit 上去。

