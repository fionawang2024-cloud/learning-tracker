export const DAILY_QUOTES = [
  { zh: "熟能生巧。", en: "Practice makes perfect." },
  { zh: "千里之行，始于足下。", en: "A journey of a thousand miles begins with a single step." },
  { zh: "活到老，学到老。", en: "Never too old to learn." },
  { zh: "今日事，今日毕。", en: "Never put off till tomorrow what you can do today." },
  { zh: "书山有路勤为径，学海无涯苦作舟。", en: "There is no royal road to learning." },
  { zh: "一分耕耘，一分收获。", en: "No pains, no gains." },
  { zh: "有志者事竟成。", en: "Where there is a will, there is a way." },
  { zh: "失败是成功之母。", en: "Failure is the mother of success." },
  { zh: "知识就是力量。", en: "Knowledge is power." },
  { zh: "时间就是金钱。", en: "Time is money." },
  { zh: "行动胜于言语。", en: "Actions speak louder than words." },
  { zh: "机不可失，时不再来。", en: "Opportunity seldom knocks twice." },
  { zh: "三思而后行。", en: "Look before you leap." },
  { zh: "人无完人。", en: "Every man has his faults." },
  { zh: "入乡随俗。", en: "When in Rome, do as the Romans do." },
  { zh: "好的开始是成功的一半。", en: "Well begun is half done." },
  { zh: "条条大路通罗马。", en: "All roads lead to Rome." },
  { zh: "欲速则不达。", en: "More haste, less speed." },
  { zh: "滴水穿石。", en: "Constant dripping wears away the stone." },
  { zh: "趁热打铁。", en: "Strike while the iron is hot." },
  { zh: "覆水难收。", en: "It is no use crying over spilt milk." },
  { zh: "一石二鸟。", en: "Kill two birds with one stone." },
  { zh: "眼见为实。", en: "Seeing is believing." },
  { zh: "人多好办事。", en: "Many hands make light work." },
  { zh: "知足常乐。", en: "Content is happiness." },
  { zh: "学而不思则罔，思而不学则殆。", en: "Learning without thinking is labor lost; thinking without learning is perilous." },
  { zh: "温故而知新。", en: "Reviewing the past helps you understand the new." },
  { zh: "读万卷书，行万里路。", en: "Read ten thousand books, travel ten thousand miles." },
  { zh: "不耻下问。", en: "Never feel embarrassed to ask and learn." },
  { zh: "坚持就是胜利。", en: "Perseverance leads to success." },
  { zh: "天道酬勤。", en: "Heaven rewards the diligent." },
  { zh: "少壮不努力，老大徒伤悲。", en: "A young idler, an old beggar." },
  { zh: "世上无难事，只怕有心人。", en: "Nothing in the world is difficult for one who sets his mind to it." },
  { zh: "兴趣是最好的老师。", en: "Interest is the best teacher." },
  { zh: "每天进步一点点。", en: "A little progress every day." },
];

export function getDailyQuote() {
  const start = new Date(2025, 0, 1);
  const today = new Date();
  const diff = Math.floor((today - start) / (24 * 60 * 60 * 1000));
  const index = Math.abs(diff) % DAILY_QUOTES.length;
  return DAILY_QUOTES[index];
}
