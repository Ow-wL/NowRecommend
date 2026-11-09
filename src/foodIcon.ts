// Food is shown as one object on a plain tinted tile, the way Apple and Toss stand a product alone on a quiet background.
// A consistent set of 3D icons replaces photos that differed in angle, light and quality, and an icon never claims to be
// a picture of this exact dish. Microsoft Fluent Emoji (MIT), pinned to one commit so the set cannot change under us.
const BASE = 'https://cdn.jsdelivr.net/gh/microsoft/fluentui-emoji@1ffb34c752ecf5d402f04cfb4b392c77f57c54bc/assets';

const ICONS: Record<string, string> = {
  '🍙': 'Rice ball', '🥘': 'Shallow pan of food', '🥩': 'Cut of meat', '🥓': 'Bacon', '🍲': 'Pot of food', '🍖': 'Meat on bone',
  '🍗': 'Poultry leg', '🍜': 'Steaming bowl', '🍚': 'Cooked rice', '🥣': 'Bowl with spoon', '🍳': 'Cooking', '🍝': 'Spaghetti',
  '🍢': 'Oden', '🥟': 'Dumpling', '🍱': 'Bento box', '🍣': 'Sushi', '🥞': 'Pancakes', '🍕': 'Pizza', '🍔': 'Hamburger', '🥗': 'Green salad',
  '🌮': 'Taco', '🍛': 'Curry rice', '🌭': 'Hot dog', '🍤': 'Fried shrimp', '🧇': 'Waffle', '🍰': 'Shortcake', '🍧': 'Shaved ice', '🍡': 'Dango',
  '🥪': 'Sandwich', '🍞': 'Bread', '🍟': 'French fries', '🍩': 'Doughnut', '🍽️': 'Fork and knife with plate',
};
// The set is warm and red-leaning, so the tiles stay on hues it stands out from. The hue follows the dish, not the icon:
// two noodle dishes share a bowl but not a tile.
const HUES = ['#F6B73C', '#62B96A', '#4D9DE0', '#9B7BE0'];
const hueOf = (key: string) => HUES[[...key].reduce((sum, ch) => (sum * 31 + ch.charCodeAt(0)) >>> 0, 7) % HUES.length];
// The catalog's emoji was picked as a hint, and some have no good object of their own: 삼계탕 is not a live chicken.
const ALIASES: Record<string, string> = { '🍥': '🍜', '🥢': '🍜', '🌶️': '🍲', '🍄': '🍚', '🐔': '🍲', '🐙': '🍡', '🥬': '🥩' };
const BY_ID: Record<string, string> = { f07: '🍚', 'f-tangsuyuk': '🍤' };
// AI picks can name any dish, so the name decides when the emoji does not.
const BY_NAME: [RegExp, string][] = [
  [/찌개|전골|국밥|[탕국]$/, '🍲'], [/파스타|스파게티/, '🍝'], [/면$|국수|라멘|우동|쌀국수/, '🍜'], [/초밥|스시|회$/, '🍣'], [/덮밥|볶음밥|밥$/, '🍚'],
  [/치킨|닭/, '🍗'], [/스테이크|갈비|구이|불고기|고기/, '🥩'], [/피자/, '🍕'], [/버거/, '🍔'], [/샐러드/, '🥗'], [/샌드위치|토스트/, '🥪'],
  [/만두|딤섬/, '🥟'], [/튀김|돈카츠|커틀릿/, '🍤'], [/커리|카레/, '🍛'], [/케이크|디저트/, '🍰'], [/빙수/, '🍧'], [/빵/, '🍞'],
];

const fileOf = (folder: string) => `${BASE}/${encodeURIComponent(folder)}/3D/${folder.toLowerCase().replace(/ /g, '_')}_3d.png`;
const known = (emoji?: string) => { const e = emoji && (ALIASES[emoji] || emoji); return e && ICONS[e] ? e : undefined; };

/** The icon for a dish and the hue of its tile. Every dish gets one; the plate is the last resort. */
export function foodIcon(item: { id?: string; parentId?: string; emoji?: string; name: string }): { src: string; hue: string } {
  const emoji = (item.id && BY_ID[item.id]) || (item.parentId && BY_ID[item.parentId]) || known(item.emoji)
    || BY_NAME.find(([pattern]) => pattern.test(item.name))?.[1] || '🍽️';
  return { src: fileOf(ICONS[emoji]), hue: hueOf(item.id || item.name) };
}
