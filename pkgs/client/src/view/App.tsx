import { useAtom } from 'jotai';
import { Suspense } from 'react';
import { commandAtom, countAtom } from '../state/state.ts';

const Count = () => {
  const [count, setCount] = useAtom(countAtom);
  return (
    <section>
      <h2>count: {count}</h2>
      <button type="button" onClick={() => setCount((c) => c - 1)}>
        -1
      </button>
      <button type="button" onClick={() => setCount((c) => c + 1)}>
        +1
      </button>
    </section>
  );
};

const Command = () => {
  const [command, setCommand] = useAtom(commandAtom);
  return (
    <section>
      <h2>command</h2>
      <input
        value={command}
        onChange={(e) => setCommand(e.target.value)}
        placeholder="ここに入力…"
        style={{ width: '100%', padding: 8 }}
      />
    </section>
  );
};

export const App = () => (
  <div style={{ fontFamily: 'sans-serif', padding: 24, maxWidth: 480 }}>
    <h1>jotai-sync demo</h1>
    <p>サーバ経由でリアルタイムに同期します</p>

    <Suspense fallback={<p>loading count…</p>}>
      <Count />
    </Suspense>
    <Suspense fallback={<p>loading command…</p>}>
      <Command />
    </Suspense>
  </div>
);
