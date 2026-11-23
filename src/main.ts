import '@fontsource/biz-udpgothic/400.css';
import '@fontsource/biz-udpgothic/700.css';
import '@fontsource/dm-mono/400.css';
import '@fontsource/dm-mono/500.css';
import './ui/styles.css';
import { App } from './ui/app';
import { registerSW } from 'virtual:pwa-register';

const root = document.getElementById('app')!;
const app = new App(root);
if (import.meta.env.DEV) (window as any).__app = app; // デバッグ用

// 新しい版は、遊んでいる最中には切り替えない（開館の記録が消えないように）。
// 画面が裏に回ったときに更新して、次に開いたときから新しい版になる。
if (import.meta.env.PROD) {
  let waiting = false;
  let reg: ServiceWorkerRegistration | undefined;
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() { waiting = true; },
    onRegisteredSW(_url, r) { reg = r; }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && waiting) { waiting = false; updateSW(true); }
    if (!document.hidden) reg?.update().catch(() => {});
  });
}
