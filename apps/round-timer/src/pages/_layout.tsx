import { Outlet } from 'react-router-dom';

export default function Layout() {
  return (
    <div className="bg-background text-foreground flex flex-col min-h-svh">
      <Outlet />
    </div>
  );
}
