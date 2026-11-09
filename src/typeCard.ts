import type { Category } from './data';
import { axisLeans, relatedTypes, shareSearch, sides, typeName, typeProfile, type TasteTypeResult } from './tasteType';

// The taste type as a picture to post: the four letters, the type's name, how far each axis leans, and where it came
// from. Drawn in the browser on a canvas, so nothing leaves the device until the person shares it.
const WIDTH = 1080, HEIGHT = 1350;
const COLORS: Record<Category, { bg: string; ink: string; fill: string; on: string }> = { food: { bg: '#FFE4D9', ink: '#A5472A', fill: '#FFDCCD', on: '#6E2A12' }, music: { bg: '#DCEAFB', ink: '#2F5F9E', fill: '#D6E6FA', on: '#1F4478' } };
const FONT = "'Pretendard Variable', Pretendard, 'Apple SD Gothic Neo', 'Noto Sans KR', 'Malgun Gothic', sans-serif";
function rounded(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function lines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const out: string[] = []; let line = '';
  for (const word of text.split(' ')) { const next = line ? `${line} ${word}` : word; if (ctx.measureText(next).width > maxWidth && line) { out.push(line); line = word; } else line = next; }
  if (line) out.push(line);
  return out;
}
type CardResult = Pick<TasteTypeResult, 'code' | 'counts'>;
/** A 4:5 picture, the shape feeds and chats show whole: letters, name, the one line, how far each axis leans, and the question back. */
export function drawTypeCard(canvas: HTMLCanvasElement, category: Category, result: CardResult, owner = ''): void {
  canvas.width = WIDTH; canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('canvas');
  const colour = COLORS[category], { code, counts } = result, left = 132, inner = WIDTH - left * 2;
  ctx.fillStyle = colour.bg; ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = '#FFFFFF'; rounded(ctx, 60, 60, WIDTH - 120, HEIGHT - 120, 56); ctx.fill();
  ctx.textBaseline = 'top'; ctx.textAlign = 'left';
  ctx.fillStyle = colour.ink; ctx.font = `600 34px ${FONT}`; ctx.fillText(`${owner ? `${owner}님의 ` : ''}${category === 'food' ? '음식' : '음악'} 취향 유형`, left, 128);
  code.split('').forEach((letter, n) => {
    const x = left + n * 208, y = 196;
    ctx.fillStyle = colour.fill; rounded(ctx, x, y, 192, 192, 40); ctx.fill();
    ctx.fillStyle = colour.on; ctx.font = `800 116px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(letter, x + 96, y + 102);
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  });
  ctx.fillStyle = '#1D1B18'; ctx.font = `800 66px ${FONT}`;
  let y = 428;
  for (const line of lines(ctx, typeName(category, code), inner)) { ctx.fillText(line, left, y); y += 80; }
  const profile = typeProfile(category, code);
  if (profile) { ctx.fillStyle = '#4E4A43'; ctx.font = `500 36px ${FONT}`; y += 4; for (const line of lines(ctx, profile.line, inner)) { ctx.fillText(line, left, y); y += 52; } }
  y += 28;
  const leans = axisLeans(category, counts);
  if (leans.length) for (const lean of leans) {
    const first = lean.aPercent >= 50;
    ctx.font = `600 30px ${FONT}`;
    ctx.fillStyle = first ? colour.ink : '#8A857C'; ctx.fillText(lean.aLabel, left, y);
    ctx.textAlign = 'right'; ctx.fillStyle = lean.aPercent <= 50 ? colour.ink : '#8A857C'; ctx.fillText(lean.bLabel, WIDTH - left, y); ctx.textAlign = 'left';
    ctx.fillStyle = '#EFEDE8'; rounded(ctx, left, y + 44, inner, 16, 8); ctx.fill();
    if (lean.aPercent > 0) { ctx.fillStyle = colour.ink; rounded(ctx, left, y + 44, Math.max(16, inner * lean.aPercent / 100), 16, 8); ctx.fill(); }
    y += 86;
  } else for (const side of sides(category, code)) {
    ctx.fillStyle = colour.ink; ctx.font = `800 34px ${FONT}`; ctx.fillText(side.letter, left, y);
    ctx.fillStyle = '#4E4A43'; ctx.font = `500 34px ${FONT}`; ctx.fillText(side.label, left + 56, y);
    y += 58;
  }
  // What fills the rest, as far as a long name and line leave room above the closing question.
  const footer = HEIGHT - 232;
  y += 12;
  if (profile && y + 84 <= footer) {
    ctx.fillStyle = '#8A857C'; ctx.font = `600 26px ${FONT}`; ctx.fillText(category === 'food' ? '찰떡 메뉴' : '좋아할 장면', left, y);
    ctx.fillStyle = '#1D1B18'; ctx.font = `600 32px ${FONT}`; ctx.fillText(profile.picks.join(' · '), left, y + 38);
    y += 92;
  }
  if (y + 44 <= footer) {
    const best = relatedTypes(category, code).best;
    ctx.fillStyle = '#8A857C'; ctx.font = `600 26px ${FONT}`; ctx.fillText('잘 맞는 유형', left, y + 4);
    ctx.fillStyle = '#1D1B18'; ctx.font = `600 32px ${FONT}`; ctx.fillText(`${best.code} ${best.name}`, left + 170, y);
  }
  ctx.fillStyle = colour.ink; ctx.font = `700 36px ${FONT}`; ctx.fillText('너는 어떤 유형이야?', left, HEIGHT - 212);
  ctx.fillStyle = '#6C675E'; ctx.font = `500 28px ${FONT}`; ctx.fillText('지금 추천 · ow-wl.github.io/NowRecommend', left, HEIGHT - 160);
}
export function typeCardDataUrl(category: Category, result: CardResult, owner = ''): string {
  const canvas = document.createElement('canvas'); drawTypeCard(canvas, category, result, owner); return canvas.toDataURL('image/png');
}
export function typeCardFile(category: Category, result: CardResult, owner = ''): Promise<File> {
  const canvas = document.createElement('canvas'); drawTypeCard(canvas, category, result, owner);
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(new File([blob], `taste-type-${category}-${result.code}.png`, { type: 'image/png' })) : reject(new Error('blob')), 'image/png'));
}
export function downloadFile(file: File) {
  const url = URL.createObjectURL(file), a = document.createElement('a');
  a.href = url; a.download = file.name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export type CardOutcome = 'shared' | 'downloaded' | 'cancelled' | 'failed';
const shareLine = (category: Category, code: string) => `내 ${category === 'food' ? '음식' : '음악'} 취향 유형은 ${code} · ${typeName(category, code)}! 너는 뭐야? 우리 궁합도 봐 줘.`;
const resultUrl = (results: Parameters<typeof shareSearch>[0], owner: string) => `${location.origin}${location.pathname}${shareSearch(results, owner)}#/type`;
/** The picture through the share sheet where files can be shared, and a download otherwise. */
export async function shareTypeCard(category: Category, result: CardResult, owner = ''): Promise<CardOutcome> {
  try {
    const file = await typeCardFile(category, result, owner);
    const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
    if (typeof nav.share === 'function' && nav.canShare?.({ files: [file] })) {
      try { await nav.share({ files: [file], title: '지금 추천', text: shareLine(category, result.code) }); return 'shared'; }
      catch (error) { if ((error as Error).name === 'AbortError') return 'cancelled'; }
    }
    downloadFile(file); return 'downloaded';
  } catch { return 'failed'; }
}
/** The link a friend can open: the share sheet where there is one, otherwise the clipboard. Apps often drop a link sent along with a file, so it goes alone. */
export async function shareTypeLink(category: Category, results: Parameters<typeof shareSearch>[0], owner = ''): Promise<'shared' | 'copied' | 'cancelled' | 'failed'> {
  const text = shareLine(category, results[category]!.code), url = resultUrl(results, owner);
  if (typeof navigator.share === 'function') {
    try { await navigator.share({ title: '지금 추천', text, url }); return 'shared'; }
    catch (error) { if ((error as Error).name === 'AbortError') return 'cancelled'; }
  }
  try { await navigator.clipboard.writeText(`${text}\n${url}`); return 'copied'; } catch { return 'failed'; }
}
