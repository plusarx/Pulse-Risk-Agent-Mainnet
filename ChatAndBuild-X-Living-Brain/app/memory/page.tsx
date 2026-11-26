'use client';
import { MemoryPanel } from '@/components/agent/MemoryPanel';

// What the chat agent remembers about the signed-in wallet, kept in Living Brain. The same panel is the Memory tab inside the chat window.
export default function MemoryPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Memory</h1>
        <p className="mt-1 text-sm text-muted">What the agent remembers about you between chats, so its answers start from your preferences and past decisions. Stored in Living Brain. It never holds balances or keys, and it never changes a number or approves anything for you.</p>
      </div>
      <div className="panel overflow-hidden"><MemoryPanel /></div>
    </div>
  );
}
