import { useAtom, useAtomValue } from 'jotai';
import { Suspense } from 'react';
import { greenAtom, redAtom, statusAtom, yellowAtom } from './state.ts';

export const App = () => (
  <Suspense fallback={<p>loading…</p>}>
    <Status />
    <div className="app">
      <Lights />
    </div>
  </Suspense>

);

const Lights = () => {
  const [r, setR] = useAtom(redAtom);
  const [y, setY] = useAtom(yellowAtom);
  const [g, setG] = useAtom(greenAtom);
  return (
    <div className="lights">
      <button type="button" className={`led ${r ? 'on' : 'off'}`} onClick={() => setR((p) => !p)} />
      <button type="button" className={`led ${y ? 'on' : 'off'}`} onClick={() => setY((p) => !p)} />
      <button type="button" className={`led ${g ? 'on' : 'off'}`} onClick={() => setG((p) => !p)} />
    </div>
  );
};

const Status = () => {
  const status = useAtomValue(statusAtom);
  return (
    <div className={`conn conn-${status}`}>
      <span className="conn-dot" />
      {status}
    </div>
  );
};
