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

if (import.meta.env.PROD) registerSW({ immediate: true });
