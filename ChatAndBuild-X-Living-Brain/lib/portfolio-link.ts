// "View portfolio": take the user to the portfolio section on the home page with a smooth scroll and a short highlight.
export const PORTFOLIO_HASH = '#portfolio';
export function scrollToPortfolio(): boolean {
  const el = document.getElementById('portfolio'); if (!el) return false;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const flash = (n: Element) => { n.classList.remove('portfolio-flash'); void (n as HTMLElement).offsetWidth; n.classList.add('portfolio-flash'); setTimeout(() => n.classList.remove('portfolio-flash'), 2200); };
  flash(el); const grid = document.getElementById('positions'); if (grid) setTimeout(() => flash(grid), 250);
  return true;
}
