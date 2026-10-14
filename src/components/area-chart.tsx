"use client";

// Lightweight, dependency-free SVG area chart (light theme). Smooth Catmull-Rom
// line + gradient fill, gridlines, refined axes, and an interactive hover tooltip.
import { useState, type MouseEvent } from "react";

export type ChartPoint = { label: string; value: number };

function smoothPath(pts: [number, number][]): string {
  if (pts.length < 2) return pts.length === 1 ? `M ${pts[0][0]} ${pts[0][1]}` : "";
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}

function niceMax(v: number): number {
  if (v <= 5) return 5;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

const LINE = "#2f6bd8";
const AXIS = "#94a3b8";
const GRID = "#eaeff7";

export function AreaChart({ data }: { data: ChartPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);

  const W = 680;
  const H = 244;
  const padL = 34;
  const padR = 16;
  const padT = 20;
  const padB = 30;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const values = data.map((d) => d.value);
  const max = niceMax(Math.max(1, ...values));

  const xs = data.map((_, i) =>
    data.length === 1 ? padL + innerW / 2 : padL + (i * innerW) / (data.length - 1),
  );
  const ys = data.map((d) => padT + innerH - (d.value / max) * innerH);
  const pts = xs.map((x, i) => [x, ys[i]] as [number, number]);
  const line = smoothPath(pts);
  const baseY = padT + innerH;
  const area = pts.length >= 2 ? `${line} L ${xs[xs.length - 1]} ${baseY} L ${xs[0]} ${baseY} Z` : "";

  function onMove(e: MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    const startF = padL / W;
    const endF = (W - padR) / W;
    const t = Math.min(1, Math.max(0, (ratio - startF) / (endF - startF)));
    setHover(Math.round(t * (data.length - 1)));
  }

  return (
    <div className="relative" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label="Documents expiring by month">
        <defs>
          <linearGradient id="bmeAreaLight" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={LINE} stopOpacity="0.22" />
            <stop offset="100%" stopColor={LINE} stopOpacity="0" />
          </linearGradient>
        </defs>

        {[0, 0.25, 0.5, 0.75, 1].map((tk) => {
          const y = padT + innerH * (1 - tk);
          return (
            <g key={tk}>
              <line x1={padL} y1={y} x2={W - padR} y2={y} stroke={GRID} strokeWidth="1" />
              <text x={padL - 8} y={y + 4} textAnchor="end" fontSize="11" fill={AXIS}>
                {Math.round(max * tk)}
              </text>
            </g>
          );
        })}

        {area ? <path d={area} fill="url(#bmeAreaLight)" /> : null}
        {line ? <path d={line} fill="none" stroke={LINE} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /> : null}

        {hover != null ? (
          <line x1={xs[hover]} y1={padT} x2={xs[hover]} y2={baseY} stroke={LINE} strokeWidth="1" strokeDasharray="3 3" strokeOpacity="0.55" />
        ) : null}

        {pts.map(([x, y], i) => (
          <g key={i}>
            <circle cx={x} cy={y} r={hover === i ? 5 : 3} fill="#ffffff" stroke={LINE} strokeWidth="2" />
            <text x={x} y={H - 9} textAnchor="middle" fontSize="12" fill={AXIS}>
              {data[i].label}
            </text>
          </g>
        ))}
      </svg>

      {hover != null ? (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-[calc(100%+8px)] whitespace-nowrap rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-center shadow-md"
          style={{ left: `${(xs[hover] / W) * 100}%`, top: `${(ys[hover] / H) * 100}%` }}
        >
          <div className="text-[11px] font-medium text-slate-500">{data[hover].label}</div>
          <div className="text-sm font-bold text-slate-800">{data[hover].value.toLocaleString()}</div>
        </div>
      ) : null}
    </div>
  );
}
