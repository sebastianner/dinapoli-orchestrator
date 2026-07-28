import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/ajustes/')({
  beforeLoad: () => {
    throw redirect({ to: '/ajustes/employees' });
  },
});
