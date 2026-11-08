"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import { apiGet } from "../../lib/api";
import { useTerminal } from "../../store/terminal";

type Cell = { symbol: string; name: string | null; sector: string; marketCap: number | null; changePercent: number | null };
type Node = { name: string; children?: Node[]; data?: Cell };

function cellColor(chg: number) {
  const clamped = Math.max(-3, Math.min(3, chg));
  return clamped >= 0
    ? d3.interpolateRgb("#1a1a1a", "#00c853")(clamped / 3)
    : d3.interpolateRgb("#1a1a1a", "#ff3d3d")(-clamped / 3);
}

const sectorClipId = (name: string) => `sector-clip-${name.replace(/[^a-zA-Z0-9]/g, "")}`;

export default function HeatmapWidget() {
  const ref = useRef<HTMLDivElement>(null);
  const dataRef = useRef<Cell[] | undefined>(undefined);
  const sizeRef = useRef({ w: 0, h: 0 });
  const paintRef = useRef<(opts?: { force?: boolean }) => void>(() => {});
  const setActiveSymbol = useTerminal((s) => s.setActiveSymbol);
  const setActiveSymbolRef = useRef(setActiveSymbol);
  setActiveSymbolRef.current = setActiveSymbol;

  const [market, setMarket] = useState<"us" | "eu">("us");
  const { data, error } = useQuery({
    queryKey: ["heatmap", market],
    queryFn: () => apiGet<Cell[]>(`/api/heatmap?market=${market}`),
    refetchInterval: 3_000,
  });
  dataRef.current = data;

  // Own the SVG for the lifetime of the host div. Never `innerHTML = ""` — wiping the
  // container caused the F12-fixable flicker (clear → 1px size wobble → ResizeObserver → …).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const paint = (opts?: { force?: boolean }) => {
      const cells = dataRef.current;
      if (!cells) return;

      const width = el.clientWidth;
      const height = el.clientHeight;
      if (width === 0 || height === 0) return;

      const prev = sizeRef.current;
      const sizeChanged = Math.abs(width - prev.w) >= 1 || Math.abs(height - prev.h) >= 1;
      if (!opts?.force && !sizeChanged && el.querySelector("svg.heatmap")) return;
      sizeRef.current = { w: width, h: height };

      const valid = cells.filter((d) => d.marketCap && d.changePercent !== null);
      const root = d3
        .hierarchy<Node>({
          name: "root",
          children: [...d3.group(valid, (d) => d.sector)].map(([sector, items]) => ({
            name: sector,
            children: items.map((d) => ({ name: d.symbol, data: d })),
          })),
        })
        .sum((d) => d.data?.marketCap ?? 0)
        .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

      d3.treemap<Node>().size([width, height]).paddingInner(1).paddingTop(12)(root);

      let svgSel = d3.select(el).select<SVGSVGElement>("svg.heatmap");
      if (svgSel.empty()) {
        svgSel = d3
          .select(el)
          .append("svg")
          .attr("class", "heatmap")
          // block avoids inline baseline gap that grows clientHeight by a few px
          .style("display", "block")
          .style("overflow", "hidden");
      }
      const svg = svgSel.attr("width", width).attr("height", height);
      const sectors = root.children ?? [];

      svg
        .selectAll<SVGClipPathElement, any>("clipPath.sector-clip")
        .data(sectors, (d: any) => d.data.name)
        .join((enter) => {
          const cp = enter.append("clipPath").attr("class", "sector-clip");
          cp.append("rect");
          return cp;
        })
        .attr("id", (d: any) => sectorClipId(d.data.name))
        .select("rect")
        .attr("x", (d: any) => d.x0)
        .attr("y", (d: any) => d.y0)
        .attr("width", (d: any) => Math.max(0, d.x1 - d.x0 - 4))
        .attr("height", 12);

      svg
        .selectAll<SVGTextElement, any>("text.sector")
        .data(
          sectors.filter((d: any) => d.x1 - d.x0 > 20),
          (d: any) => d.data.name
        )
        .join("text")
        .attr("class", "sector")
        .attr("x", (d: any) => d.x0 + 3)
        .attr("y", (d: any) => d.y0 + 9)
        .attr("clip-path", (d: any) => `url(#${sectorClipId(d.data.name)})`)
        .attr("fill", "#808080")
        .attr("font-size", 8)
        .text((d: any) => d.data.name.toUpperCase());

      const leaf = svg
        .selectAll<SVGGElement, any>("g.leaf")
        .data(root.leaves(), (d: any) => d.data.data.symbol)
        .join("g")
        .attr("class", "leaf")
        .attr("transform", (d: any) => `translate(${d.x0},${d.y0})`)
        .style("cursor", "pointer")
        .on("click", (_e, d: any) => setActiveSymbolRef.current(d.data.data.symbol));

      leaf
        .selectAll<SVGRectElement, any>("rect.cell")
        .data((d) => [d])
        .join("rect")
        .attr("class", "cell")
        .attr("width", (d: any) => Math.max(0, d.x1 - d.x0))
        .attr("height", (d: any) => Math.max(0, d.y1 - d.y0))
        .attr("fill", (d: any) => cellColor(d.data.data.changePercent));

      leaf
        .selectAll("title")
        .data((d) => [d])
        .join("title")
        .text(
          (d: any) =>
            `${d.data.data.symbol} ${d.data.data.name ?? ""}: ${d.data.data.changePercent?.toFixed(2)}%`
        );

      leaf
        .selectAll<SVGTextElement, any>("text.sym")
        .data((d: any) => (d.x1 - d.x0 > 32 && d.y1 - d.y0 > 18 ? [d] : []))
        .join("text")
        .attr("class", "sym")
        .attr("x", 3)
        .attr("y", 11)
        .attr("fill", "#fff")
        .attr("font-size", 9)
        .attr("font-weight", "bold")
        .text((d: any) => d.data.data.symbol);

      leaf
        .selectAll<SVGTextElement, any>("text.chg")
        .data((d: any) => (d.x1 - d.x0 > 40 && d.y1 - d.y0 > 30 ? [d] : []))
        .join("text")
        .attr("class", "chg")
        .attr("x", 3)
        .attr("y", 22)
        .attr("fill", "#ddd")
        .attr("font-size", 8)
        .text(
          (d: any) =>
            `${d.data.data.changePercent >= 0 ? "+" : ""}${d.data.data.changePercent.toFixed(2)}%`
        );
    };

    paintRef.current = paint;

    let raf = 0;
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        paint();
      });
    };

    paint({ force: true });

    const obs = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      const prev = sizeRef.current;
      if (Math.abs(width - prev.w) < 1 && Math.abs(height - prev.h) < 1 && el.querySelector("svg.heatmap")) {
        return;
      }
      schedule();
    });
    obs.observe(el);

    return () => {
      obs.disconnect();
      if (raf) cancelAnimationFrame(raf);
      paintRef.current = () => {};
    };
  }, []);

  useEffect(() => {
    if (!data) return;
    paintRef.current({ force: true });
  }, [data]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex gap-1 p-1 shrink-0">
        {(["us", "eu"] as const).map((m) => (
          <button key={m} className={`term-btn ${market === m ? "active" : ""}`} onClick={() => setMarket(m)}>
            {m.toUpperCase()}
          </button>
        ))}
      </div>
      <div className="relative flex-1 min-h-0 overflow-hidden">
        <div ref={ref} className="absolute inset-0 overflow-hidden" />
        {error ? (
          <div className="absolute inset-0 p-2 down bg-[var(--panel)]">Error: {(error as Error).message}</div>
        ) : !data ? (
          <div className="absolute inset-0 p-2 dim">Loading heatmap…</div>
        ) : null}
      </div>
    </div>
  );
}
