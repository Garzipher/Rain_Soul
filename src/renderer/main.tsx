import { createRoot } from 'react-dom/client';
import App from './App';
import textbook from 'virtual:rainsoul-textbook';
import { restoreDesktopApi } from './lib/desktop-api';

createRoot(document.getElementById('root')!).render(<App api={restoreDesktopApi(window.rainSoul)} textbook={textbook} />);
