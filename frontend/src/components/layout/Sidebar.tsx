import { Link } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Settings,
  LayoutGrid,
  Wallet,
  UserRound,
  UtensilsCrossed,
  BarChart3,
} from "lucide-react";
import classNames from "classnames";
import { avatarSrc } from "@/lib/avatar";
import { useAvatarOverrideStore } from "@/store/useAvatarOverrideStore";
import { useSessionStore } from "@/store/useSessionStore";

const links = [
  { to: "/select-employee", label: "Empleado", icon: UserRound },
  { to: "/tables", label: "Mesas", icon: LayoutGrid },
  { to: "/menu", label: "Menú", icon: UtensilsCrossed },
  { to: "/caja", label: "Caja", icon: Wallet },
  { to: "/dashboard", label: "Resumen", icon: LayoutDashboard },
] as const;

export function Sidebar() {
  const employee = useSessionStore((s) => s.employee);
  const isAdmin = employee?.role === "admin";
  const overrideSeed = useAvatarOverrideStore((s) => (employee ? s.overrides[employee.id] : undefined));

  return (
    <>
      {/* Tablet/desktop: vertical rail. Hidden below md - too narrow a strip
          to be worth the width it eats on a phone (see MobileNav below). */}
      <aside className="hidden h-full w-20 shrink-0 flex-col items-center justify-between border-r border-border bg-surface py-4 sm:w-24 md:flex">
        <nav className="flex flex-col items-center gap-2">
          {links.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              className="group flex w-16 flex-col items-center gap-1 rounded-xl px-2 py-3 text-text-secondary transition-colors duration-fast hover:bg-brand-500/10 hover:text-brand-600 data-[status=active]:bg-brand-500/10 data-[status=active]:text-brand-600 sm:w-20"
            >
              <Icon size={22} strokeWidth={1.75} />
              <span className="text-center text-[11px] font-medium leading-tight">
                {label}
              </span>
            </Link>
          ))}

          {isAdmin && (
            <Link
              to="/analytics"
              className="group flex w-16 flex-col items-center gap-1 rounded-xl px-2 py-3 text-text-secondary transition-colors duration-fast hover:bg-brand-500/10 hover:text-brand-600 data-[status=active]:bg-brand-500/10 data-[status=active]:text-brand-600 sm:w-20"
            >
              <BarChart3 size={22} strokeWidth={1.75} />
              <span className="text-center text-[11px] font-medium leading-tight">
                Analítica
              </span>
            </Link>
          )}

          {isAdmin && (
            <Link
              to="/ajustes"
              className="group flex w-16 flex-col items-center gap-1 rounded-xl px-2 py-3 text-text-secondary transition-colors duration-fast hover:bg-brand-500/10 hover:text-brand-600 data-[status=active]:bg-brand-500/10 data-[status=active]:text-brand-600 sm:w-20"
            >
              <Settings size={22} strokeWidth={1.75} />
              <span className="text-center text-[11px] font-medium leading-tight">
                Ajustes
              </span>
            </Link>
          )}
        </nav>

        <div className="flex flex-col items-center gap-2">
          <a
            href="https://aliados.rappi.com/orders-kanban"
            target="_blank"
            rel="noopener noreferrer"
            title="Rappi Colombia"
            className="group flex w-16 flex-col items-center gap-1 rounded-xl px-2 py-3 text-text-secondary transition-colors duration-fast hover:bg-brand-500/10 hover:text-brand-600 sm:w-20"
          >
            <img src="/rappi-logo-rounded-hd-free-png.webp" alt="Rappi" className="h-8 w-8 rounded-full" />
            <span className="text-center text-[11px] font-medium leading-tight">Rappi</span>
          </a>

          <Link
            to="/select-employee"
            title={employee ? employee.name : "Seleccionar empleado"}
            className={classNames(
              "flex h-12 w-12 items-center justify-center overflow-hidden rounded-full border-2 border-border bg-surface-raised shadow-sm",
              "transition-transform duration-fast hover:scale-105 active:scale-95",
            )}
          >
            {employee ? (
              <img src={avatarSrc(employee, overrideSeed)} alt={employee.name} className="h-full w-full" />
            ) : (
              <UserRound size={20} className="text-text-secondary" />
            )}
          </Link>
        </div>
      </aside>

      {/* Phone: horizontal bar pinned to the bottom instead. overflow-x-auto
          is a safety net, not the primary layout - shrink-0 on every item
          keeps them at a legible size and lets the row scroll rather than
          squeeze if an admin's extra links (Analítica/Ajustes) don't fit. */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 flex items-center gap-1 overflow-x-auto border-t border-border bg-surface px-2 py-1.5 md:hidden"
        style={{ paddingBottom: "calc(0.375rem + env(safe-area-inset-bottom))" }}
      >
        {links.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            className="group flex shrink-0 flex-col items-center gap-0.5 rounded-lg px-3 py-1 text-text-secondary transition-colors duration-fast data-[status=active]:text-brand-600"
          >
            <Icon size={20} strokeWidth={1.75} />
            <span className="text-center text-[10px] font-medium leading-tight">{label}</span>
          </Link>
        ))}

        {isAdmin && (
          <Link
            to="/analytics"
            className="group flex shrink-0 flex-col items-center gap-0.5 rounded-lg px-3 py-1 text-text-secondary transition-colors duration-fast data-[status=active]:text-brand-600"
          >
            <BarChart3 size={20} strokeWidth={1.75} />
            <span className="text-center text-[10px] font-medium leading-tight">Analítica</span>
          </Link>
        )}

        {isAdmin && (
          <Link
            to="/ajustes"
            className="group flex shrink-0 flex-col items-center gap-0.5 rounded-lg px-3 py-1 text-text-secondary transition-colors duration-fast data-[status=active]:text-brand-600"
          >
            <Settings size={20} strokeWidth={1.75} />
            <span className="text-center text-[10px] font-medium leading-tight">Ajustes</span>
          </Link>
        )}

        <a
          href="https://aliados.rappi.com/orders-kanban"
          target="_blank"
          rel="noopener noreferrer"
          title="Rappi Colombia"
          className="group flex shrink-0 flex-col items-center gap-0.5 rounded-lg px-3 py-1 text-text-secondary transition-colors duration-fast"
        >
          <img src="/rappi-logo-rounded-hd-free-png.webp" alt="Rappi" className="h-5 w-5 rounded-full" />
          <span className="text-center text-[10px] font-medium leading-tight">Rappi</span>
        </a>

        <Link
          to="/select-employee"
          title={employee ? employee.name : "Seleccionar empleado"}
          className="flex shrink-0 flex-col items-center gap-0.5 rounded-lg px-3 py-1"
        >
          <div className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-full border border-border bg-surface-raised">
            {employee ? (
              <img src={avatarSrc(employee, overrideSeed)} alt={employee.name} className="h-full w-full" />
            ) : (
              <UserRound size={13} className="text-text-secondary" />
            )}
          </div>
          <span className="text-center text-[10px] font-medium leading-tight text-text-secondary">
            {employee ? employee.name.split(" ")[0] : "Perfil"}
          </span>
        </Link>
      </nav>
    </>
  );
}
