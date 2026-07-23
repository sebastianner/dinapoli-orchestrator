import { Link } from "@tanstack/react-router";
import {
  LayoutDashboard,
  LayoutGrid,
  Wallet,
  UserRound,
  UtensilsCrossed,
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
  const overrideSeed = useAvatarOverrideStore((s) => (employee ? s.overrides[employee.id] : undefined));

  return (
    <aside className="flex h-full w-20 flex-col items-center justify-between border-r border-border bg-surface py-4 sm:w-24">
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
      </nav>

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
    </aside>
  );
}
