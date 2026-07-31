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
// the same network instead of hunting through terminal output.
console.log(`[Dinapoli] Running on port ${window.location.port || '80'} - connect other devices via http://<this-machine's-LAN-IP>:${window.location.port || '80'}`);

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
