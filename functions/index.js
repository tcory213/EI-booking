/**
 * EI Booking — Cloud Functions 中介層
 * 所有涉及病患個資的讀寫都經過這裡，前端不再直接讀寫 bookings/waitlist，
 * 真正的存取控制邏輯（配額檢查、身分核對、管理員權限）都在伺服器端執行，
 * Firestore 規則對這幾個 collection 一律拒絕前端直接存取（見 firestore.rules）。
 *
 * 每一次呼叫都會寫一筆稽核紀錄到 auditLogs（含來源 IP、時間、動作），
 * 目的是萬一日後懷疑遭入侵或異常存取，可以拿這份紀錄佐證來源 IP／是否來自境外。
 */
const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();
const db = admin.firestore();

const AGE_LIMIT_MSG = '很抱歉由於健保政策規範，目前早療初評僅提供8歲半以下兒童。超過8歲半兒童建議尋求兒童身心科協助。';

function normPhone(p){ return String(p || '').replace(/\D/g, ''); }

// 以台灣時區 (UTC+8) 組出 YYYY-MM-DD
function toLocalISODateTW(d){
  const tw = new Date(d.getTime() + 8 * 60 * 60 * 1000);
  const y = tw.getUTCFullYear();
  const m = String(tw.getUTCMonth() + 1).padStart(2, '0');
  const day = String(tw.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function todayStrTW(){ return toLocalISODateTW(new Date()); }

function ageInMonths(birthStr){
  const b = new Date(birthStr + 'T00:00:00Z');
  const now = new Date(todayStrTW() + 'T00:00:00Z');
  if (isNaN(b.getTime()) || b > now) return null;
  let years = now.getUTCFullYear() - b.getUTCFullYear();
  let months = now.getUTCMonth() - b.getUTCMonth();
  if (now.getUTCDate() < b.getUTCDate()) months--;
  if (months < 0) { years--; months += 12; }
  return years * 12 + months;
}
function calcAgeLabel(birthStr){
  const m = ageInMonths(birthStr);
  if (m === null) return '';
  return Math.floor(m / 12) + '歲' + (m % 12) + '個月';
}

async function countActiveBookings(phone, birth){
  const np = normPhone(phone);
  const snap = await db.collection('bookings')
    .where('phoneNorm', '==', np)
    .where('birth', '==', birth)
    .where('status', '==', 'active')
    .get();
  return snap.size;
}

function requireAuth(context){
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', '請先登入管理員帳號');
  }
}

function validateBookingInput(data){
  const { name, birth, phone, issue } = data || {};
  if (!name || !String(name).trim()) {
    throw new functions.https.HttpsError('invalid-argument', '請填寫兒童全名');
  }
  const months = ageInMonths(birth);
  if (birth === undefined || months === null) {
    throw new functions.https.HttpsError('invalid-argument', '請選擇正確的兒童生日');
  }
  if (months > 102) {
    throw new functions.https.HttpsError('failed-precondition', AGE_LIMIT_MSG);
  }
  if (!phone || normPhone(phone).length < 8) {
    throw new functions.https.HttpsError('invalid-argument', '請填寫正確的聯絡電話');
  }
  if (!issue || !String(issue).trim()) {
    throw new functions.https.HttpsError('invalid-argument', '請填寫主要問題');
  }
}

/* ============================================================
 * 稽核紀錄 (Audit Log)
 * ------------------------------------------------------------
 * 每次呼叫任何一個 Cloud Function 時，記下：
 *   - 呼叫時間、呼叫的是哪個函式（action）
 *   - 來源 IP（從 Google 前端代理附加的 x-forwarded-for 取得，
 *     這是實際打這支 API 的用戶端真實 IP，不是 Google 自己的 IP）
 *   - 瀏覽器 User-Agent
 *   - 若 Google 前端有附上國別資訊（x-appengine-country 等），一併記錄；
 *     若沒有這個標頭，之後仍可拿 IP 去查詢地理位置（任何 IP 查詢工具都查得到）
 *   - 若是已登入的管理員操作，記下是哪個管理員帳號（uid/email）
 *   - App Check 驗證是否通過（app 欄位有值代表通過）
 * 只有 Cloud Functions（Admin SDK）能寫入這個 collection，前端／一般使用者
 * 完全無法直接讀寫，只有登入的管理員能透過 adminGetAuditLogs 讀取。
 * ============================================================ */
async function logAudit(context, action, extra){
  try{
    const req = context.rawRequest || {};
    const headers = req.headers || {};
    const xff = headers['x-forwarded-for'] || '';
    const ip = (xff.split(',')[0] || '').trim() || req.ip || 'unknown';
    const userAgent = headers['user-agent'] || 'unknown';
    const country = headers['x-appengine-country']
      || headers['x-country-code']
      || null; // Google 前端不一定會附上這個標頭，沒有的話就留空，之後可用 IP 反查
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
    // 稽核紀錄寫入失敗不應該影響原本的操作，只記錄到 Cloud Functions 自己的 log
    console.error('audit log 寫入失敗', e);
  }
}

/* ============================================================
 * 家長端功能
 * ============================================================ */

// 查詢某個孩子（電話+生日）已使用過幾次評估/門診機會
exports.checkQuota = functions.https.onCall(async (data, context) => {
  await logAudit(context, 'checkQuota', {});
  const { phone, birth } = data || {};
  if (!phone || !birth) {
    throw new functions.https.HttpsError('invalid-argument', '缺少必要參數');
  }
  const used = await countActiveBookings(phone, birth);
  return { used };
});

// 預約一個時段（含配額檢查、防止同時被搶）
exports.bookSlot = functions.https.onCall(async (data, context) => {
  await logAudit(context, 'bookSlot', { slotId: data && data.slotId });
  validateBookingInput(data);
  const { slotId, birth, phone, issue } = data;
  const name = String(data.name).trim();
  if (!slotId) {
    throw new functions.https.HttpsError('invalid-argument', '缺少時段資訊');
  }

  const used = await countActiveBookings(phone, birth);
  if (used >= 2) {
    throw new functions.https.HttpsError('failed-precondition', '此兒童已達兩次評估／門診機會上限，請改用候補登記。');
  }

  const age = calcAgeLabel(birth);
  const priorLabel = `第 ${used + 1} 次（上限2次）`;
  const slotRef = db.collection('slots').doc(slotId);
  const bookingRef = db.collection('bookings').doc();

  const result = await db.runTransaction(async (tx) => {
    const slotDoc = await tx.get(slotRef);
    if (!slotDoc.exists || slotDoc.data().status !== 'open') {
      throw new functions.https.HttpsError('already-exists', '此時段已被預約，請重新選擇');
    }
    const slot = slotDoc.data();
    tx.update(slotRef, { status: 'booked' });
    tx.set(bookingRef, {
      slotId, name, birth, age, phone,
      phoneNorm: normPhone(phone), issue, priorLabel,
      status: 'active', bookedAt: Date.now(),
      date: slot.date, time: slot.time, note: slot.note || ''
    });
    return { date: slot.date, time: slot.time, note: slot.note || '' };
  });

  return { name, age, phone, issue, date: result.date, time: result.time, note: result.note };
});

// 送出候補登記
exports.submitWaitlist = functions.https.onCall(async (data, context) => {
  await logAudit(context, 'submitWaitlist', {});
  validateBookingInput(data);
  const { name, birth, phone, issue } = data;
  const used = await countActiveBookings(phone, birth);
  const priorLabel = used >= 2 ? '已達2次上限' : `第 ${used + 1} 次（上限2次）`;
  const age = calcAgeLabel(birth);
  await db.collection('waitlist').add({
    name, birth, age, phone, phoneNorm: normPhone(phone), issue,
    priorLabel, submittedAt: Date.now()
  });
  return { name, age, phone, issue };
});

// 姓名比對用：去除頭尾空白，統一比較基準
function normName(n){ return String(n || '').trim(); }

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

// 家長自行取消預約（同樣用兒童全名+生日核對是否為本人）
exports.cancelMyBooking = functions.https.onCall(async (data, context) => {
  const { name, birth, bookingId } = data || {};
  await logAudit(context, 'cancelMyBooking', { bookingId });
  if (!name || !birth || !bookingId) {
    throw new functions.https.HttpsError('invalid-argument', '缺少必要參數');
  }
  const bookingRef = db.collection('bookings').doc(bookingId);
  await db.runTransaction(async (tx) => {
    const doc = await tx.get(bookingRef);
    if (!doc.exists) {
      throw new functions.https.HttpsError('not-found', '找不到這筆預約');
    }
    const b = doc.data();
    if (normName(b.name) !== normName(name) || b.birth !== birth) {
      throw new functions.https.HttpsError('permission-denied', '姓名或生日不符，無法取消');
    }
    if (b.status !== 'active') {
      throw new functions.https.HttpsError('failed-precondition', '此預約已非有效狀態');
    }
    const today = todayStrTW();
    if (b.date <= today) {
      throw new functions.https.HttpsError('failed-precondition', '已超過線上取消時限，請直接致電本院');
    }
    tx.update(bookingRef, { status: 'cancelled' });
    tx.update(db.collection('slots').doc(b.slotId), { status: 'open' });
  });
  return { ok: true };
});

/* ============================================================
 * 後台管理功能（需已用 Firebase Authentication 登入）
 * ============================================================ */

// 一次取回後台需要的所有資料：時段（含病患資料）、候補名單、固定時段停開清單
exports.adminGetDashboardData = functions.https.onCall(async (data, context) => {
  requireAuth(context);
  await logAudit(context, 'adminGetDashboardData', {});
  const [slotsSnap, waitSnap, tplSnap, bookSnap] = await Promise.all([
    db.collection('slots').get(),
    db.collection('waitlist').get(),
    db.collection('templateMeta').doc('cancelledOcc').get(),
    db.collection('bookings').where('status', '==', 'active').get(),
  ]);
  const bookingBySlot = {};
  bookSnap.docs.forEach(d => {
    const b = d.data();
    bookingBySlot[b.slotId] = { ...b, _bookingId: d.id };
  });
  const slots = slotsSnap.docs.map(d => {
    const s = { id: d.id, ...d.data() };
    if (bookingBySlot[s.id]) s.booking = bookingBySlot[s.id];
    return s;
  });
  const waitlist = waitSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const cancelledOcc = (tplSnap.exists && tplSnap.data().list) ? tplSnap.data().list : [];
  return { slots, waitlist, cancelledOcc };
});

exports.adminAddSlot = functions.https.onCall(async (data, context) => {
  requireAuth(context);
  await logAudit(context, 'adminAddSlot', { date: data && data.date, time: data && data.time });
  const { date, time, note } = data || {};
  if (!date || !/^\d{1,2}:\d{2}$/.test(String(time || '').trim())) {
    throw new functions.https.HttpsError('invalid-argument', '請輸入正確的日期與時間');
  }
  const timeNorm = String(time).trim().padStart(5, '0');
  const noteVal = (note || '').trim();
  const ref = await db.collection('slots').add({ date, time: timeNorm, note: noteVal, status: 'open', source: 'manual' });
  return { id: ref.id, date, time: timeNorm, note: noteVal, status: 'open', source: 'manual' };
});

exports.adminDeleteSlot = functions.https.onCall(async (data, context) => {
  requireAuth(context);
  await logAudit(context, 'adminDeleteSlot', { slotId: data && data.slotId });
  const { slotId } = data || {};
  const ref = db.collection('slots').doc(slotId);
  const doc = await ref.get();
  if (!doc.exists) {
    throw new functions.https.HttpsError('not-found', '找不到此時段');
  }
  const slot = doc.data();
  await ref.delete();
  if (slot.source === 'template') {
    const key = `${slot.date}|${slot.time}`;
    const metaRef = db.collection('templateMeta').doc('cancelledOcc');
    await db.runTransaction(async (tx) => {
      const metaDoc = await tx.get(metaRef);
      const list = (metaDoc.exists && metaDoc.data().list) ? metaDoc.data().list : [];
      if (!list.includes(key)) {
        list.push(key);
        tx.set(metaRef, { list });
      }
    });
  }
  return { ok: true };
});

exports.adminCancelBooking = functions.https.onCall(async (data, context) => {
  requireAuth(context);
  await logAudit(context, 'adminCancelBooking', { slotId: data && data.slotId });
  const { slotId } = data || {};
  const bookSnap = await db.collection('bookings')
    .where('slotId', '==', slotId).where('status', '==', 'active').limit(1).get();
  await db.runTransaction(async (tx) => {
    if (!bookSnap.empty) {
      tx.update(bookSnap.docs[0].ref, { status: 'cancelled' });
    }
    tx.update(db.collection('slots').doc(slotId), { status: 'open' });
  });
  return { ok: true };
});

exports.adminRestoreOccurrence = functions.https.onCall(async (data, context) => {
  requireAuth(context);
  await logAudit(context, 'adminRestoreOccurrence', { key: data && data.key });
  const { key } = data || {};
  const metaRef = db.collection('templateMeta').doc('cancelledOcc');
  await db.runTransaction(async (tx) => {
    const metaDoc = await tx.get(metaRef);
    const list = (metaDoc.exists && metaDoc.data().list) ? metaDoc.data().list : [];
    tx.set(metaRef, { list: list.filter(k => k !== key) });
  });
  return { ok: true };
});

exports.adminRemoveWaitlistEntry = functions.https.onCall(async (data, context) => {
  requireAuth(context);
  await logAudit(context, 'adminRemoveWaitlistEntry', { entryId: data && data.entryId });
  const { entryId } = data || {};
  await db.collection('waitlist').doc(entryId).delete();
  return { ok: true };
});

const SLOT_TEMPLATE = [
  { dow: 2, time: '09:20' },
  { dow: 2, time: '10:00' },
  { dow: 2, time: '10:40' },
  { dow: 3, time: '20:00' },
  { dow: 5, time: '17:50' },
  { dow: 5, time: '18:50' },
];

exports.adminRegenerateTemplate = functions.https.onCall(async (data, context) => {
  requireAuth(context);
  await logAudit(context, 'adminRegenerateTemplate', {});

  // 1. 刪除尚未被預約的固定時段
  const toDeleteSnap = await db.collection('slots')
    .where('source', '==', 'template').where('status', '==', 'open').get();
  if (!toDeleteSnap.empty) {
    const batch1 = db.batch();
    toDeleteSnap.docs.forEach(d => batch1.delete(d.ref));
    await batch1.commit();
  }

  // 2. 依樣板重新產生未來三個月內的固定時段
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
    const batch2 = db.batch();
    toCreate.forEach(s => batch2.set(db.collection('slots').doc(), s));
    await batch2.commit();
  }

  return { deleted: toDeleteSnap.size, created: toCreate.length };
});

/* ============================================================
 * 稽核紀錄查詢（僅限已登入管理員）
 * ============================================================ */
exports.adminGetAuditLogs = functions.https.onCall(async (data, context) => {
  requireAuth(context);
  const limit = Math.min(Math.max(parseInt((data && data.limit) || 200, 10) || 200, 1), 500);
  const snap = await db.collection('auditLogs')
    .orderBy('ts', 'desc')
    .limit(limit)
    .get();
  const logs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  return { logs };
});
