'use client';
import { useEffect, useRef } from 'react';
import { createChart, ColorType, type IChartApi, type ISeriesApi, type UTCTimestamp } from 'lightweight-charts';
import { priceDecimals } from '@/lib/format';

export interface Candle { time: number; open: number; high: number; low: number; close: number; volume?: number }

export function CandleChart({ candles, watermark }: { candles: Candle[]; watermark?: string }) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const vol = useRef<ISeriesApi<'Histogram'> | null>(null);

  useEffect(() => {
    if (!el.current) return;
    const c = createChart(el.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: '#8a8f9c', fontSize: 11 },
      grid: { vertLines: { color: '#1c1e26' }, horzLines: { color: '#1c1e26' } },
      rightPriceScale: { borderColor: '#23252e' },
      timeScale: { borderColor: '#23252e', timeVisible: true },
      crosshair: { mode: 0 },
      localization: { priceFormatter: (p: number) => p.toLocaleString('en-US', { minimumFractionDigits: priceDecimals(Math.abs(p) || 1), maximumFractionDigits: priceDecimals(Math.abs(p) || 1) }) },
      watermark: watermark ? { visible: true, text: watermark, color: 'rgba(255,255,255,0.04)', fontSize: 56 } : undefined,
    });
    series.current = c.addCandlestickSeries({ upColor: '#00c278', downColor: '#ff5b5b', borderVisible: false, wickUpColor: '#00c278', wickDownColor: '#ff5b5b' });
    vol.current = c.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: 'vol', lastValueVisible: false, priceLineVisible: false });
    c.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    chart.current = c;
    return () => { c.remove(); chart.current = null; };
  }, [watermark]);

  useEffect(() => {
    if (!series.current || !vol.current) return;
    // Dedupe by time (venues can repeat the live candle) — lightweight-charts requires strictly ascending times.
    const sorted = [...new Map(candles.map((k) => [k.time, k])).values()].sort((a, b) => a.time - b.time);
    const dp = priceDecimals(sorted[sorted.length - 1]?.close ?? 1);
    series.current.applyOptions({ priceFormat: { type: 'price', precision: dp, minMove: 1 / 10 ** dp } });
    series.current.setData(sorted.map((k) => ({ time: k.time as UTCTimestamp, open: k.open, high: k.high, low: k.low, close: k.close })));
    vol.current.setData(sorted.map((k) => ({ time: k.time as UTCTimestamp, value: k.volume ?? 0, color: k.close >= k.open ? 'rgba(0,194,120,0.35)' : 'rgba(255,91,91,0.35)' })));
  }, [candles]);

  return <div ref={el} className="h-full w-full" />;
}
