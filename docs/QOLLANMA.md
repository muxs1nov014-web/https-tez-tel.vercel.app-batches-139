# Foydalanuvchi qo'llanmasi — TezTel (telefon import nazorati)

## 1. Kirish
Brauzerda tizim manzilini oching va login hamda parolingiz bilan kiring.
Rollar:
- **Administrator** — hammasini qila oladi: foydalanuvchilar, bot, sozlamalar, o'chirish.
- **Operator** — xarid, xarajat, sotuv, katalog va import kiritadi.
- **Kuzatuvchi** — faqat ko'radi.

## 2. Boshlashdan oldin (bir marta)
1. **Excel import** — eski `Foyda_Formula Рахбар.xlsx` faylni yuklang. Avval "Tekshirish"
   bosiladi, natija to'g'ri bo'lsa "Tasdiqlash". Allaqachon kiritilgan sanalar qayta yozilmaydi.
2. **Ombor → Boshlang'ich qoldiq** — har bir modeldan omborda hozir nechta borligini kiriting.
   Excel'da sotuvlar yozilmagani uchun busiz tizim barcha xarid qilingan telefonlarni omborda deb hisoblaydi.
3. **Bojxona tariflari** — baza narxlarni va 17.6% stavkani tekshiring.
   Rastamojka shu jadvaldan avtomatik hisoblanadi: baza narx × 17.6%.
4. **Bot foydalanuvchilari** — xodim botga `/start` yozadi, bot unga Telegram ID raqamini beradi.
   Shu raqamni shu sahifaga qo'shing.

## 3. Kundalik ish

### Xarid (partiya)
**Yangi xarid** sahifasida:
1. Sanani tanlang. Bir sana bitta partiya hisoblanadi.
2. Qatorlarni kiriting: model, soni, AED narx va kurs (odatda 3.67).
   - Rastamojka avtomatik to'ldiriladi, kerak bo'lsa o'zgartirish mumkin.
   - "Yo'lovchi (1)" kanali tanlansa, rastamojka yarmiga tushadi.
3. Partiyaning umumiy xarajatlarini tekshiring: sertifikat, Dubay ichki, schet bojxona, boji,
   naqd bojxona, deklarant. Ular standart qiymatlar bilan o'zi to'lib keladi, kerak bo'lsa shu partiya
   uchun o'zgartiring. Bu summalar partiyadagi har bir donaga teng bo'linadi.
   Standart qiymatlarni administrator **Bojxona tariflari → Sozlamalar** bo'limida o'zgartiradi.
4. Saqlang. Tizim har bir telefonga qancha xarajat tushganini (**ustama**) va **tannarx**ni
   avtomatik hisoblaydi.
5. Telegramga yuborish: partiya sahifasidagi **Telegramga yuborish** tugmasini bosing, kerakli odamlarni
   (bittasini, bir nechtasini yoki **Hammasi**ni) belgilang va **Yuborish**ni bosing. Belgilanganlarga
   **model bo'yicha 1 dona tannarx** boradi: har bir model, soni va bitta telefon tannarxi (bitta model bir necha
   qatorda bo'lsa, ular qo'shilib, o'rtachasi chiqadi). Saqlashning o'zi hech narsa yubormaydi.
   Model yoki xarajat tuzatilsa, tugmani yana bosing. Keyingi safar oxirgi tanlov belgilangan holda ochiladi.
   Kimdir botni bloklagan yoki chatni o'chirgan bo'lsa, unga faqat bir marta urinadi. Keyin ro'yxatda u qizil yozuv
   bilan ko'rinadi va unga yuborilmaydi. O'sha odam botga qayta yozsa (yoki /start bossa), yana yuboriladi.
   Saqlangan partiya sahifasining oxirida ham **Model bo'yicha tannarx** bloki turadi: har bir model, soni va
   bitta telefon tannarxi.
   Tannarx butun dollarda ko'rsatiladi: sent bo'lsa, doim 1 dollarga yuqoriga yaxlitlanadi (1954.56 → **1955 $**,
   1954.00 → 1954 $). Ko'rinishi: **2 dona × 3 542 $**.

### Real xarajatlar
Deklarant real to'langan summani bergach, partiya sahifasidagi **Partiya xarajatlari** bo'limiga
"Real" turi bilan kiriting. Tannarx real summa bilan qayta hisoblanadi.
Taxminiy va real summalar farqini **Hisobotlar → Taxminiy vs real** bo'limida ko'rasiz.

### Mijoz yuki
Qatorda mijozni va xizmat foizini tanlang. Mijoz telefonlari omborga kirmaydi.
Mijozdan olinadigan summa va bizning foydamiz **Hisobotlar → Mijoz xizmati** bo'limida chiqadi.

### Sotuv
**Sotuvlar → Yangi sotuv** sahifasida diler, model, soni va narxni ($) kiriting.
Telefonlar eng eski partiyadan boshlab hisobdan chiqadi, foyda darhol ko'rinadi.
Sotuvni faqat administrator o'chira oladi.

### Mijoz ombori va nasiya
Har bir mijoz alohida ombor sifatida yuradi. Mijozga berilgan mol bizniki hisoblanadi, mijoz uni
sotgach qarzi (nasiya) yoziladi. **Mijozlar** ro'yxatida har bir mijozning nasiyasi, qo'lidagi moli
va shu oydagi sotuvi ko'rinadi. Mijoz nomini bossangiz, uning sahifasi ochiladi.

Mijoz sahifasidagi tugmalar:
- **Mol berish** — omborimizdan mijozga telefon berish (soni va kelishilgan narx).
- **Qaytarish** — mijoz qaytargan telefonlar omborimizga qaytadi.
- **Sotildi** — mijoz sotgan telefonlar. Sotuv va foyda yoziladi, summa nasiyaga qo'shiladi.
- **To'lov** — mijoz to'lagan pul nasiyani kamaytiradi.
- **Boshlang'ich qarz** — tizimgacha bo'lgan eski qarzni bir marta kiriting.

Sahifadagi bo'limlar: Qoldiq, Harakatlar, Sotuvlar, To'lovlar, Hisob-kitob (har bir yozuvdan keyingi
qarz qoldig'i bilan). **Jami majburiyat** = nasiya + mijoz qo'lidagi molning kelishilgan narxdagi qiymati.
Harakat va to'lovni faqat administrator o'chira oladi.

## 4. Telegram bot
Botga yozing yoki ovozli xabar yuboring. Masalan:
- "18 Pro Max 256 dan nechta qoldi?"
- "Shu oy nechta 17 Pro Max sotildi, foyda qancha?"
- "Oxirgi partiyada 18 Pro Max ga bitta telefonga qancha rastamojka tushdi?"
- "29-sentabr partiyasini ko'rsat"

Bot faqat javob beradi, ma'lumot kiritmaydi. Ma'lumotlar admin panel orqali kiritiladi.

**Mijozlar tugmasi.** Pastdagi **👥 Mijozlar** tugmasini bosing (yoki /mijozlar yozing) va mijozni
tanlang. So'ng bo'limni tanlang: 💰 Nasiya, 📦 Qoldiq, 🧾 Savdolar, 💵 To'lovlar, 📋 Umumiy.
Bu tugmalar AI'siz ishlaydi: javob darhol keladi va Gemini limitiga ta'sir qilmaydi.

**Guruhda.** Botni Telegram guruhga qo'shish mumkin. U guruhga hech narsa yozmaydi, faqat xabarlarni
(matn, fayl, rasm izohi) tizimga saqlab boradi. Bot faqat qo'shilgandan keyingi xabarlarni ko'radi,
eski yozishmalar unga ko'rinmaydi.

**Partiya tannarxini guruh yoki kanalga yuborish.** Tanlash ro'yxatida faol bot foydalanuvchilari bor.
Guruh qo'shish uchun: botni guruhga qo'shing, guruhga bitta xabar yozing, so'ng **Bot foydalanuvchilari** sahifasidagi
**Partiya tannarxi — Telegram** bo'limida **Bot turgan guruhlar** ostidagi guruh nomini bosing va **Saqlash**ni bosing.
Kanal uchun botni kanalga admin qilib qo'shing va `@kanal_nomi` ni yozing. Bot faqat shu yerda qo'shilgan guruhga yozadi,
boshqa guruhlarda avvalgidek jim turadi.

## 4.1 Telefonda va Telegram Mini App'da
Panel manzili: **https://tez-tel.vercel.app**. Tizim Vercel'da ishlaydi, kompyuter yoqiq turishi shart emas.
Parol kamida 12 belgidan iborat bo'lishi kerak. 15 daqiqa ichida 5 marta noto'g'ri kiritilsa, kirish vaqtincha yopiladi.
Panel telefonda ham to'liq ishlaydi. Brauzerda havolani oching yoki botdagi **📱 Panelni ochish** tugmasini bosing.
- **Parolsiz kirish (Mini App):** administrator **Foydalanuvchilar** sahifasida xodimning **Telegram ID** sini kiritadi.
  Shundan keyin Telegram ichida panel o'zi ochiladi, login va parol so'ralmaydi.
- Telegram ID ni bilish uchun botga `/start` yuboring: ruxsat bo'lmasa, bot ID ni yozib beradi. Mini App ochilganda
  "ulanmagan" degan xabarda ham ID ko'rsatiladi.
- Ilova Telegram mavzusiga (kunduzgi yoki tungi) o'zi moslashadi. Yuqoridagi "orqaga" tugmasi oldingi sahifaga qaytaradi.

## 5. Atamalar
| Atama | Ma'nosi |
|---|---|
| Partiya | Bir sanadagi barcha xaridlar |
| Ustama | Bitta telefonga tushgan barcha xarajatlar: perevod, kargo, IMEI, sertifikat, bojxona, rastamojka... |
| Tannarx | Dollardagi narx + ustama |
| Taxminiy | Xarid paytidagi hisob |
| Real (amaldagi) | Aslida to'langan summa bo'yicha hisob |
| Nasiya | Mijozning qarzi: boshlang'ich qarz + sotuvlar − to'lovlar |
| Qo'lidagi mol | Mijozga berilgan, hali sotilmagan telefonlar (bizniki) |
