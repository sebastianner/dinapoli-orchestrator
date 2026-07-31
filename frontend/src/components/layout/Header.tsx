import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { useThemeStore } from '@/store/useThemeStore';
import logo from '@/assets/dinapoli-logo.png';

const dateFormatter = new Intl.DateTimeFormat('es-CO', { day: '2-digit', month: 'long', year: 'numeric' });
const timeFormatter = new Intl.DateTimeFormat('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
const dayFormatter = new Intl.DateTimeFormat('es-CO', { weekday: 'long' });

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function Header() {
  const [now, setNow] = useState(() => new Date());
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border bg-surface px-3 sm:h-16 sm:px-6">
      <div className="flex min-w-0 items-center gap-1.5 sm:gap-2.5">
        <img src={logo} alt="" className="h-6 w-6 shrink-0 rounded-full object-cover sm:h-9 sm:w-9" />
        <span className="truncate text-sm font-bold tracking-tight text-brand-600 sm:text-lg">Dinapoli Pizza</span>
      </div>

      <div className="flex shrink-0 items-center gap-2 sm:gap-6">
        <div className="text-right leading-tight">
          <p className="text-xs font-semibold text-text-primary sm:text-sm">{timeFormatter.format(now)}</p>
          <p className="hidden text-xs text-text-secondary sm:block">
            {capitalize(dayFormatter.format(now))}, {dateFormatter.format(now)}
          </p>
        </div>

        <button
          type="button"
          onClick={toggleTheme}
          aria-label="Cambiar tema"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border text-text-secondary transition-colors duration-fast hover:bg-brand-500/10 hover:text-brand-600 sm:h-9 sm:w-9"
        >
          {theme === 'dark' ? <Sun size={16} className="sm:h-[18px] sm:w-[18px]" /> : <Moon size={16} className="sm:h-[18px] sm:w-[18px]" />}
        </button>
      </div>
    </header>
  );
}
