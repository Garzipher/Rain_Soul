import { createRoot } from 'react-dom/client';
import App from './App';
import textbook from 'virtual:rainsoul-textbook';

createRoot(document.getElementById('root')!).render(<App api={window.rainSoul} textbook={textbook} />);
