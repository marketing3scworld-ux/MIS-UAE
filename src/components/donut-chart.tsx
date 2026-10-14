// Lightweight, dependency-free SVG donut/ring chart. Segments are drawn with
// stroke-dasharray arcs on stacked circles; optional centre label. Server-safe.
export type DonutSegment = { label: string; value: number; color: string };

export function DonutChart({
  segments,
  size = 116,
  thickness = 13,
  track = "#eef2f8",
  centerTop,
  centerBottom,
  centerColor = "#1e293b",
  subColor = "#94a3b8",
}: {
  segments: DonutSegment[];
  size?: number;
  thickness?: number;
  track?: string;
  centerTop?: string;
  centerBottom?: string;
  centerColor?: string;
  subColor?: string;
}) {
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  const r = (size - thickness) / 2;
  const C = 2 * Math.PI * r;
  const cx = size / 2;
  const lens = segments.map((s) => (s.value / total) * C);
  // Start of each arc = sum of the arcs before it.
  const offsets = lens.map((_, i) => lens.slice(0, i).reduce((a, l) => a + l, 0));

  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} className="block" role="img">
      <g transform={`rotate(-90 ${cx} ${cx})`}>
        <circle cx={cx} cy={cx} r={r} fill="none" stroke={track} strokeWidth={thickness} />
        {segments.map((s, i) => {
          const len = lens[i];
          return (
            <circle
              key={i}
              cx={cx}
              cy={cx}
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth={thickness}
              strokeDasharray={`${len} ${C - len}`}
              strokeDashoffset={-offsets[i]}
            >
              <title>{`${s.label}: ${s.value.toLocaleString()}`}</title>
            </circle>
          );
        })}
      </g>
      {centerTop ? (
        <text x={cx} y={cx - 1} textAnchor="middle" fontSize={size * 0.2} fontWeight={700} fill={centerColor}>
          {centerTop}
        </text>
      ) : null}
      {centerBottom ? (
        <text x={cx} y={cx + size * 0.12} textAnchor="middle" fontSize={size * 0.1} fill={subColor}>
          {centerBottom}
        </text>
      ) : null}
    </svg>
  );
}
