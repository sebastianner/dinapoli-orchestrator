import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/menu/')({
  beforeLoad: () => {
    throw redirect({ to: '/menu/todos' });
  },
});
