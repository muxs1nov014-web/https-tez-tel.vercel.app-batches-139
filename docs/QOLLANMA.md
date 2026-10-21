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

### Nasiya nazorati (kunlik Excel)
«Telefon nasiya nazorat» guruhiga har kuni tashlanadigan Excel faylni bot o'zi oladi va tekshiradi.
Hamma varag'i mijozga bog'langan fayl kelishi bilan o'zi hisoblanadi. Faylda xato bo'lsa ham hisoblanadi, lekin
Dashboard'da va «Kunlik nazorat»da ogohlantirish chiqadi: Excel'da tuzatib guruhga qayta tashlansa, shu kun yangilanadi.
Har kuni soat 10:00 da tizim o'zi tekshiradi: bot o'tkazib yuborgan yoki «Excel yuklash» bilan qo'shilgan fayllar ham
hisoblanadi. Faqat varaq nomi hech bir mijozga mos kelmasa, fayl **Nasiya nazorati → Hisobotlar** bo'limida kutadi —
varaqni mijozga bir marta bog'lang.

**Eng oson yo'l — faylni botga forward qilish.** Guruhga kunlik faylni BonviAI_bot tashlaydi, Telegram esa bir
botning xabarini boshqa botga ko'rsatmaydi. Shuning uchun guruhdagi faylni **@Teztel2025bot** ga forward qiling (yoki
botga to'g'ridan-to'g'ri yuboring): bot o'sha zahoti hisoblaydi va javobda kunni, nasiya / qoldiq / sotuvni va xatolarni
(Excel katagi bilan) yozadi. Buning uchun panelda «Foydalanuvchilar» bo'limida o'zingizga Telegram ID yozilgan
bo'lishi va rolingiz operator yoki administrator bo'lishi kerak (ID ni bot o'zi aytadi).

**Telegramdan yangilash** — guruhdagi yangi fayllarni hozir o'qiydi. Fayl topilmasa, sababini ko'rsatadi (masalan,
bot guruhda admin emas — unda bot fayllarni ko'rmaydi: botni guruhda **administrator** qiling). Telegram botga eski
xabarlarni bermaydi: bot ko'rmagan kunlarning fayllarini Telegram'dan saqlab, **Excel yuklash** bilan qo'shing.

**Hammasini hisoblash** (Nasiya nazorati yoki Dashboard'da): kunni tanlang (masalan, oyning 1-kuni) — bot guruhdagi
shu kundan keyingi hamma fayllarni o'qiydi va har bir kunni hisoblaydi. Bir kunga bir nechta fayl bo'lsa, oxirgisi
olinadi. Varaq nomi mijoz nomiga aniq mos kelsa, o'zi bog'lanadi. Xatosi bor kunlarni administrator bosganda hisoblanadi
(xatolar hisobotda ko'rinib turadi); operator bosganda ular kutib turadi. Natijada kutib turgan kunlar va sababi chiqadi.

Excel qanday yozilishi kerak (bot shunday o'qiydi):
- Har bir varaq — bitta mijoz. Tepada sana (`15,10,2026`) va ism.
- Ustun sarlavhasi: **Nasiya** (qarz), **N Variant**, **Qoldiq** / **Колгани** (mijozdagi bizning mol), **Sotuv** (bugun to'langan).
- Ustun ichida: model nomi, ostida IMEI lar, oxirida narx va soni: `1900*10` = 1900 $ dan 10 dona.
  Bitta telefon bo'lsa, faqat narx (`1880`). Qoldiq ustunida oxirida soni (`3`).
- `15,10,` — shu sanada berilgan bloklar; `8 kunga berildi` — muddat.
- Pastda: `Nasiyada 35 ta`, `4 ta tel un kirim`, `Ostatka`.

Tekshirish:
1. Hisobotni oching. Har bir varaqni panel mijoziga bog'lang (bir marta; keyingi kunlarda o'zi bog'lanadi).
2. **Xato** lar: IMEI noto'g'ri (raqami yoki nazorat raqami xato), `1900*10` deb yozilgan-u IMEI 9 ta,
   narx yozilmagan, bitta IMEI ikki joyda, sarlavha «Sotuv» lekin pastida «Nasiyada». Har birida Excel katagi
   ko'rsatiladi (masalan `B14`). Excel'da tuzatib guruhga qayta tashlang — yangi fayl shu kunni almashtiradi.
3. **Diqqat** lar (masalan «Nasiyada 39 ta» deb yozilgan, hisoblanganda 38 ta) — tekshirib ko'ring, tasdiqlashni to'xtatmaydi.
4. **Tasdiqlash** ni bosing. Xato bo'lsa, faqat administrator izoh yozib «Xatolar bilan tasdiqlash» mumkin.

**Kunlik nazorat** sahifasi oxirgi tasdiqlangan kunni oldingi kun bilan IMEI bo'yicha solishtiradi:
yangi nasiya, to'langan (Nasiya → Sotuv), qoldiqdan nasiyaga o'tgan telefonlar. **Ogohlantirishlar** — tekshirish kerak:
nasiyadan izsiz chiqqan (Sotuv'da ham yo'q), boshqa mijozga o'tgan, narxi o'zgargan, to'langan telefon qayta chiqqan.
Mijozlar jadvalida: nasiya, varaqdagi o'z hisobi (farq bo'lsa qizil), qoldiq, limit va bo'sh limit, eng eski nasiya (kun).
Mijoz nomini bossangiz — har bir telefon: model, IMEI, narx, qachondan va necha kundan beri turibdi.
IMEI ni bossangiz — telefonning kunma-kun tarixi. **Telefonlar (kunlar)** bo'limi: hamma nasiya va qoldiq telefonlari
mijozi, modeli, IMEI, narxi va necha kundan beri turgani bilan (eng uzog'i tepada); mijoz va IMEI bo'yicha qidirish bor.
«≥» — telefon hisob boshlangan kundan oldin ham bo'lgan. **Oylar kesimida**: oyning sotuvi (Sotuv ustunidagi telefonlar,
har biri bir marta), yangi nasiya, oy oxiridagi nasiya va qoldiq. Shu raqamlar **Mijozlar** ro'yxatida («Guruh: nasiya»
ustuni), mijoz sahifasida («Guruh hisoboti») va Dashboard'da ham ko'rinadi. Guruhga bot o'chiq paytda tashlangan fayllar uchun
**Hammasini hisoblash** ni bosing; boshqa joydan olingan faylni **Excel yuklash** bilan qo'shing.

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
| Nasiya nazorati | Guruhdagi kunlik Excel bo'yicha IMEI darajasidagi nazorat (mijozlar hisobidan alohida) |
| Qo'lidagi mol | Mijozga berilgan, hali sotilmagan telefonlar (bizniki) |
