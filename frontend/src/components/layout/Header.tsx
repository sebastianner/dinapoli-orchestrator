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
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-border bg-surface px-6">
      <div className="flex items-center gap-2.5">
        <img src={logo} alt="" className="h-9 w-9 rounded-full object-cover" />
        <span className="text-lg font-bold tracking-tight text-brand-600">Dinapoli Pizza</span>
      </div>

      <div className="flex items-center gap-6">
        <div className="text-right leading-tight">
          <p className="text-sm font-semibold text-text-primary">{timeFormatter.format(now)}</p>
          <p className="text-xs text-text-secondary">
            {capitalize(dayFormatter.format(now))}, {dateFormatter.format(now)}
          </p>
        </div>

        <button
          type="button"
          onClick={toggleTheme}
          aria-label="Cambiar tema"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-border text-text-secondary transition-colors duration-fast hover:bg-brand-500/10 hover:text-brand-600"
        >
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </div>
    </header>
  );
}
