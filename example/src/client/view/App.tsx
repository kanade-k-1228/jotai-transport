import { useAtom, useAtomValue } from 'jotai';
import { Suspense } from 'react';
import { commandAtom, countAtom, statusAtom } from '../state.ts';

const STATUS_LABEL = { connecting: '接続中…', open: '接続済み', closed: '切断' } as const;
const STATUS_COLOR = { connecting: '#e0a800', open: '#28a745', closed: '#dc3545' } as const;

const ConnectionStatus = () => {
  const status = useAtomValue(statusAtom);
  return (
    <p style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#555' }}>
      <span
        style={{
          width: 10,
          height: 10,
          borderRadius: '50%',
          background: STATUS_COLOR[status],
        }}
      />
      {STATUS_LABEL[status]}
    </p>
  );
};

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
    <h1>jotai-transport demo</h1>
    <p>サーバ経由でリアルタイムに同期します</p>
    <ConnectionStatus />

    <Suspense fallback={<p>loading count…</p>}>
      <Count />
    </Suspense>
    <Suspense fallback={<p>loading command…</p>}>
      <Command />
    </Suspense>
  </div>
);
