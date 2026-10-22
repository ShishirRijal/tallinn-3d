// Time-travel stops. Each historical era drapes a real map from the Land Board's historical
// WMS over the terrain and hides buildings first used after `year` (Building Register data).
export const ERAS = [
  {
    id: '1899',
    year: 1899,
    map: 'history/1899.jpg',
    source: {
      en: 'One-verst map of the Russian Empire, sheet 3-29 (1899)',
      et: 'Üheverstane kaart, leht 3-29 (1899)',
      ru: 'Одноверстная карта, лист 3-29 (1899)',
    },
    title: { en: 'Reval, Russian Empire', et: 'Reval, Vene impeerium', ru: 'Ревель, Российская империя' },
    text: {
      en: 'Tallinn, then officially called Reval, was a provincial capital of the Russian Empire. The railway had arrived in 1870 and the city was growing far beyond its medieval walls, while the old earth bastions around them were being turned into parks. Alexander Nevsky Cathedral was still under construction.',
      et: 'Tallinn, ametlikult Reval, oli Vene impeeriumi kubermangulinn. Raudtee jõudis linna 1870. aastal ja linn kasvas kaugele üle keskaegsete müüride, samal ajal kui vanadest muldbastionidest said pargid. Aleksander Nevski katedraal oli alles ehitusel.',
      ru: 'Таллин, тогда официально Ревель, был губернским городом Российской империи. Железная дорога пришла сюда в 1870 году, и город разрастался далеко за средневековые стены, а старые земляные бастионы вокруг них превращались в парки. Собор Александра Невского ещё строился.',
    },
  },
  {
    id: '1929',
    year: 1929,
    map: 'history/1929.jpg',
    source: {
      en: 'Estonian topographic map 1:25 000, sheet III-29 (1929)',
      et: 'Eesti topograafiline kaart 1:25 000, leht III-29 (1929)',
      ru: 'Эстонская топографическая карта 1:25 000, лист III-29 (1929)',
    },
    title: { en: 'Capital of the Republic', et: 'Vabariigi pealinn', ru: 'Столица республики' },
    text: {
      en: 'After the War of Independence (1918–1920), Tallinn became the capital of the Republic of Estonia. This map from the Estonian state survey labels the Old Town in Estonian: Toompea, Raekoda, Oleviste.',
      et: 'Pärast Vabadussõda (1918–1920) sai Tallinnast Eesti Vabariigi pealinn. Eesti riikliku mõõdistuse kaardil on vanalinna paigad eestikeelsete nimedega: Toompea, Raekoda, Oleviste.',
      ru: 'После Освободительной войны (1918–1920) Таллин стал столицей Эстонской Республики. На карте эстонской государственной съёмки места Старого города подписаны по-эстонски: Тоомпеа, Ратуша, Олевисте.',
    },
  },
  {
    id: '1946',
    year: 1946,
    map: 'history/1946.jpg',
    source: {
      en: 'Soviet topographic map 1:10 000, sheet O3514Vb4 (1946)',
      et: 'Nõukogude topograafiline kaart 1:10 000, leht O3514Vb4 (1946)',
      ru: 'Советская топографическая карта 1:10 000, лист O3514Vb4 (1946)',
    },
    title: { en: 'After the war', et: 'Pärast sõda', ru: 'После войны' },
    text: {
      en: 'On 9 March 1944 a Soviet air raid set large parts of Tallinn on fire. In the Old Town, St Nicholas’ Church burned and the Harju Street area was destroyed. Look for the broken blocks around the church on this 1946 Soviet map, now labelled in Russian, made at the start of the Soviet occupation.',
      et: '9. märtsil 1944 süütas Nõukogude õhurünnak suure osa Tallinnast. Vanalinnas põles Niguliste kirik ja hävis Harju tänava piirkond. Otsi kiriku ümbert lõhutud kvartaleid sellel 1946. aasta venekeelsel Nõukogude kaardil, mis tehti Nõukogude okupatsiooni alguses.',
      ru: '9 марта 1944 года советский авианалёт выжег значительную часть Таллина. В Старом городе сгорела церковь Нигулисте и был разрушен район улицы Харью. Разрушенные кварталы вокруг церкви видны на этой советской карте 1946 года, подписанной уже по-русски.',
    },
  },
  {
    id: '2000',
    year: 2000,
    map: 'history/2000.jpg',
    source: {
      en: 'Tallinn orthophoto 1:2000 (2000)',
      et: 'Tallinna ortofoto 1:2000 (2000)',
      ru: 'Ортофотоплан Таллина 1:2000 (2000)',
    },
    title: { en: 'Free again', et: 'Taas vaba', ru: 'Снова свободный' },
    text: {
      en: 'Estonia restored its independence in 1991, and in 1997 Tallinn’s Old Town was added to the UNESCO World Heritage List. This aerial photograph shows the town at the turn of the millennium, before the glass towers of the new centre went up.',
      et: 'Eesti taastas iseseisvuse 1991. aastal ja 1997. aastal kanti Tallinna vanalinn UNESCO maailmapärandi nimekirja. See aerofoto näitab linna aastatuhande vahetusel, enne uue kesklinna klaastornide kerkimist.',
      ru: 'Эстония восстановила независимость в 1991 году, а в 1997 году Старый город Таллина был включён в список Всемирного наследия ЮНЕСКО. Этот аэрофотоснимок показывает город на рубеже тысячелетий, до появления стеклянных башен нового центра.',
    },
  },
  {
    id: 'today',
    year: 9999,
    map: null,
    title: { en: 'Today', et: 'Täna', ru: 'Сегодня' },
  },
];
