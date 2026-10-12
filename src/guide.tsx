import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Analytics } from '@vercel/analytics/react';
import { Guide } from './ui/Guide';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans-condensed/500.css';
import '@fontsource/ibm-plex-sans-condensed/600.css';
import './styles.css';

// The guide is a page of its own (guide.html): it reads without loading the simulator.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Guide />
    <Analytics mode={import.meta.env.DEV ? 'development' : 'production'} beforeSend={(e) => ({ ...e, url: e.url.split(/[?#]/)[0] })} />
  </StrictMode>,
);
