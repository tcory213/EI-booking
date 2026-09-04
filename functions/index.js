/**
 * EI Booking — Cloud Functions（精簡版）
 *
 * 設計原則：只有「會讀到別人資料」的操作才留在這裡（用 Admin SDK 繞過 Firestore
 * 規則，並在程式碼裡自行控管要回傳什麼），單純「寫入」的操作已經改成前端直接寫
 * Firestore，由 firestore.rules 控管誰能寫、能寫哪些欄位（詳見 firestore.rules
 * 開頭的說明註解）。這樣可以大幅減少 Cloud Functions 呼叫次數（減少冷啟動延遲），
 * 同時仍然確保「外人無法一次取得非特定人士的個資」這個核心防線。
 *
 * 保留在這裡的函式：
 *   - checkQuota / lookupMyBookings：家長端查詢，Firestore 規則沒辦法安全地
 *     限制「只能照這組條件查」，開放的話等於任何人都能撈走全部病患資料。
 *   - adminGetDashboardData / adminGetAuditLogs：回傳全部病患/候補/稽核資料，
 *     一定要在伺服器端先確認呼叫者已登入管理員帳號。
 *   - dailySlotRefresh：排程觸發，不是使用者操作，維持不變。
 */
const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();
const db = admin.firestore();

function normPhone(p){ return String(p || '').replace(/\D/g, ''); }
function normName(n){ return String(n || '').trim(); }

// 以台灣時區 (UTC+8) 組出 YYYY-MM-DD
function toLocalISODateTW(d){
  const tw = new Date(d.getTime() + 8 * 60 * 60 * 1000);
  const y = tw.getUTCFullYear();
  const m = String(tw.getUTCMonth() + 1).padStart(2, '0');
  const day = String(tw.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function todayStrTW(){ return toLocalISODateTW(new Date()); }

async function countActiveBookings(name, birth){
  const nm = normName(name);
  const snap = await db.collection('bookings')
    .where('name', '==', nm)
    .where('birth', '==', birth)
    .where('status', '==', 'active')
    .get();
  return snap.size;
}

/* ============================================================
 * 稽核紀錄 (Audit Log)
 * ============================================================ */
async function logAudit(context, action, extra){
  try{
    const req = context.rawRequest || {};
    const headers = req.headers || {};
    const xff = headers['x-forwarded-for'] || '';
    const ip = (xff.split(',')[0] || '').trim() || req.ip || 'unknown';
    const userAgent = headers['user-agent'] || 'unknown';
    const country = headers['x-appengine-country'] || headers['x-country-code'] || null;
    const region = headers['x-appengine-region'] || null;
    const city = headers['x-appengine-city'] || null;

    await db.collection('auditLogs').add({
      ts: Date.now(),
      action,
      ip,
      userAgent,
      country, region, city,
      authUid: context.auth ? context.auth.uid : null,
      authEmail: (context.auth && context.auth.token) ? (context.auth.token.email || null) : null,
      appCheckVerified: !!context.app,
      ...(extra || {})
    });
  }catch(e){
    console.error('audit log 寫入失敗', e);
  }
}

/* ============================================================
 * 家長端：查詢類（保留在 Cloud Functions）
 * ============================================================ */

// 查詢某個孩子（姓名+生日）已使用過幾次評估/門診機會
exports.checkQuota = functions.https.onCall(async (data, context) => {
  await logAudit(context, 'checkQuota', {});
  const { name, birth } = data || {};
  if (!name || !birth) {
    throw new functions.https.HttpsError('invalid-argument', '缺少必要參數');
  }
  const used = await countActiveBookings(name, birth);
  return { used };
});

// 家長查詢自己的預約（用兒童全名+生日核對）
exports.lookupMyBookings = functions.https.onCall(async (data, context) => {
  await logAudit(context, 'lookupMyBookings', {});
  const { name, birth } = data || {};
  if (!name || !birth) {
    throw new functions.https.HttpsError('invalid-argument', '請填寫兒童全名與生日');
  }
  const nm = normName(name);
  const today = todayStrTW();
  const snap = await db.collection('bookings')
    .where('name', '==', nm)
    .where('birth', '==', birth)
    .where('status', '==', 'active')
    .get();
  const results = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(b => b.date >= today)
    .sort((a, b) => a.date === b.date ? a.time.localeCompare(b.time) : a.date.localeCompare(b.date));
  return { results };
});

/* ============================================================
 * 每日自動排程：不需要管理員登入，系統每天固定時間自動把
 * 「未來三個月內」缺少的固定時段補齊。只新增缺少的，不刪除任何既有資料。
 * ============================================================ */

const SLOT_TEMPLATE = [
  { dow: 2, time: '09:20' },
  { dow: 2, time: '10:00' },
  { dow: 2, time: '10:40' },
  { dow: 3, time: '20:00' },
  { dow: 5, time: '17:50' },
  { dow: 5, time: '18:50' },
];

async function createMissingTemplateSlots(){
  const metaRef = db.collection('templateMeta').doc('cancelledOcc');
  const metaDoc = await metaRef.get();
  const cancelledOcc = (metaDoc.exists && metaDoc.data().list) ? metaDoc.data().list : [];

  const existingSnap = await db.collection('slots').get();
  const existingKeys = new Set(existingSnap.docs.map(d => `${d.data().date}|${d.data().time}`));

  const todayMs = new Date(todayStrTW() + 'T00:00:00Z').getTime();
  const toCreate = [];
  for (let i = 0; i <= 90; i++) {
    const dateStr = toLocalISODateTW(new Date(todayMs + i * 86400000));
    const dow = new Date(dateStr + 'T12:00:00Z').getUTCDay();
    SLOT_TEMPLATE.filter(t => t.dow === dow).forEach(t => {
      const key = `${dateStr}|${t.time}`;
      if (cancelledOcc.includes(key)) return;
      if (existingKeys.has(key)) return;
      toCreate.push({ date: dateStr, time: t.time, note: '', status: 'open', source: 'template' });
    });
  }

  if (toCreate.length > 0) {
    const batch = db.batch();
    toCreate.forEach(s => batch.set(db.collection('slots').doc(), s));
    await batch.commit();
  }
  return toCreate.length;
}

exports.dailySlotRefresh = functions.pubsub
  .schedule('every day 03:00')
  .timeZone('Asia/Taipei')
  .onRun(async () => {
    const created = await createMissingTemplateSlots();
    console.log(`[dailySlotRefresh] 每日自動補齊固定時段，本次新增 ${created} 筆`);
    return null;
  });
