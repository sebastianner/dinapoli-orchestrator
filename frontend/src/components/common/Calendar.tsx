import { useState } from 'react';
import classNames from 'classnames';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const WEEKDAY_LABELS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const MONTH_FORMATTER = new Intl.DateTimeFormat('es-CO', { month: 'long', year: 'numeric' });

function toDateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

/** Monday-first weekday index (0 = Monday .. 6 = Sunday) for the 1st of the month. */
function firstWeekdayOffset(year: number, month: number): number {
  const jsDay = new Date(year, month, 1).getDay(); // 0 = Sunday
  return (jsDay + 6) % 7;
}

interface CalendarProps {
  /** YYYY-MM-DD */
  selectedDate: string;
  onSelectDate: (date: string) => void;
  /** Dates worth visually flagging, e.g. days with a register period or a closing report. */
  highlightedDates?: Set<string>;
  /** Dates after this one can't be selected (defaults to today). */
  maxDate?: string;
}

export function Calendar({ selectedDate, onSelectDate, highlightedDates, maxDate }: CalendarProps) {
  const [year, monthIndex] = selectedDate.split('-').map(Number);
  const [viewYear, setViewYear] = useState(year);
  const [viewMonth, setViewMonth] = useState(monthIndex - 1);

  const today = maxDate ?? new Date().toISOString().slice(0, 10);
  const totalDays = daysInMonth(viewYear, viewMonth);
  const offset = firstWeekdayOffset(viewYear, viewMonth);

  const goToPreviousMonth = () => {
    if (viewMonth === 0) {
      setViewYear((y) => y - 1);
      setViewMonth(11);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const goToNextMonth = () => {
    if (viewMonth === 11) {
      setViewYear((y) => y + 1);
      setViewMonth(0);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  return (
    <div className="w-72 rounded-2xl border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <button type="button" onClick={goToPreviousMonth} aria-label="Mes anterior" className="rounded-full p-1 text-text-secondary hover:bg-brand-500/10 hover:text-brand-600">
          <ChevronLeft size={18} />
        </button>
        <span className="text-sm font-semibold capitalize text-text-primary">{MONTH_FORMATTER.format(new Date(viewYear, viewMonth, 1))}</span>
        <button type="button" onClick={goToNextMonth} aria-label="Mes siguiente" className="rounded-full p-1 text-text-secondary hover:bg-brand-500/10 hover:text-brand-600">
          <ChevronRight size={18} />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-xs text-text-secondary">
        {WEEKDAY_LABELS.map((label) => (
          <span key={label} className="py-1 font-medium">
            {label}
          </span>
        ))}

        {Array.from({ length: offset }).map((_, i) => (
          <span key={`pad-${i}`} />
        ))}

        {Array.from({ length: totalDays }).map((_, i) => {
          const day = i + 1;
          const dateKey = toDateKey(viewYear, viewMonth, day);
          const isSelected = dateKey === selectedDate;
          const isHighlighted = highlightedDates?.has(dateKey);
          const isFuture = dateKey > today;

          return (
            <button
              key={dateKey}
              type="button"
              disabled={isFuture}
              onClick={() => onSelectDate(dateKey)}
              className={classNames(
                'flex h-8 w-8 items-center justify-center rounded-full text-sm transition-colors duration-fast',
                isSelected && 'bg-brand-500 font-semibold text-white',
                !isSelected && !isFuture && 'text-text-primary hover:bg-brand-500/10',
                !isSelected && isHighlighted && !isFuture && 'font-semibold text-brand-600',
                isFuture && 'cursor-not-allowed text-text-secondary opacity-40',
              )}
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}
