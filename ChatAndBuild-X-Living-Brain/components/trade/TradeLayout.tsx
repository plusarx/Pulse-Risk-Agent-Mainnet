'use client';
import type { ReactNode } from 'react';

/** Backpack-style grid: header / [chart | book | ticket] / bottom tabs. Stacks on mobile. */
export function TradeLayout({ header, chart, book, ticket, bottom }: { header: ReactNode; chart: ReactNode; book: ReactNode; ticket: ReactNode; bottom: ReactNode }) {
  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_320px_360px]">
      <div className="xl:col-span-2">{header}</div>
      <div className="xl:row-span-3 xl:col-start-3 xl:row-start-1">{ticket}</div>
      <div className="panel h-[560px] p-3 flex flex-col min-w-0 overflow-hidden">{chart}</div>
      <div className="panel h-[560px] py-3 flex flex-col min-w-0 overflow-hidden">{book}</div>
      <div className="xl:col-span-2 panel min-h-[220px] min-w-0 overflow-x-auto p-3">{bottom}</div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="grid h-full min-h-[120px] place-items-center text-sm text-muted">{children}</div>;
}
