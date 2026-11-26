import Link from 'next/link';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { marked } from 'marked';
import { notFound } from 'next/navigation';

// Renders our own repo docs (trusted content, not user input).
// "Reference" = generated from each venue's own spec by scripts/gen-endpoint-docs.mjs (mainnet only).
const GROUPS = [
  {
    title: 'Reference (mainnet)',
    docs: [
      { slug: 'derive-api', file: 'docs/reference/derive-api.md', title: 'Options API — every method + greeks', note: '147 methods · 17 channels' },
      { slug: 'lighter-api', file: 'docs/reference/lighter-api.md', title: 'Perps API — every endpoint', note: '91 endpoints · 25 channels' },
      { slug: 'relay-api', file: 'docs/reference/relay-api.md', title: 'Relay — every endpoint', note: '62 endpoints' },
      { slug: 'bnb', file: 'docs/reference/bnb-bstocks.md', title: 'BNB Chain, bStocks & index', note: 'contracts · 26 tokens' },
    ],
  },
  {
    title: 'Guides',
    docs: [
      { slug: 'agent-build', file: 'docs/AGENT_BUILD.md', title: 'Agent build guide (step by step)' },
      { slug: 'agent', file: 'docs/AGENT.md', title: 'Agent integration guide (API)' },
      { slug: 'aster', file: 'docs/endpoints/aster.md', title: 'Perps (Aster) notes & gotchas' },
      { slug: 'lighter', file: 'docs/endpoints/lighter.md', title: 'Lighter notes (dormant)' },
      { slug: 'derive', file: 'docs/endpoints/derive.md', title: 'Options notes & gotchas' },
      { slug: 'relay', file: 'docs/endpoints/relay.md', title: 'Relay bridge notes' },
      { slug: 'bstocks', file: 'docs/endpoints/bstocks.md', title: 'bStocks notes' },
    ],
  },
];
const ALL = GROUPS.flatMap((g) => g.docs);

export default async function DocsPage({ params }: { params: Promise<{ slug?: string[] }> }) {
  const slug = (await params).slug?.[0] ?? 'derive-api';
  const doc = ALL.find((d) => d.slug === slug);
  if (!doc) notFound();
  const md = await readFile(path.join(process.cwd(), doc.file), 'utf8').catch(() => `# ${doc.title}\n\n_Not generated yet: run \`node scripts/gen-endpoint-docs.mjs\`._`);
  const html = await marked.parse(md);
  return (
    <div className="mx-auto grid max-w-7xl gap-4 lg:grid-cols-[250px_1fr]">
      <nav className="panel h-fit space-y-3 p-2 lg:sticky lg:top-20">
        {GROUPS.map((g) => (
          <div key={g.title}>
            <div className="px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wider text-muted">{g.title}</div>
            {g.docs.map((d) => (
              <Link key={d.slug} href={`/docs/${d.slug}`} className={`block rounded-lg px-3 py-2 text-sm ${d.slug === slug ? 'bg-panel2 text-white' : 'text-muted hover:text-white'}`}>
                {d.title}
                {'note' in d && d.note && <span className="block text-[11px] text-muted">{d.note}</span>}
              </Link>
            ))}
          </div>
        ))}
        <p className="px-3 pb-2 text-[11px] text-muted">Reference pages are generated from each venue&apos;s spec. Regenerate: <code>node scripts/gen-endpoint-docs.mjs</code></p>
      </nav>
      <article className="panel md min-w-0 p-6" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
