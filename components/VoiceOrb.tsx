/** Warm circle that breathes with the voice level (0..1). Never red — recording should feel calm. */
export function VoiceOrb({ level, active, size = 200 }: { level: number; active: boolean; size?: number }) {
  const scale = 1 + Math.min(level, 1) * 0.45;
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }} aria-hidden>
      <div
        className="absolute inset-0 rounded-full bg-amber/25 transition-transform duration-100"
        style={{ transform: `scale(${active ? scale : 1})` }}
      />
      <div
        className={`absolute rounded-full bg-amber/40 ${active ? '' : 'animate-breathe'}`}
        style={{ inset: size * 0.14, transform: `scale(${active ? 1 + Math.min(level, 1) * 0.25 : 1})` }}
      />
      <div className="absolute rounded-full bg-amber shadow-inner" style={{ inset: size * 0.3 }} />
      <svg viewBox="0 0 24 24" className="relative text-ink" style={{ width: size * 0.22 }} fill="currentColor">
        <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z" />
      </svg>
    </div>
  );
}
