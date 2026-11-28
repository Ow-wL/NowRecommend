import type { ReactElement } from 'react';
import type { Category } from '../data';

// A small drawing of each taste type (2026-11-29). Until now every music card was the same record with a mic and headphones
// and every food card the same bowl with chopsticks, so the 32 types looked alike; now each has a scene of its own taken
// from its name and one-line hook (a cassette for the memory DJ, a dumbbell for the workout booster, a gukbap pot, a mala
// hot pot, tacos...). Pastel fills with one deep line colour per category; loose marks (notes, sparkles, steam) use the
// category ink so they stay visible in dark mode. Motion is gentle and stops for people who ask for less (styles.css).
// Decorative: the code and name next to it say the same in words.

const Spark = ({ x, y, s = 1, delay = 0 }: { x: number; y: number; s?: number; delay?: number }) =>
  <path className="fxf ta-twinkle" style={delay ? { animationDelay: `${delay}s` } : undefined}
    d={`M${x} ${y - 10 * s}l${3 * s} ${7 * s} ${7 * s} ${3 * s}-${7 * s} ${3 * s}-${3 * s} ${7 * s}-${3 * s}-${7 * s}-${7 * s}-${3 * s} ${7 * s}-${3 * s}Z`} />;
const Note = ({ x, y, delay = 0 }: { x: number; y: number; delay?: number }) =>
  <g className="ta-bob" style={delay ? { animationDelay: `${delay}s` } : undefined}>
    <ellipse className="fxf" cx={x} cy={y} rx="6.5" ry="5" transform={`rotate(-20 ${x} ${y})`} />
    <path className="fx" d={`M${x + 5.5} ${y - 1}V${y - 24}q9 4 10 13`} />
  </g>;
const Heart = ({ x, y, s = 1, cls = 'c-pink' }: { x: number; y: number; s?: number; cls?: string }) =>
  <g transform={`translate(${x} ${y}) scale(${s})`}><path className={`${cls} ta-pulse`}
    d="M0 12C-10 5-13 1-13-4a6.5 6.5 0 0 1 13-2.5a6.5 6.5 0 0 1 13 2.5C13 1 10 5 0 12Z" /></g>;
const Steam = ({ xs, y }: { xs: number[]; y: number }) =>
  <g className="ta-steam">{xs.map(x => <path key={x} className="fx" d={`M${x} ${y}c-7-9 7-14 0-24`} />)}</g>;
const Moon = ({ x, y }: { x: number; y: number }) =>
  <path className="c-butter" d={`M${x + 4} ${y - 13}a13 13 0 1 0 9 22a11 11 0 0 1-9-22Z`} />;

const MUSIC: Record<string, () => ReactElement> = {
  // 떼창하는 레트로 팬: a retro mic over a crowd with hands up
  EVRF: () => <>
    <g className="ta-sway">
      <rect className="c-coral" x="110" y="78" width="20" height="56" rx="10" />
      <rect className="c-sky" x="102" y="72" width="36" height="12" rx="6" />
      <circle className="c-butter" cx="120" cy="50" r="24" />
      <path className="c-none" d="M100 42h40M97 52h46M101 62h38" />
    </g>
    <path className="c-pink" d="M30 170a24 24 0 0 1 48 0Z" /><circle className="c-pink" cx="54" cy="134" r="12" /><path className="fx" d="M38 150l-10-28M70 150l8-28" />
    <path className="c-mint" d="M162 170a24 24 0 0 1 48 0Z" /><circle className="c-mint" cx="186" cy="134" r="12" /><path className="fx" d="M170 150l-8-28M202 150l10-28" />
    <Note x={58} y={74} /><Note x={176} y={62} delay={0.8} /><Spark x={196} y={26} s={0.8} />
  </>,
  // 추억 플레이리스트 DJ: a cassette tape
  EVRB: () => <>
    <rect className="c-coral" x="48" y="50" width="144" height="94" rx="16" />
    <rect className="c-cream" x="62" y="62" width="116" height="30" rx="7" />
    <path className="c-none" d="M74 74h60M74 82h40" />
    <rect className="c-white" x="80" y="100" width="80" height="28" rx="14" />
    <g className="ta-spin-small"><circle className="c-sky" cx="100" cy="114" r="9" /><path className="c-none" d="M100 107v14M93 114h14" /></g>
    <g className="ta-spin-small"><circle className="c-sky" cx="140" cy="114" r="9" /><path className="c-none" d="M140 107v14M133 114h14" /></g>
    <path className="c-butter" d="M76 144l8-12h72l8 12Z" />
    <Heart x={196} y={40} s={0.9} /><Note x={42} y={40} />
  </>,
  // 신곡 첫 재생러: an alarm clock ringing at midnight
  EVNF: () => <>
    <circle className="c-butter" cx="80" cy="46" r="15" /><circle className="c-butter" cx="160" cy="46" r="15" />
    <path className="c-none" d="M90 142l-12 18M150 142l12 18" />
    <circle className="c-sky" cx="120" cy="98" r="50" />
    <circle className="c-white" cx="120" cy="98" r="39" />
    <path className="c-none" d="M120 64v6M120 126v6M86 98h6M148 98h6" />
    <path className="c-none ta-thick" d="M120 98V70M120 98l-3-20" />
    <circle className="c-coral" cx="120" cy="98" r="5" />
    <circle className="c-coral" cx="166" cy="62" r="11" /><path className="c-none" d="M166 56v8M166 68v.5" />
    <path className="fx ta-ring" d="M52 76c-8 12-8 32 0 44M36 66c-14 18-14 46 0 64" />
    <Spark x={200} y={110} s={0.9} /><Spark x={206} y={34} s={0.6} delay={0.9} />
  </>,
  // 운동 부스터 큐레이터: a dumbbell with speed lines
  EVNB: () => <>
    <g transform="rotate(-18 120 96)">
      <rect className="c-grey" x="56" y="89" width="128" height="14" rx="7" />
      <rect className="c-coral" x="30" y="70" width="18" height="52" rx="8" />
      <rect className="c-coral" x="46" y="58" width="22" height="76" rx="9" />
      <rect className="c-coral" x="172" y="58" width="22" height="76" rx="9" />
      <rect className="c-coral" x="192" y="70" width="18" height="52" rx="8" />
      <rect className="c-butter" x="104" y="86" width="32" height="20" rx="6" />
    </g>
    <path className="fx" d="M70 150h26M58 162h30M150 34h24M160 22h26" />
    <Note x={58} y={50} /><Note x={182} y={150} delay={0.6} />
  </>,
  // 전설의 라이브 감상가: an electric guitar mid-solo
  EIRF: () => <>
    <g transform="rotate(32 120 92) translate(120 92) scale(.92) translate(-120 -92)">
      <rect className="c-brown" x="113" y="10" width="14" height="70" rx="5" />
      <rect className="c-brown" x="108" y="0" width="24" height="18" rx="6" />
      <path className="c-coral" d="M120 64c16 0 24 12 19 24c-3 8 19 14 19 38c0 22-18 34-38 34s-38-12-38-34c0-24 22-30 19-38c-5-12 3-24 19-24Z" />
      <circle className="c-deep" cx="120" cy="114" r="10" />
      <rect className="c-deep" x="104" y="138" width="32" height="7" rx="3" />
      <path className="c-none ta-thin" d="M117 6v136M123 6v136" />
    </g>
    <path className="fx" d="M44 62c-6 8-6 20 0 28M32 54c-12 14-12 30 0 44" />
    <Spark x={196} y={40} /><Spark x={54} y={140} s={0.7} delay={1} />
  </>,
  // 그루브 타는 작업자: a laptop with an equaliser and notes
  EIRB: () => <>
    <rect className="c-sky" x="64" y="46" width="112" height="76" rx="11" />
    <rect className="c-white" x="74" y="56" width="92" height="56" rx="5" />
    <g className="ta-bars">{[0, 1, 2, 3, 4].map(n => <rect key={n} className={['c-coral', 'c-mint', 'c-butter', 'c-pink', 'c-mint'][n]} x={88 + n * 14} y="78" width="8" height="26" rx="4" style={{ animationDelay: `${n * 0.15}s` }} />)}</g>
    <path className="c-grey" d="M48 122h144l-10 16H58Z" />
    <rect className="c-coral" x="180" y="134" width="22" height="24" rx="6" /><path className="c-none" d="M202 140c8 0 8 12 0 12" />
    <Note x={44} y={70} /><Note x={194} y={52} delay={0.7} />
  </>,
  // 사운드 탐험가: a bass cabinet thumping through the night
  EINF: () => <>
    <rect className="c-butter" x="66" y="36" width="108" height="122" rx="18" />
    <circle className="c-grey" cx="120" cy="62" r="10" />
    <g className="ta-thump"><circle className="c-grey" cx="120" cy="114" r="34" /><circle className="c-white" cx="120" cy="114" r="22" /><circle className="c-deep" cx="120" cy="114" r="9" /></g>
    <path className="fx ta-ring" d="M50 92c-10 14-10 30 0 44M36 82c-16 20-16 44 0 64M190 92c10 14 10 30 0 44M204 82c16 20 16 44 0 64" />
    <Moon x={196} y={32} /><Spark x={44} y={36} s={0.6} />
  </>,
  // 비트로 달리는 러너: a running shoe with speed lines
  EINB: () => <>
    <g className="ta-bob">
      <path className="c-coral" d="M56 134V90c0-10 8-18 18-18h12c4 12 16 18 30 16l12-4c10 16 32 26 56 30 16 2 24 10 24 20Z" />
      <rect className="c-mint" x="52" y="80" width="16" height="44" rx="8" />
      <path className="c-mint" d="M180 116c12 2 20 8 22 18h-30c0-8 2-14 8-18Z" />
      <path className="c-none" d="M118 92l8 10M132 88l8 10M146 94l6 8" />
      <rect className="c-white" x="52" y="132" width="160" height="16" rx="8" />
    </g>
    <path className="fx" d="M20 96h22M12 114h26M24 132h16" />
    <Note x={176} y={54} /><Note x={78} y={42} delay={0.7} />
  </>,
  // 가사 곱씹는 낭만파: an open lyric notebook with a heart
  CVRF: () => <>
    <path className="c-sky" d="M40 58v96c28-6 56-4 80 6c24-10 52-12 80-6V58Z" />
    <path className="c-cream" d="M120 62c-20-10-48-12-72-8v92c24-4 52-2 72 8Z" />
    <path className="c-cream" d="M120 62c20-10 48-12 72-8v92c-24-4-52-2-72 8Z" />
    <path className="c-none" d="M62 76c14-2 30 0 44 4M62 92c14-2 30 0 44 4M62 108c14-2 30 0 44 4M62 124c10-1 20 0 30 2" />
    <Heart x={156} y={100} s={1.4} />
    <path className="fx" d="M134 70c4-4 8-4 10 0M178 130c4-4 8-4 10 0" />
    <Note x={52} y={36} /><Spark x={190} y={30} s={0.7} />
  </>,
  // 밤 라디오 청취자: a radio under the moon
  CVRB: () => <>
    <path className="fx" d="M84 72L62 30" /><circle className="fxf" cx="62" cy="30" r="5" />
    <rect className="c-coral" x="46" y="70" width="148" height="84" rx="20" />
    <circle className="c-cream" cx="90" cy="112" r="26" />
    <path className="c-none" d="M74 104h32M70 112h40M74 120h32" />
    <rect className="c-cream" x="128" y="88" width="50" height="18" rx="9" /><path className="c-none ta-thick" d="M150 91v12" />
    <circle className="c-butter" cx="140" cy="132" r="8" /><circle className="c-butter" cx="166" cy="132" r="8" />
    <Moon x={186} y={34} /><Spark x={144} y={30} s={0.6} /><Spark x={214} y={64} s={0.5} delay={1.1} />
  </>,
  // 감성 신곡 수집가: a fresh stack of sleeves and a tear
  CVNF: () => <>
    <rect className="c-pink" x="58" y="60" width="78" height="78" rx="12" transform="rotate(-12 97 99)" />
    <rect className="c-sky" x="104" y="52" width="78" height="78" rx="12" transform="rotate(10 143 91)" />
    <rect className="c-butter" x="78" y="68" width="84" height="84" rx="12" />
    <path className="c-sky" d="M120 84c11 15 19 25 19 35a19 19 0 0 1-38 0c0-10 8-20 19-35Z" />
    <path className="c-none" d="M112 124a8 8 0 0 0 8 6" />
    <Spark x={196} y={40} /><Spark x={48} y={44} s={0.7} delay={0.8} /><Spark x={194} y={150} s={0.6} delay={1.4} />
  </>,
  // 카페 플레이리스트 주인: a café cup steaming music
  CVNB: () => <>
    <ellipse className="c-cream" cx="120" cy="152" rx="62" ry="11" />
    <circle className="c-mint" cx="170" cy="110" r="16" /><circle className="c-white" cx="170" cy="110" r="7" />
    <path className="c-mint" d="M70 84h100v26c0 28-22 42-50 42s-50-14-50-42Z" />
    <ellipse className="c-brown" cx="120" cy="84" rx="50" ry="9" />
    <Heart x={120} y={84} s={0.45} cls="c-cream" />
    <Note x={98} y={54} /><Note x={140} y={40} delay={0.9} /><Spark x={58} y={46} s={0.6} />
  </>,
  // 재즈바 단골: a cocktail glass with an olive
  CIRF: () => <>
    <path className="c-white" d="M66 46h108l-54 58Z" />
    <path className="c-sky" d="M76 54h88l-44 46Z" />
    <path className="c-none ta-thick" d="M120 104v40" />
    <ellipse className="c-white" cx="120" cy="148" rx="30" ry="7" />
    <path className="c-none" d="M146 26L118 78" /><circle className="c-leaf" cx="130" cy="58" r="9" /><circle className="c-red" cx="132" cy="56" r="3" />
    <Note x={52} y={110} /><Note x={186} y={98} delay={0.8} /><Moon x={190} y={36} />
  </>,
  // 오후의 LP 애호가: a turntable in the afternoon sun
  CIRB: () => <>
    <rect className="c-brown" x="44" y="48" width="150" height="108" rx="18" />
    <g className="ta-spin"><circle className="c-vinyl" cx="108" cy="102" r="44" /><circle className="ta-groove" cx="108" cy="102" r="33" /><circle className="ta-groove" cx="108" cy="102" r="24" /><circle className="c-coral" cx="108" cy="102" r="13" /><circle className="c-cream" cx="108" cy="102" r="3" /></g>
    <circle className="c-grey" cx="174" cy="66" r="9" />
    <path className="c-none ta-thick" d="M174 66l-4 52-18 10" />
    <rect className="c-grey" x="150" y="122" width="12" height="10" rx="3" transform="rotate(-30 156 127)" />
    <circle className="c-butter ta-pulse" cx="204" cy="30" r="12" /><path className="fx" d="M204 10v-4M224 30h4M218 16l3-3M190 16l-3-3" />
  </>,
  // 앰비언트 탐구자: a drop and the ripples it leaves
  CINF: () => <>
    <ellipse className="c-sky" cx="120" cy="132" rx="80" ry="24" />
    <ellipse className="c-none ta-ripple" cx="120" cy="132" rx="54" ry="15" style={{ stroke: '#FFFFFF' }} />
    <ellipse className="c-none ta-ripple" cx="120" cy="132" rx="28" ry="8" style={{ stroke: '#FFFFFF', animationDelay: '1s' }} />
    <path className="c-mint ta-drop" d="M120 40c10 14 16 22 16 30a16 16 0 0 1-32 0c0-8 6-16 16-30Z" />
    <circle className="fxf" cx="70" cy="80" r="3" /><circle className="fxf" cx="172" cy="72" r="3" /><circle className="fxf" cx="186" cy="96" r="2" /><circle className="fxf" cx="56" cy="104" r="2" />
    <Spark x={190} y={36} s={0.6} /><Spark x={50} y={50} s={0.5} delay={1.2} />
  </>,
  // 집중 모드 장인: an hourglass where three hours vanish
  CINB: () => <>
    <path className="c-white" d="M86 40h68c0 32-26 38-26 52s26 20 26 52H86c0-32 26-38 26-52s-26-20-26-52Z" />
    <path className="c-butter" d="M96 54h48c-4 14-16 22-24 28-8-6-20-14-24-28Z" />
    <path className="c-butter" d="M94 144c4-16 16-24 26-26 10 2 22 10 26 26Z" />
    <path className="fx ta-sand" d="M120 84v32" style={{ stroke: '#E8B95E' }} />
    <rect className="c-sky" x="74" y="28" width="92" height="14" rx="7" /><rect className="c-sky" x="74" y="142" width="92" height="14" rx="7" />
    <path className="fx" d="M180 52h14l-14 16h14M196 32h9l-9 10h9" />
    <Note x={52} y={74} />
  </>,
};

const FOOD: Record<string, () => ReactElement> = {
  // 혼밥 국밥 장인: one bubbling ttukbaegi and one spoon
  SHTA: () => <>
    <ellipse className="c-butter" cx="116" cy="150" rx="64" ry="10" />
    <path className="c-brown" d="M58 92h116c0 34-22 56-58 56s-58-22-58-56Z" />
    <rect className="c-brown" x="52" y="84" width="128" height="14" rx="7" />
    <ellipse className="c-red" cx="116" cy="91" rx="56" ry="6" />
    <circle className="c-leaf" cx="96" cy="90" r="3.5" /><circle className="c-leaf" cx="128" cy="92" r="3.5" /><circle className="c-white" cx="112" cy="89" r="3" />
    <g transform="rotate(20 196 96)"><ellipse className="c-grey" cx="196" cy="62" rx="9" ry="12" /><rect className="c-grey" x="193" y="72" width="6" height="58" rx="3" /></g>
    <Steam xs={[92, 116, 140]} y={74} />
  </>,
  // 얼큰한 회식 대장: a round grill and two glasses clinking
  SHTG: () => <>
    <path className="fx" d="M90 166c-6-6 0-12 4-16 2 6 6 8 4 16M120 168c-6-6 0-12 4-16 2 6 6 8 4 16M150 166c-6-6 0-12 4-16 2 6 6 8 4 16" style={{ stroke: '#E8805F' }} />
    <ellipse className="c-grey" cx="120" cy="114" rx="76" ry="40" />
    <path className="c-none" d="M64 108l20-22M84 132l50-52M112 144l50-54M150 140l26-28" />
    <rect className="c-coral" x="76" y="98" width="40" height="16" rx="7" transform="rotate(-12 96 106)" />
    <rect className="c-pink" x="122" y="110" width="40" height="16" rx="7" transform="rotate(8 142 118)" />
    <rect className="c-coral" x="102" y="126" width="34" height="14" rx="6" transform="rotate(-4 119 133)" />
    <circle className="c-cream" cx="160" cy="96" r="6" /><circle className="c-cream" cx="74" cy="126" r="6" />
    <g transform="rotate(18 98 46)"><path className="c-white" d="M84 24h28l-4 44H88Z" /><path className="c-clear" d="M87 40h22l-2.5 24H89.5Z" style={{ stroke: 'none' }} /></g>
    <g transform="rotate(-18 142 46)"><path className="c-white" d="M128 24h28l-4 44h-20Z" /><path className="c-clear" d="M131 40h22l-2.5 24h-17Z" style={{ stroke: 'none' }} /></g>
    <Spark x={120} y={14} s={0.8} />
  </>,
  // 매운맛 탐험가: a big chilli, freshly found
  SHNA: () => <>
    <path className="c-red" d="M66 62c26-8 52 2 70 22 20 22 32 50 36 80 1 6-5 8-9 3-12-22-30-40-54-56-20-14-44-26-43-49Z" />
    <path className="c-none" d="M82 70c18 0 36 10 50 26" style={{ stroke: '#FFFFFF', opacity: 0.75 }} />
    <g transform="translate(180 70)"><path className="c-coral ta-flame" d="M0-26c8 10 16 16 13 28a13 13 0 0 1-26 0c-1-8 5-12 6-20 3 4 5 7 6 9 2-6 1-11 1-17Z" /><path className="c-butter" d="M0-6c4 5 6 8 5 13a5 5 0 0 1-10 0c0-4 3-6 5-13Z" style={{ stroke: 'none' }} /></g>
    <path className="c-leaf" d="M58 60c6-10 22-10 26 2-8 8-20 8-26-2Z" />
    <path className="c-none ta-thick" d="M68 56c-6-8-8-16-4-26" />
    <Spark x={52} y={128} s={0.8} delay={0.9} /><Spark x={146} y={30} s={0.6} delay={1.5} />
  </>,
  // 마라 원정대장: a split mala hot pot with an expedition flag
  SHNG: () => <>
    <rect className="c-grey" x="38" y="88" width="18" height="18" rx="6" /><rect className="c-grey" x="184" y="88" width="18" height="18" rx="6" />
    <circle className="c-grey" cx="120" cy="98" r="64" />
    <circle className="c-cream" cx="120" cy="98" r="54" />
    <path className="c-red" d="M120 44a54 54 0 0 1 0 108a27 27 0 0 1 0-54a27 27 0 0 0 0-54Z" />
    <ellipse className="c-coral" cx="150" cy="80" rx="8" ry="4" transform="rotate(30 150 80)" /><ellipse className="c-coral" cx="138" cy="128" rx="8" ry="4" transform="rotate(-20 138 128)" />
    <circle className="c-deep" cx="158" cy="108" r="2.5" /><circle className="c-deep" cx="144" cy="96" r="2.5" /><circle className="c-deep" cx="128" cy="140" r="2.5" />
    <circle className="c-leaf" cx="96" cy="80" r="5" /><circle className="c-white" cx="104" cy="118" r="6" /><circle className="c-leaf" cx="86" cy="104" r="4" />
    <path className="c-none ta-thick" d="M176 60V18" /><path className="c-butter ta-sway" d="M176 18l26 8-26 9Z" />
  </>,
  // 칼칼한 한 그릇파: noodles lifted out of one bowl
  SLTA: () => <>
    <path className="c-mint" d="M54 100h132c0 32-28 50-66 50s-66-18-66-50Z" />
    <ellipse className="c-coral" cx="120" cy="100" rx="64" ry="9" />
    <path className="c-none" d="M118 98c-6-12 6-20 0-34M126 98c-6-12 6-20 0-36M134 98c-6-12 6-20 0-34" style={{ stroke: '#F8D88F', strokeWidth: 5 }} />
    <path className="c-none" d="M118 98c-6-12 6-20 0-34M126 98c-6-12 6-20 0-36M134 98c-6-12 6-20 0-34" style={{ strokeWidth: 1.5 }} />
    <path className="c-none ta-stick" d="M146 18l-26 46M162 22l-28 44" />
    <circle className="c-red" cx="88" cy="98" r="5" /><circle className="c-leaf" cx="160" cy="98" r="4" />
    <Steam xs={[76, 168]} y={84} />
  </>,
  // 매콤한 분식 메이트: tteokbokki in a pan and a fish-cake skewer
  SLTG: () => <>
    <ellipse className="c-grey" cx="112" cy="120" rx="74" ry="32" />
    <ellipse className="c-red" cx="112" cy="116" rx="62" ry="24" />
    <rect className="c-cream" x="68" y="104" width="34" height="12" rx="6" transform="rotate(-14 85 110)" />
    <rect className="c-cream" x="98" y="120" width="34" height="12" rx="6" transform="rotate(10 115 126)" />
    <rect className="c-cream" x="108" y="96" width="34" height="12" rx="6" transform="rotate(-4 125 102)" />
    <rect className="c-cream" x="134" y="114" width="30" height="12" rx="6" transform="rotate(22 149 120)" />
    <path className="c-none ta-stick" d="M190 18l-8 108" />
    <rect className="c-butter" x="168" y="28" width="36" height="16" rx="8" transform="rotate(-6 186 36)" />
    <rect className="c-butter" x="160" y="46" width="36" height="16" rx="8" transform="rotate(4 178 54)" />
    <rect className="c-butter" x="166" y="64" width="36" height="16" rx="8" transform="rotate(-6 184 72)" />
    <Heart x={50} y={50} s={0.8} /><Heart x={70} y={36} s={0.6} cls="c-coral" />
  </>,
  // 향신료 산책자: a mortar, pestle and the scents rising
  SLNA: () => <>
    <rect className="c-butter" x="128" y="18" width="18" height="86" rx="9" transform="rotate(24 137 61)" />
    <path className="c-cream" d="M58 96h124c0 30-26 50-62 50s-62-20-62-50Z" />
    <ellipse className="c-brown" cx="120" cy="96" rx="62" ry="10" />
    <rect className="c-brown" x="92" y="142" width="56" height="10" rx="5" />
    <path className="c-brown" d="M60 42l4 9 9-4-4 9 9 4-9 4 4 9-9-4-4 9-4-9-9 4 4-9-9-4 9-4-4-9 9 4Z" />
    <rect className="c-coral" x="168" y="112" width="40" height="12" rx="6" transform="rotate(-24 188 118)" />
    <path className="c-leaf" d="M30 126c8-14 24-14 30-6-8 12-20 14-30 6Z" />
    <g className="ta-steam"><path className="fx" d="M96 80c-8-10 6-16-2-28M118 76c-8-10 6-18-2-30" /></g>
  </>,
  // 타코 파티 플래너: two tacos and confetti
  SLNG: () => <>
    <path className="c-leaf" d="M44 138a42 42 0 0 1 84 0Z" />
    <circle className="c-red" cx="72" cy="104" r="6" /><circle className="c-red" cx="98" cy="100" r="6" /><circle className="c-butter" cx="86" cy="96" r="4" />
    <path className="c-butter" d="M50 142a36 36 0 0 1 72 0Z" />
    <path className="c-leaf" d="M112 146a42 42 0 0 1 84 0Z" />
    <circle className="c-red" cx="140" cy="112" r="6" /><circle className="c-coral" cx="166" cy="108" r="6" /><circle className="c-white" cx="152" cy="104" r="4" />
    <path className="c-butter" d="M118 150a36 36 0 0 1 72 0Z" />
    <path className="c-none" d="M64 134c8-12 22-20 36-20M132 142c8-12 22-20 36-20" />
    <rect className="c-pink" x="58" y="40" width="8" height="14" rx="2" transform="rotate(30 62 47)" /><rect className="c-sky" x="176" y="44" width="8" height="14" rx="2" transform="rotate(-24 180 51)" /><rect className="c-mint" x="120" y="28" width="8" height="14" rx="2" transform="rotate(60 124 35)" />
    <Spark x={200} y={86} s={0.7} /><Spark x={38} y={76} s={0.6} delay={1} />
  </>,
  // 든든한 집밥 수호자: a rice cooker and a full bowl
  MHTA: () => <>
    <rect className="c-cream" x="54" y="60" width="124" height="92" rx="30" />
    <path className="c-sky" d="M58 80c0-24 28-36 58-36s58 12 58 36Z" />
    <rect className="c-grey" x="98" y="34" width="36" height="12" rx="6" />
    <rect className="c-sky" x="86" y="100" width="60" height="30" rx="10" />
    <circle className="c-coral" cx="102" cy="115" r="5" /><circle className="c-mint" cx="118" cy="115" r="5" />
    <Heart x={136} y={113} s={0.45} cls="c-coral" />
    <path className="c-coral" d="M164 136h48c0 14-10 22-24 22s-24-8-24-22Z" /><path className="c-white" d="M166 136c2-12 42-12 44 0Z" />
    <Steam xs={[92, 116]} y={30} />
  </>,
  // 푸짐한 한상 주인장: a table full of dishes, seen from above
  MHTG: () => <>
    <rect className="c-brown" x="34" y="44" width="172" height="110" rx="20" />
    <circle className="c-white" cx="120" cy="100" r="26" /><circle className="c-red" cx="120" cy="100" r="18" />
    <circle className="c-white" cx="66" cy="72" r="15" /><circle className="c-leaf" cx="66" cy="72" r="9" />
    <circle className="c-white" cx="174" cy="72" r="15" /><circle className="c-butter" cx="174" cy="72" r="9" />
    <circle className="c-white" cx="66" cy="128" r="15" /><circle className="c-pink" cx="66" cy="128" r="9" />
    <circle className="c-white" cx="174" cy="128" r="15" /><circle className="c-mint" cx="174" cy="128" r="9" />
    <circle className="c-white" cx="120" cy="58" r="10" /><circle className="c-coral" cx="120" cy="58" r="5" />
    <circle className="c-white" cx="120" cy="142" r="10" /><circle className="c-cream" cx="120" cy="142" r="5" />
    <Steam xs={[112, 128]} y={78} />
  </>,
  // 담백한 미식 연구가: a plain fish on a long plate, under the lens
  MHNA: () => <>
    <ellipse className="c-white" cx="110" cy="126" rx="78" ry="22" />
    <path className="c-sky" d="M54 120c20-24 66-26 92-4-26 22-72 22-92 4Z" />
    <path className="c-sky" d="M144 116l22-16v32Z" />
    <circle className="c-deep" cx="72" cy="116" r="3" /><path className="c-none" d="M94 106c6 6 6 14 0 20M108 104c6 7 6 17 0 24" />
    <circle className="c-butter" cx="76" cy="140" r="7" /><circle className="c-leaf" cx="150" cy="142" r="5" />
    <path className="c-none ta-stick" d="M190 76l18 20" />
    <circle className="c-white" cx="176" cy="60" r="22" style={{ fillOpacity: 0.75 }} />
    <Spark x={176} y={60} s={0.6} />
  </>,
  // 코스 요리 안내자: a cloche, served in order
  MHNG: () => <>
    <ellipse className="c-white" cx="120" cy="146" rx="76" ry="12" />
    <path className="c-butter" d="M58 140c0-42 28-66 62-66s62 24 62 66Z" />
    <path className="c-none" d="M80 118c4-16 14-26 28-30" style={{ stroke: '#FFFFFF', strokeWidth: 5 }} />
    <circle className="c-butter" cx="120" cy="68" r="8" />
    <rect className="c-butter" x="52" y="134" width="136" height="10" rx="5" />
    <path className="fx" d="M54 40h86" style={{ strokeDasharray: '2 10' }} />
    <circle className="c-coral" cx="54" cy="40" r="9" /><circle className="c-mint" cx="98" cy="40" r="9" /><circle className="c-sky" cx="142" cy="40" r="9" />
    <Spark x={192} y={52} s={0.8} />
  </>,
  // 맑은 국물 명상가: a spoonful of clear broth over a calm bowl
  MLTA: () => <>
    <ellipse className="c-white" cx="120" cy="138" rx="74" ry="22" />
    <ellipse className="c-clear" cx="120" cy="136" rx="60" ry="14" />
    <ellipse className="c-none ta-ripple" cx="120" cy="136" rx="34" ry="7" style={{ stroke: '#FFFFFF' }} />
    <path className="c-leaf" d="M146 132c6-8 16-8 20-2-6 6-14 6-20 2Z" />
    <rect className="c-grey" x="128" y="22" width="12" height="78" rx="6" transform="rotate(52 134 61)" />
    <ellipse className="c-grey" cx="96" cy="88" rx="30" ry="18" transform="rotate(-14 96 88)" />
    <ellipse className="c-clear" cx="96" cy="86" rx="21" ry="10" transform="rotate(-14 96 86)" />
    <path className="c-clear ta-drop" d="M82 106c4 6 7 10 7 13a7 7 0 0 1-14 0c0-3 3-7 7-13Z" />
    <Steam xs={[150, 170]} y={118} />
  </>,
  // 소풍 도시락 담당: gimbap in a lunchbox on a picnic mat
  MLTG: () => <>
    <rect className="c-pink" x="30" y="116" width="180" height="44" rx="10" />
    <path className="c-cream" d="M48 116h18v14H48ZM84 116h18v14H84ZM120 116h18v14h-18ZM156 116h18v14h-18ZM192 116h18v14h-18ZM66 130h18v14H66ZM102 130h18v14h-18ZM138 130h18v14h-18ZM174 130h18v14h-18ZM48 144h18v14H48ZM84 144h18v14H84ZM120 144h18v14h-18ZM156 144h18v14h-18Z" style={{ stroke: 'none' }} />
    <rect className="c-sky" x="56" y="50" width="128" height="78" rx="16" />
    <rect className="c-cream" x="64" y="58" width="112" height="62" rx="10" />
    {[90, 120, 150].map(x => <g key={x}><circle className="c-deep" cx={x} cy="89" r="15" /><circle className="c-white" cx={x} cy="89" r="11" style={{ stroke: 'none' }} />
      <circle className="c-butter" cx={x - 3} cy="86" r="3.5" style={{ stroke: 'none' }} /><circle className="c-leaf" cx={x + 4} cy="88" r="3.5" style={{ stroke: 'none' }} /><circle className="c-coral" cx={x} cy="93" r="3.5" style={{ stroke: 'none' }} /></g>)}
    <Spark x={200} y={40} s={0.7} /><Heart x={42} y={44} s={0.7} />
  </>,
  // 샐러드 실험가: a salad bowl and a flask of new dressing
  MLNA: () => <>
    <path className="c-leaf" d="M46 102c-2-16 12-24 22-18 2-14 20-18 28-8 6-12 26-12 30 2 12-6 26 4 22 18Z" />
    <circle className="c-red" cx="80" cy="92" r="7" /><circle className="c-butter" cx="116" cy="88" r="7" /><circle className="c-red" cx="134" cy="96" r="5" />
    <path className="c-white" d="M40 100h116c0 28-24 46-58 46s-58-18-58-46Z" />
    <path className="c-white" d="M170 46h18v24l20 38c3 7-1 14-9 14h-40c-8 0-12-7-9-14l20-38Z" />
    <path className="c-butter" d="M156 100h46l5 9c3 7-1 13-8 13h-40c-7 0-11-6-8-13Z" />
    <rect className="c-coral" x="166" y="38" width="26" height="10" rx="5" />
    <circle className="fxf ta-bob" cx="182" cy="84" r="3" /><circle className="fxf ta-bob" cx="190" cy="70" r="2" style={{ animationDelay: '.6s' }} />
    <Spark x={46} y={52} s={0.7} />
  </>,
  // 브런치 모임장: pancakes, a coffee and the next place pinned
  MLNG: () => <>
    <ellipse className="c-white" cx="104" cy="150" rx="70" ry="12" />
    <rect className="c-butter" x="50" y="124" width="108" height="20" rx="10" />
    <rect className="c-butter" x="54" y="106" width="100" height="20" rx="10" />
    <rect className="c-butter" x="58" y="88" width="92" height="20" rx="10" />
    <path className="c-brown" d="M62 92c0-10 84-10 84 0v4c-6 0-6 12-12 12s-6-8-12-8-6 14-14 14-6-10-14-10-6 6-12 6-6-8-10-8c-6 0-10-4-10-10Z" />
    <rect className="c-cream" x="92" y="74" width="24" height="12" rx="3" />
    <path className="c-red" d="M136 80c-10-2-12-14-4-18 4 2 8 2 12 0 8 4 4 16-8 18Z" /><path className="c-leaf" d="M134 62l4-6 4 6Z" />
    <rect className="c-mint" x="170" y="118" width="32" height="30" rx="8" /><path className="c-none" d="M202 126c10 0 10 14 0 14" /><ellipse className="c-cream" cx="186" cy="152" rx="24" ry="5" />
    <g className="ta-bob"><path className="c-coral" d="M188 30a16 16 0 0 1 16 16c0 12-16 26-16 26s-16-14-16-26a16 16 0 0 1 16-16Z" /><circle className="c-white" cx="188" cy="46" r="6" /></g>
  </>,
};

export function TypeArt({ category, code }: { category: Category; code: string }) {
  const scene = (category === 'food' ? FOOD : MUSIC)[code];
  return <svg className={`type-art ${category}`} viewBox="0 0 240 180" aria-hidden="true" focusable="false">
    <circle className="ta-halo" cx="120" cy="92" r="78" />
    <g className="ta-art">{scene ? scene() : <Spark x={120} y={92} s={2} />}</g>
  </svg>;
}
