import { useOrderNotificationStore } from "@/store/useOrderNotificationStore";

const RING_LENGTH = 176; // ~ circumference of the r=28 circle below
const ICON_LENGTH = 60; // long enough to cover either icon shape in one dash

const iconStrokeProps = {
  fill: "none" as const,
  stroke: "currentColor",
  strokeWidth: 4,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  className: "anim-stroke-draw",
  style: {
    strokeDasharray: ICON_LENGTH,
    strokeDashoffset: ICON_LENGTH,
    animationDelay: "0.35s",
  },
};

export function OrderNotification() {
  const kind = useOrderNotificationStore((s) => s.kind);
  if (!kind) return null;

  const isCreated = kind === "created";

  return (
    <div className="anim-fade-in fixed inset-0 z-60 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="anim-scale-in flex flex-col items-center gap-3 rounded-3xl bg-surface px-10 py-8 text-center shadow-lg">
        <svg
          width={64}
          height={64}
          viewBox="0 0 64 64"
          fill="none"
          className="text-brand-500"
        >
          <circle
            cx={32}
            cy={32}
            r={28}
            stroke="currentColor"
            strokeWidth={4}
            className="anim-stroke-draw"
            style={{
              strokeDasharray: RING_LENGTH,
              strokeDashoffset: RING_LENGTH,
            }}
          />
          {isCreated ? (
            // Up chevron - "sent up to the kitchen" motion.
            <polyline points="18,34 27,43 46,24" {...iconStrokeProps} />
          ) : (
            // Checkmark, same proportions as lucide's `check` icon scaled to this viewBox.
            <polyline points="48,22 26,44 16,34" {...iconStrokeProps} />
          )}
        </svg>
        <p className="text-lg font-semibold text-text-primary">
          {kind === "created" ? "¡Orden enviada!" : "¡Orden cobrada!"}
        </p>
        <p className="text-sm text-text-secondary">
          {kind === "created"
            ? "La cocina ya la tiene en cola."
            : "La cuenta quedó cerrada."}
        </p>
      </div>
    </div>
  );
}
