import { ArrowLeft, Info } from 'lucide-react';
import { CONTACT_EMAIL, LEGAL_VERSION, OPERATOR, PREVIOUS_VERSIONS, legalTitle, operatorKnown, privacySections, termsSections, versionLabel, type LegalKind } from '../legal';
import { fullPlayOn, previewsOn, weatherMode, youtubeOn } from '../features';
import { apiEnabled } from '../api/client';

/** An address written in a document is a link (YouTube's policies want theirs and Google's to be followable), and
 * `**…**` is shown in bold: what the terms must make plain (약관의 규제에 관한 법률 제3조). */
export function linked(text: string) {
  const links = (part: string, key: string) => part.split(/(https:\/\/[^\s)]*[^\s).,])/).map((piece, n) =>
    n % 2 ? <a key={`${key}-${n}`} href={piece} target="_blank" rel="noopener noreferrer">{piece}</a> : piece);
  return text.split(/\*\*(.+?)\*\*/).map((part, n) => n % 2 ? <strong key={n}>{links(part, `b${n}`)}</strong> : links(part, `t${n}`));
}

/** The terms of service or the privacy policy, as a page of its own (#/terms, #/privacy): linked from the sign-up form,
 * the home screen and the settings, and readable without an account. */
export function Legal({ kind, onBack, onOther }: { kind: LegalKind; onBack: () => void; onOther: () => void }) {
  const info = { operator: OPERATOR, contact: CONTACT_EMAIL, weather: weatherMode !== 'off', previews: previewsOn, player: fullPlayOn, youtube: youtubeOn && apiEnabled() };
  const sections = kind === 'terms' ? termsSections(info) : privacySections(info);
  return <article className="legal-page">
    <button className="text-button legal-back" onClick={onBack}><ArrowLeft size={15} /> 돌아가기</button>
    <h1>{legalTitle[kind]}</h1>
    <p className="small muted">시행일 {versionLabel(LEGAL_VERSION)}</p>
    {!operatorKnown() && <div className="notice warning" role="status"><Info size={18} /><div><strong>운영자 정보가 아직 등록되지 않았어요.</strong><p>운영자 이름과 문의 주소가 정해지면 이 문서에 표시돼요.</p></div></div>}
    {sections.map(section => <section key={section.title}>
      <h2>{section.title}</h2>
      {section.blocks.map((block, n) => Array.isArray(block) ? <ul key={n}>{block.map(line => <li key={line}>{linked(line)}</li>)}</ul> : <p key={n}>{linked(block)}</p>)}
    </section>)}
    {PREVIOUS_VERSIONS.length > 0 && <p className="legal-previous small muted">이전 판: {PREVIOUS_VERSIONS.map((version, n) => <span key={version}>{n > 0 && ', '}<a href={`${import.meta.env.BASE_URL ?? './'}legal/${version}/${kind}.html`} target="_blank" rel="noopener">{versionLabel(version)}</a></span>)}</p>}
    <p className="legal-other"><button className="text-button" onClick={onOther}>{legalTitle[kind === 'terms' ? 'privacy' : 'terms']} 보기</button>{CONTACT_EMAIL && <a className="text-button" href={`mailto:${CONTACT_EMAIL}`}>문의하기</a>}</p>
  </article>;
}
