export type ChapterId = 'roots' | 'past' | 'love' | 'family' | 'life' | 'someday' | 'closing';

export const CHAPTERS: Record<ChapterId, { title: string; art: string }> = {
  roots: { title: 'รากเหง้า', art: '/art/chapter-roots.webp' },
  past: { title: 'วันวาน', art: '/art/chapter-past.webp' },
  love: { title: 'ความรัก', art: '/art/chapter-love.webp' },
  family: { title: 'ครอบครัว', art: '/art/chapter-family.webp' },
  life: { title: 'ชีวิตและการงาน', art: '/art/chapter-life.webp' },
  someday: { title: 'ถ้าสักวันหนึ่ง…', art: '/art/chapter-someday.webp' },
  closing: { title: 'เรื่องที่อยากเล่าเอง', art: '/art/thanks.webp' },
};

export const PLACEHOLDER = '{เรียก}';

export interface BankQuestion {
  id: number;
  chapter: Exclude<ChapterId, 'closing'>;
  text: string;
}

export const QUESTION_BANK: BankQuestion[] = [
  { id: 1, chapter: 'roots', text: 'พ่อกับแม่ของ{เรียก}เป็นคนแบบไหนครับ' },
  { id: 2, chapter: 'roots', text: 'บ้านที่{เรียก}โตมาหน้าตาเป็นยังไง แถวบ้านมีอะไรบ้าง' },
  { id: 3, chapter: 'roots', text: 'ตอนเด็ก ๆ {เรียก}ชอบเล่นอะไร เล่นกับใคร' },
  { id: 4, chapter: 'roots', text: 'ปู่ย่าตายายของ{เรียก}เคยเล่าเรื่องอะไรให้ฟังบ้าง' },
  { id: 5, chapter: 'past', text: 'ความทรงจำแรกที่{เรียก}จำได้คืออะไร' },
  { id: 6, chapter: 'past', text: 'อาหารที่{เรียก}คิดถึงที่สุดตอนเด็ก ใครทำให้กิน' },
  { id: 7, chapter: 'past', text: 'งานวัดหรือเทศกาลสมัยก่อนสนุกยังไง' },
  { id: 8, chapter: 'past', text: 'ตอนนั้นของที่อยากได้ที่สุดคืออะไร' },
  { id: 9, chapter: 'love', text: '{เรียก}เจอคู่ชีวิตครั้งแรกที่ไหน ตอนนั้นคิดอะไรอยู่' },
  { id: 10, chapter: 'love', text: 'ใครจีบใครก่อน จีบกันยังไง' },
  { id: 11, chapter: 'love', text: 'วันแต่งงานเป็นยังไงบ้าง' },
  { id: 12, chapter: 'family', text: 'วันแรกที่เห็นหน้าพ่อหรือแม่ของหนู {เรียก}รู้สึกยังไง' },
  { id: 13, chapter: 'family', text: 'พ่อหรือแม่ของหนูตอนเด็กเป็นเด็กแบบไหน ซนที่สุดเรื่องอะไร' },
  { id: 14, chapter: 'family', text: 'เพลงที่{เรียก}เคยร้องกล่อมลูก ร้องให้หลานฟังหน่อยได้ไหม 🎵' },
  { id: 15, chapter: 'life', text: '{เรียก}ทำงานอะไรมาบ้าง งานไหนชอบที่สุด' },
  { id: 16, chapter: 'life', text: 'ช่วงไหนในชีวิตที่ลำบากที่สุด ผ่านมาได้ยังไง' },
  { id: 17, chapter: 'life', text: 'เรื่องที่{เรียก}ภูมิใจในตัวเองที่สุดคืออะไร' },
  { id: 18, chapter: 'life', text: 'ใครคือคนที่ใจดีกับ{เรียก}ที่สุดในชีวิต' },
  { id: 19, chapter: 'life', text: 'ถ้าย้อนกลับไปได้ {เรียก}อยากบอกอะไรกับตัวเองตอนอายุ 20' },
  { id: 20, chapter: 'someday', text: 'ถ้าสักวันหนึ่งหลานท้อจนไม่อยากสู้ต่อ {เรียก}อยากบอกอะไร' },
  { id: 21, chapter: 'someday', text: 'ถ้าสักวันหนึ่งหลานต้องตัดสินใจเรื่องใหญ่ในชีวิต {เรียก}มีหลักคิดอะไรให้' },
  { id: 22, chapter: 'someday', text: 'ถ้าสักวันหนึ่งหลานมีลูก อยากให้เล่าเรื่องอะไรของ{เรียก}ให้เหลนฟัง' },
  { id: 23, chapter: 'someday', text: 'ถ้าสักวันหนึ่งหลานได้ไปบ้านเกิด{เรียก} ต้องไปที่ไหน ต้องกินอะไร' },
  { id: 24, chapter: 'someday', text: 'ถ้าสักวันหนึ่งหลานทะเลาะกับคนที่รัก {เรียก}อยากให้ทำยังไง' },
  { id: 25, chapter: 'someday', text: 'ถ้าสักวันหนึ่งหลานคิดถึง{เรียก} อยากให้หลานทำอะไร' },
  { id: 26, chapter: 'someday', text: '{เรียก}อยากให้ทุกคนจดจำ{เรียก}แบบไหน' },
];

export const CLOSING_TEXT = 'มีเรื่องไหนที่{เรียก}อยากเล่า แต่หลานยังไม่ได้ถามไหมครับ';

/** light -> deep, with the lullaby in the middle, ending with a message to the future */
export const DEFAULT_QUESTION_IDS = [1, 5, 9, 12, 14, 16, 17, 20, 25, 26];

export interface QuestionInput {
  id?: string;
  chapter: ChapterId;
  text: string;
  isClosing?: boolean;
}

export interface QuestionDraft {
  id?: string;
  position: number;
  chapter: ChapterId;
  text: string;
  isClosing: boolean;
}

export function renderQuestion(text: string, callName: string): string {
  return text.split(PLACEHOLDER).join(callName.trim());
}

/** Keep user order, drop blanks, guarantee exactly one closing question at the end. */
export function normalizeQuestionList(input: QuestionInput[]): QuestionDraft[] {
  const body: Omit<QuestionDraft, 'position'>[] = [];
  let closing: Omit<QuestionDraft, 'position'> | undefined;

  for (const q of input) {
    const text = q.text.trim();
    if (!text) continue;
    if (q.isClosing || q.chapter === 'closing') {
      closing ??= { id: q.id, chapter: 'closing', text, isClosing: true };
      continue;
    }
    const chapter = q.chapter in CHAPTERS ? q.chapter : 'life';
    body.push({ id: q.id, chapter, text, isClosing: false });
  }

  closing ??= { chapter: 'closing', text: CLOSING_TEXT, isClosing: true };
  return [...body, closing].map((q, position) => ({ ...q, position }));
}

export function buildDefaultQuestionList(): QuestionDraft[] {
  const byId = new Map(QUESTION_BANK.map((q) => [q.id, q]));
  return normalizeQuestionList(
    DEFAULT_QUESTION_IDS.map((id) => {
      const q = byId.get(id)!;
      return { chapter: q.chapter, text: q.text };
    }),
  );
}
