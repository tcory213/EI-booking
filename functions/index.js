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
const crypto = require('crypto');
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
  return snap.docs.map(d => d.data());
}

async function countNoShows(name, birth){
  const nm = normName(name);
  const snap = await db.collection('bookings')
    .where('name', '==', nm)
    .where('birth', '==', birth)
    .where('noShow', '==', true)
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

// 檢查某個孩子（姓名+生日）目前是否已有一筆有效預約、以及是否因累計爽約被暫停線上預約資格
exports.checkQuota = functions.https.onCall(async (data, context) => {
  await logAudit(context, 'checkQuota', {});
  const { name, birth } = data || {};
  if (!name || !birth) {
    throw new functions.https.HttpsError('invalid-argument', '缺少必要參數');
  }
  const today = todayStrTW();
  const [activeBookings, noShowCount] = await Promise.all([
    countActiveBookings(name, birth),
    countNoShows(name, birth),
  ]);
  // 「未來的時間」包含今天整天、以及明天以後：若已有一筆，直接擋下不能再約第二筆
  const hasFutureBooking = activeBookings.some(b => b.date >= today);
  // 「過去的歷史紀錄」不含今日：達兩次即視為已用完配額，之後改登記職能候補
  const pastCount = activeBookings.filter(b => b.date < today).length;
  const historyExceeded = pastCount >= 2;
  const noShowBlocked = noShowCount >= 2;
  return { hasFutureBooking, historyExceeded, noShowBlocked };
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

  const [bookSnap, waitSnap, langWaitSnap] = await Promise.all([
    db.collection('bookings').where('name', '==', nm).where('birth', '==', birth).where('status', '==', 'active').get(),
    db.collection('waitlist').where('name', '==', nm).where('birth', '==', birth).get(),
    db.collection('languageWaitlist').where('name', '==', nm).where('birth', '==', birth).get(),
  ]);

  // linkCode（LINE 綁定碼）、linkedUserIds 絕對不能回傳給家長端：
  // 否則只要知道姓名+生日的人就能查到綁定碼，進而綁定自己的 LINE 收到別人的提醒。
  const results = bookSnap.docs
    .map(d => { const { linkCode, linkedUserIds, ...safe } = d.data(); return { id: d.id, ...safe }; })
    .filter(b => b.date >= today)
    .sort((a, b) => a.date === b.date ? a.time.localeCompare(b.time) : a.date.localeCompare(b.date));

  const waitlistResults = waitSnap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => a.submittedAt - b.submittedAt);

  const languageWaitlistResults = langWaitSnap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => a.submittedAt - b.submittedAt);

  return { results, waitlistResults, languageWaitlistResults };
});

/* ============================================================
 * 自動排程：不需要管理員登入，系統於每週二、五凌晨自動把
 * 「未來一個月內」缺少的固定時段補齊。只新增缺少的，不刪除任何既有資料。
 * ============================================================ */

const SLOT_TEMPLATE = [
  { dow: 2, time: '09:20' },
  { dow: 2, time: '10:00' },
  { dow: 2, time: '10:40' },
  { dow: 3, time: '20:00' },
  { dow: 5, time: '17:50' },
  { dow: 5, time: '18:50' },
];

// 計算「開放到第幾天後」：以最近一次的週二為錨點，開放到「四週後的週二」為止。
// 例如今天剛好是週二，開放到 28 天後（下下下週二）；如果是週三，錨點回推一天到昨天的週二，開放到 27 天後，以此類推。
function maxDaysAheadTW(){
  const todayDow = new Date(todayStrTW() + 'T12:00:00Z').getUTCDay();
  const daysSinceTuesday = (todayDow - 2 + 7) % 7;
  return 28 - daysSinceTuesday;
}

async function createMissingTemplateSlots(){
  const metaRef = db.collection('templateMeta').doc('cancelledOcc');
  const metaDoc = await metaRef.get();
  const cancelledOcc = (metaDoc.exists && metaDoc.data().list) ? metaDoc.data().list : [];

  const existingSnap = await db.collection('slots').get();
  const existingKeys = new Set(existingSnap.docs.map(d => `${d.data().date}|${d.data().time}`));

  const todayMs = new Date(todayStrTW() + 'T00:00:00Z').getTime();
  const maxDays = maxDaysAheadTW();
  const toCreate = [];
  for (let i = 0; i <= maxDays; i++) {
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
  .schedule('every tuesday,friday 03:00')
  .timeZone('Asia/Taipei')
  .onRun(async () => {
    const created = await createMissingTemplateSlots();
    console.log(`[dailySlotRefresh] 固定時段自動補齊（週二/五），本次新增 ${created} 筆`);
    return null;
  });

/* ============================================================
 * 家長「補綁定」LINE 提醒：預約成功頁的綁定碼只顯示一次，沒綁到的家長可以
 * 從「查詢／取消預約」頁，針對某筆預約重新取得一組新的綁定碼。
 * 為避免只知道姓名+生日的人就能綁定，必須再核對「預約時填寫的聯絡手機」。
 * 每筆預約最多重新產生 5 次；新碼會讓舊碼失效。
 * ============================================================ */
const LINK_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const MAX_LINK_CODE_REISSUE = 5;
function genLinkCode(){
  let out = '';
  for (let i = 0; i < 6; i++) out += LINK_CODE_ALPHABET[crypto.randomInt(LINK_CODE_ALPHABET.length)];
  return out;
}

exports.requestLinkCode = functions.https.onCall(async (data, context) => {
  await logAudit(context, 'requestLinkCode', {});
  const { bookingId, name, birth, phone } = data || {};
  if (!bookingId || !name || !birth || !phone) {
    throw new functions.https.HttpsError('invalid-argument', '缺少必要參數');
  }
  const notFound = () => new functions.https.HttpsError('not-found', '核對失敗，請確認預約時填寫的聯絡手機是否正確');

  const ref = db.collection('bookings').doc(String(bookingId));
  const snap = await ref.get();
  if (!snap.exists) throw notFound();
  const b = snap.data();

  const phoneIn = normPhone(phone);
  const phoneOk = phoneIn.length >= 8 &&
    (phoneIn === normPhone(b.phone) || (b.altPhone && phoneIn === normPhone(b.altPhone)));
  if (b.status !== 'active' || b.date < todayStrTW() ||
      normName(b.name) !== normName(name) || b.birth !== birth || !phoneOk) {
    throw notFound();
  }
  const issued = Number(b.linkCodeIssued || 0);
  if (issued >= MAX_LINK_CODE_REISSUE) {
    throw new functions.https.HttpsError('resource-exhausted', '重新取得綁定碼的次數已達上限，請來電由專人協助');
  }

  const linkCode = genLinkCode();
  await ref.update({ linkCode, linkCodeIssued: issued + 1 });
  return { linkCode, date: b.date, time: b.time };
});

/* ============================================================
 * LINE 提醒綁定（給 AI Reply 後台呼叫，不是給瀏覽器用）
 * ============================================================
 * 流程：預約成功頁顯示綁定碼 → 家長在 LINE 官方帳號傳「綁定 XXXXXX」→
 * AI Reply 後台收到後呼叫 linkLineByCode → 這裡把 LINE 使用者 ID 記到該兒童
 * （姓名+生日）的聯絡方式（lineContacts）。隔天由 AI Reply 呼叫
 * getTomorrowReminders 取得要提醒的名單並推播。
 *
 * 這三支都用共用密鑰（BOOKING_LINK_SECRET，Secret Manager）保護，
 * 沒帶正確密鑰一律 401。getTomorrowReminders／unlinkLine 回傳刻意極簡（不含姓名、生日、電話）；
 * linkLineByCode 綁定成功時會回傳姓名與生日（民國七碼）給 AI Reply 建立客戶資料。
 * 設定方式：firebase functions:secrets:set BOOKING_LINK_SECRET
 * （此專案與 AI Reply 專案要設成「同一組」值）
 */
const LINK_FN_OPTIONS = { secrets: ['BOOKING_LINK_SECRET'] };

function contactKey(name, birth){
  return crypto.createHash('sha256').update(normName(name) + '|' + String(birth || '')).digest('hex');
}

function checkLinkSecret(req, res){
  const expected = process.env.BOOKING_LINK_SECRET || '';
  const got = String(req.get('x-link-secret') || '');
  const a = Buffer.from(expected);
  const b = Buffer.from(got);
  const ok = expected.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
  if (req.method !== 'POST') { res.status(405).json({ ok:false, reason:'method' }); return false; }
  if (!ok) { res.status(401).json({ ok:false, reason:'unauthorized' }); return false; }
  return true;
}

// 預約網站的生日是西元 YYYY-MM-DD，AI Reply 後台統一用民國年七碼 YYYMMDD（例如 0760213）
function toBirth7(birth){
  const m = String(birth || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const minguo = parseInt(m[1], 10) - 1911;
  if (minguo < 1) return null;
  return String(minguo).padStart(3, '0') + m[2] + m[3];
}

const LINE_USER_ID_RE = /^U[0-9a-f]{32}$/;
const MAX_LINE_USERS_PER_BOOKING = 2; // 同一組綁定碼最多讓 2 個 LINE（例如爸爸、媽媽）綁定

exports.linkLineByCode = functions.runWith(LINK_FN_OPTIONS).https.onRequest(async (req, res) => {
  if (!checkLinkSecret(req, res)) return;
  const body = req.body || {};
  const code = String(body.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const lineUserId = String(body.lineUserId || '');
  if (code.length !== 6 || !LINE_USER_ID_RE.test(lineUserId)) {
    res.status(400).json({ ok:false, reason:'bad_request' });
    return;
  }

  const snap = await db.collection('bookings')
    .where('linkCode', '==', code)
    .where('status', '==', 'active')
    .limit(5)
    .get();
  const today = todayStrTW();
  // 綁定碼有效期限：到預約當天（含）為止
  const docs = snap.docs.filter(d => (d.data().date || '') >= today);
  if (docs.length === 0) {
    res.json({ ok:false, reason:'not_found' });
    return;
  }

  const bookingDoc = docs[0];
  const b = bookingDoc.data();
  const linked = Array.isArray(b.linkedUserIds) ? b.linkedUserIds : [];
  if (!linked.includes(lineUserId) && linked.length >= MAX_LINE_USERS_PER_BOOKING) {
    res.json({ ok:false, reason:'limit' });
    return;
  }

  const batch = db.batch();
  batch.set(db.collection('lineContacts').doc(contactKey(b.name, b.birth)), {
    name: normName(b.name),
    birth: b.birth,
    lineUsers: admin.firestore.FieldValue.arrayUnion(lineUserId),
    updatedAt: Date.now(),
  }, { merge: true });
  batch.update(bookingDoc.ref, {
    linkedUserIds: admin.firestore.FieldValue.arrayUnion(lineUserId),
  });
  await batch.commit();

  await logAudit({ rawRequest: req }, 'linkLineByCode', {});
  // 一併回傳孩童姓名與生日，讓 AI Reply 後台直接建立「姓名＋生日＋LINE ID」的客戶資料
  res.json({ ok:true, date: b.date, time: b.time, name: normName(b.name), birth: toBirth7(b.birth) });
});

exports.unlinkLine = functions.runWith(LINK_FN_OPTIONS).https.onRequest(async (req, res) => {
  if (!checkLinkSecret(req, res)) return;
  const lineUserId = String((req.body || {}).lineUserId || '');
  if (!LINE_USER_ID_RE.test(lineUserId)) {
    res.status(400).json({ ok:false, reason:'bad_request' });
    return;
  }
  const snap = await db.collection('lineContacts').where('lineUsers', 'array-contains', lineUserId).get();
  const batch = db.batch();
  snap.docs.forEach(d => batch.update(d.ref, {
    lineUsers: admin.firestore.FieldValue.arrayRemove(lineUserId),
    updatedAt: Date.now(),
  }));
  if (!snap.empty) await batch.commit();
  await logAudit({ rawRequest: req }, 'unlinkLine', {});
  res.json({ ok:true, removed: snap.size });
});

// 回傳「明天」有有效預約、且已綁定 LINE 的名單。只含預約 ID、日期、時間、LINE 使用者 ID。
exports.getTomorrowReminders = functions.runWith(LINK_FN_OPTIONS).https.onRequest(async (req, res) => {
  if (!checkLinkSecret(req, res)) return;
  const todayMs = new Date(todayStrTW() + 'T00:00:00Z').getTime();
  const tomorrow = toLocalISODateTW(new Date(todayMs + 86400000));

  const snap = await db.collection('bookings')
    .where('date', '==', tomorrow)
    .where('status', '==', 'active')
    .get();
  if (snap.empty) { res.json({ ok:true, date: tomorrow, reminders: [] }); return; }

  const refs = snap.docs.map(d => db.collection('lineContacts').doc(contactKey(d.data().name, d.data().birth)));
  const contactDocs = await db.getAll(...refs);

  const reminders = [];
  snap.docs.forEach((d, i) => {
    const c = contactDocs[i];
    const users = (c.exists && Array.isArray(c.data().lineUsers)) ? c.data().lineUsers : [];
    if (users.length > 0) {
      reminders.push({ bookingId: d.id, date: d.data().date, time: d.data().time, lineUserIds: users });
    }
  });
  await logAudit({ rawRequest: req }, 'getTomorrowReminders', {});
  res.json({ ok:true, date: tomorrow, reminders });
});
