import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Analytics } from '@vercel/analytics/react';
import App from './App';
import { migrateStorage } from './migrate';
import { openShared } from './share';
import { Crashed, ErrorBoundary } from './ui/ErrorBoundary';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans-condensed/500.css';
import '@fontsource/ibm-plex-sans-condensed/600.css';
// LVGL's built-in fonts are Montserrat Medium; Bench's lvgl renders with the same face.
import '@fontsource/montserrat/500.css';
import '@fontsource/montserrat/700.css';
import './styles.css';

migrateStorage();

// A share link's setup is written before the first render, where App reads its own.
void openShared().then((shared) =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary fallback={(error) => <Crashed error={error} />}>
        <App shared={shared} />
      </ErrorBoundary>
      {/* Page views only, no cookies. The query and hash never leave: they could carry a device ID or a shared app. */}
      <Analytics
        mode={import.meta.env.DEV ? 'development' : 'production'}
        beforeSend={(e) => ({ ...e, url: e.url.split(/[?#]/)[0] })}
      />
    </StrictMode>,
  ),
);
