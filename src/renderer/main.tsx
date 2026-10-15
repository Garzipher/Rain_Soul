import { createRoot } from 'react-dom/client';
import App from './App';
import textbook from 'virtual:rainsoul-textbook';
import { restoreDesktopApi } from './lib/desktop-api';
import { MotionProvider } from './motion/motion-provider';

createRoot(document.getElementById('root')!).render(<MotionProvider><App api={restoreDesktopApi(window.rainSoul)} textbook={textbook} /></MotionProvider>);
