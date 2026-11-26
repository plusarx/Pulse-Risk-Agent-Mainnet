// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PriorityList } from '@/components/risk/PriorityList';

// Regression: the page passes a NEW `items` array on every render. The list's sync effect used to set a new
// array each time → render → effect → render… ("Maximum update depth exceeded" → Application error).

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Host() {
  const [value, setValue] = useState(['bsc_usdc', 'bsc_usdt', 'sell_bstocks']);
  const items = [ // fresh array every render, exactly like app/automation/page.tsx
    { id: 'bsc_usdc', label: 'USDC on BNB' }, { id: 'bsc_usdt', label: 'USDT on BNB' }, { id: 'sell_bstocks', label: 'Sell bStocks' },
  ];
  return createElement('div', null,
    createElement(PriorityList, { items, value, onChange: setValue }),
    createElement('output', { id: 'v' }, value.join(',')));
}

describe('PriorityList', () => {
  it('renders without an update loop and toggling keeps rows in place', () => {
    const errors: unknown[] = [];
    const orig = console.error; console.error = (...a: unknown[]) => { errors.push(a); };
    const el = document.createElement('div'); document.body.appendChild(el);
    const root = createRoot(el);
    try {
      act(() => { root.render(createElement(Host)); });
      const labels = () => [...el.querySelectorAll('li .truncate.text-sm')].map((n) => n.textContent);
      expect(labels()).toEqual(['USDC on BNB', 'USDT on BNB', 'Sell bStocks']);
      // Turn USDT off, then on again: it must stay in row 2, and the saved order must not reshuffle.
      const sw = () => el.querySelectorAll('button[role="switch"]')[1] as HTMLButtonElement;
      act(() => { sw().click(); });
      expect(el.querySelector('#v')!.textContent).toBe('bsc_usdc,sell_bstocks');
      act(() => { sw().click(); });
      expect(labels()).toEqual(['USDC on BNB', 'USDT on BNB', 'Sell bStocks']);
      expect(el.querySelector('#v')!.textContent).toBe('bsc_usdc,bsc_usdt,sell_bstocks');
      // Arrows reorder.
      act(() => { (el.querySelector('button[aria-label="Move Sell bStocks up"]') as HTMLButtonElement).click(); });
      expect(el.querySelector('#v')!.textContent).toBe('bsc_usdc,sell_bstocks,bsc_usdt');
    } finally {
      act(() => root.unmount()); console.error = orig;
    }
    expect(errors.filter((e) => String(e).includes('Maximum update depth'))).toHaveLength(0);
  });
});
