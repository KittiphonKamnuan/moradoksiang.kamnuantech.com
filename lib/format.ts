export function formatDuration(ms: number | null | undefined): string {
  if (!ms || ms < 0) return '0:00';
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function formatMinutesThai(ms: number): string {
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return 'ไม่ถึง 1 นาที';
  if (minutes < 60) return `${minutes} นาที`;
  return `${Math.floor(minutes / 60)} ชั่วโมง ${minutes % 60} นาที`;
}
