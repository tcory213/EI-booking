// ============================================================
// 一次性資料搬遷小工具
// ============================================================
// 用途：把舊版「clinicData 單一 JSON blob」格式的資料，
//       搬到新版「slots + patients/*/bookings」的分離式架構。
//
// 使用方式：
//   1. 用管理員帳號登入後台（一定要先登入，因為建立 slots 需要管理員權限）
//   2. 打開瀏覽器開發者工具（F12）的 Console 分頁
//   3. 把這個檔案的全部內容貼上去，按 Enter 執行
//   4. 看到「遷移完成」訊息後，重新整理頁面即可
//
// 如果你確定目前沒有需要保留的真實預約資料（例如都還在測試階段），
// 可以直接略過這個步驟，不需要執行。
// ============================================================
(async function migrateOldData(){
  if(!auth.currentUser){
    console.error('請先用管理員帳號登入後台，再執行這個遷移腳本。');
    return;
  }
  const oldSlotsDoc = await db.collection('clinicData').doc('slots').get();
  const oldSlots = (oldSlotsDoc.exists && oldSlotsDoc.data().json) ? JSON.parse(oldSlotsDoc.data().json) : [];
  const oldWaitDoc = await db.collection('clinicData').doc('waitlist').get();
  const oldWaitlist = (oldWaitDoc.exists && oldWaitDoc.data().json) ? JSON.parse(oldWaitDoc.data().json) : [];

  let slotCount = 0, bookingCount = 0, waitCount = 0;

  for(const s of oldSlots){
    const newSlotRef = await db.collection('slots').add({
      date: s.date, time: s.time, note: s.note || '',
      status: s.booking ? 'booked' : 'open',
      source: s.source || 'manual'
    });
    slotCount++;
    if(s.booking){
      const hash = await phoneHashOf(s.booking.phone);
      await db.collection('patients').doc(hash).collection('bookings').add({
        slotId: newSlotRef.id,
        name: s.booking.name, birth: s.booking.birth, age: s.booking.age,
        phone: s.booking.phone, issue: s.booking.issue,
        priorLabel: s.booking.priorLabel || '',
        status: 'active', bookedAt: s.booking.bookedAt || Date.now(),
        date: s.date, time: s.time, note: s.note || ''
      });
      bookingCount++;
    }
  }

  for(const w of oldWaitlist){
    await db.collection('waitlist').add({
      name: w.name, birth: w.birth, age: w.age, phone: w.phone,
      issue: w.issue, priorLabel: w.priorLabel || '',
      submittedAt: w.submittedAt || Date.now()
    });
    waitCount++;
  }

  console.log(`遷移完成！時段 ${slotCount} 筆、預約 ${bookingCount} 筆、候補 ${waitCount} 筆。請重新整理頁面確認資料。`);
})();
