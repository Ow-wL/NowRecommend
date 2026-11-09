import type { Category } from './data';
import { sides, typeName } from './tasteType';

// The taste type as a square picture to post: the four letters, the type's name, what each letter means, and where it came
// from. Drawn in the browser on a canvas, so nothing leaves the device until the person shares it.
const SIZE = 1080;
const COLORS: Record<Category, { bg: string; ink: string; fill: string }> = { food: { bg: '#FFEDE4', ink: '#B8360F', fill: '#D4411A' }, music: { bg: '#E9EDFF', ink: '#2338B0', fill: '#2B46D6' } };
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
export function drawTypeCard(canvas: HTMLCanvasElement, category: Category, code: string, owner = ''): void {
  canvas.width = SIZE; canvas.height = SIZE;
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('canvas');
  const colour = COLORS[category];
  ctx.fillStyle = colour.bg; ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.fillStyle = '#FFFFFF'; rounded(ctx, 72, 72, SIZE - 144, SIZE - 144, 56); ctx.fill();
  ctx.textBaseline = 'top'; ctx.textAlign = 'left';
  ctx.fillStyle = colour.ink; ctx.font = `600 34px ${FONT}`; ctx.fillText(`${owner ? `${owner}님의 ` : ''}${category === 'food' ? '음식' : '음악'} 취향 유형`, 144, 150);
  code.split('').forEach((letter, n) => {
    const x = 144 + n * 196, y = 224;
    ctx.fillStyle = colour.fill; rounded(ctx, x, y, 164, 184, 40); ctx.fill();
    ctx.fillStyle = '#FFFFFF'; ctx.font = `800 112px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(letter, x + 82, y + 98);
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  });
  ctx.fillStyle = '#1D1B18'; ctx.font = `800 66px ${FONT}`;
  const title = lines(ctx, typeName(category, code), SIZE - 288);
  title.forEach((line, n) => ctx.fillText(line, 144, 456 + n * 80));
  let y = 456 + title.length * 80 + 40;
  for (const side of sides(category, code)) {
    ctx.fillStyle = colour.ink; ctx.font = `800 34px ${FONT}`; ctx.fillText(side.letter, 144, y);
    ctx.fillStyle = '#4E4A43'; ctx.font = `500 34px ${FONT}`; ctx.fillText(side.label, 200, y);
    y += 58;
  }
  ctx.fillStyle = '#6C675E'; ctx.font = `500 28px ${FONT}`;
  ctx.fillText('지금 추천 · 취향 유형 테스트', 144, SIZE - 220);
  ctx.fillText('ow-wl.github.io/NowRecommend', 144, SIZE - 176);
}
export function typeCardDataUrl(category: Category, code: string, owner = ''): string {
  const canvas = document.createElement('canvas'); drawTypeCard(canvas, category, code, owner); return canvas.toDataURL('image/png');
}
export function typeCardFile(category: Category, code: string, owner = ''): Promise<File> {
  const canvas = document.createElement('canvas'); drawTypeCard(canvas, category, code, owner);
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(new File([blob], `taste-type-${category}-${code}.png`, { type: 'image/png' })) : reject(new Error('blob')), 'image/png'));
}
export function downloadFile(file: File) {
  const url = URL.createObjectURL(file), a = document.createElement('a');
  a.href = url; a.download = file.name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export type CardOutcome = 'shared' | 'downloaded' | 'cancelled' | 'failed';
/** The picture through the share sheet where files can be shared, the text where only text can, and a download otherwise. */
export async function shareTypeCard(category: Category, code: string, owner = ''): Promise<CardOutcome> {
  const text = `내 ${category === 'food' ? '음식' : '음악'} 취향 유형은 ${code} · ${typeName(category, code)}! 지금 추천에서 알아봤어요.`;
  const url = `${location.origin}${location.pathname}`;
  try {
    const file = await typeCardFile(category, code, owner);
    const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
    if (typeof nav.share === 'function') {
      try { await nav.share(nav.canShare?.({ files: [file] }) ? { files: [file], title: '지금 추천', text, url } : { title: '지금 추천', text, url }); return 'shared'; }
      catch (error) { if ((error as Error).name === 'AbortError') return 'cancelled'; }
    }
    downloadFile(file); return 'downloaded';
  } catch { return 'failed'; }
}
