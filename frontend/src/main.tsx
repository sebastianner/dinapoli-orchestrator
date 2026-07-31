import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createRouter, RouterProvider } from '@tanstack/react-router';
import { SWRConfig } from 'swr';
import './styles/variables.scss';
import './styles/animations.scss';
import './styles/tailwind.css';
import { routeTree } from './routeTree.gen';

// The port isn't hardcoded (Vite bumps it if the default is taken) - this
// makes it easy to check what to type on another device (phone, tablet) on
// the same network instead of hunting through terminal output. The LAN IP
// itself isn't knowable from the browser (no such API) - /api/lan-ip asks
// the backend, which can see it via os.networkInterfaces().
const port = window.location.port || '80';
fetch('/api/lan-ip')
  .then((r) => r.json())
  .then(({ lanIp }: { lanIp: string | null }) => {
    console.log(
      lanIp
        ? `[Dinapoli] Running on port ${port} - connect other devices via http://${lanIp}:${port}`
        : `[Dinapoli] Running on port ${port} - couldn't detect this machine's LAN IP`,
    );
  })
  .catch(() => console.log(`[Dinapoli] Running on port ${port}`));

const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SWRConfig value={{ revalidateOnFocus: false }}>
      <RouterProvider router={router} />
    </SWRConfig>
  </StrictMode>,
);
