/**
 * EI Booking — Cloud Functions 中介層
 * 所有涉及病患個資的讀寫都經過這裡，前端不再直接讀寫 patients/bookings/waitlist，
 * 真正的存取控制邏輯（配額檢查、身分核對、管理員權限）都在伺服器端執行，
 * Firestore 規則對這幾個 collection 一律拒絕前端直接存取（見 firestore.rules）。
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
 * 家長端功能
 * ============================================================ */

// 查詢某個孩子（電話+生日）已使用過幾次評估/門診機會
exports.checkQuota = functions.https.onCall(async (data) => {
  const { phone, birth } = data || {};
  if (!phone || !birth) {
    throw new functions.https.HttpsError('invalid-argument', '缺少必要參數');
  }
  const used = await countActiveBookings(phone, birth);
  return { used };
});

// 預約一個時段（含配額檢查、防止同時被搶）
exports.bookSlot = functions.https.onCall(async (data) => {
  validateBookingInput(data);
  const { slotId, name, birth, phone, issue } = data;
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
exports.submitWaitlist = functions.https.onCall(async (data) => {
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

// 家長查詢自己的預約（用電話+生日核對）
exports.lookupMyBookings = functions.https.onCall(async (data) => {
  const { phone, birth } = data || {};
  if (!phone || !birth) {
    throw new functions.https.HttpsError('invalid-argument', '請填寫聯絡電話與兒童生日');
  }
  const np = normPhone(phone);
  const today = todayStrTW();
  const snap = await db.collection('bookings')
    .where('phoneNorm', '==', np)
    .where('birth', '==', birth)
    .where('status', '==', 'active')
    .get();
  const results = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(b => b.date >= today)
    .sort((a, b) => a.date === b.date ? a.time.localeCompare(b.time) : a.date.localeCompare(b.date));
  return { results };
});

// 家長自行取消預約（同樣用電話+生日核對是否為本人）
exports.cancelMyBooking = functions.https.onCall(async (data) => {
  const { phone, birth, bookingId } = data || {};
  if (!phone || !birth || !bookingId) {
    throw new functions.https.HttpsError('invalid-argument', '缺少必要參數');
  }
  const bookingRef = db.collection('bookings').doc(bookingId);
  await db.runTransaction(async (tx) => {
    const doc = await tx.get(bookingRef);
    if (!doc.exists) {
      throw new functions.https.HttpsError('not-found', '找不到這筆預約');
    }
    const b = doc.data();
    if (normPhone(b.phone) !== normPhone(phone) || b.birth !== birth) {
      throw new functions.https.HttpsError('permission-denied', '電話或生日不符，無法取消');
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
