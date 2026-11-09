import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { HistoryEntry } from '../domain';
import { choicesByDay, monthCells, monthLabel, seoulDay, shiftMonth } from '../calendar';

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
/** A month at a glance: a dot per category on days with a final choice. Picking a day filters the list; picking it again clears. */
export function HistoryCalendar({ year, month, entries, selectedDay, onSelect, onMonth }: {
  year: number; month: number; entries: HistoryEntry[]; selectedDay: string; onSelect: (day: string) => void; onMonth: (year: number, month: number) => void;
}) {
  const byDay = choicesByDay(entries), today = seoulDay(new Date());
  const prev = shiftMonth(year, month, -1), next = shiftMonth(year, month, 1);
  return <section className="calendar" aria-label="기록 달력">
    <div className="calendar-head">
      <button className="icon-button" aria-label="이전 달" onClick={() => onMonth(prev.year, prev.month)}><ChevronLeft size={18} /></button>
      <b aria-live="polite">{monthLabel(year, month)}</b>
      <button className="icon-button" aria-label="다음 달" onClick={() => onMonth(next.year, next.month)}><ChevronRight size={18} /></button>
    </div>
    <div className="calendar-grid">
      {WEEKDAYS.map(w => <span key={w} className="weekday" aria-hidden="true">{w}</span>)}
      {monthCells(year, month).map((cell, n) => {
        if (!cell) return <span key={`blank-${n}`} aria-hidden="true" />;
        const counts = byDay.get(cell.day), total = counts ? counts.food + counts.music : 0, any = !!counts;
        return <button key={cell.day} className={`cal-day${cell.day === today ? ' today' : ''}`} disabled={!any} aria-pressed={selectedDay === cell.day}
          aria-label={`${month}월 ${cell.date}일${total ? `, 선택 ${total}개` : any ? ', 추천만 받음' : ''}`} onClick={() => onSelect(selectedDay === cell.day ? '' : cell.day)}>
          <span>{cell.date}</span>
          <span className="cal-dots" aria-hidden="true">{counts && counts.food > 0 && <i className="cal-dot food" />}{counts && counts.music > 0 && <i className="cal-dot music" />}{any && !total && <i className="cal-dot seen" />}</span>
        </button>;
      })}
    </div>
  </section>;
}
