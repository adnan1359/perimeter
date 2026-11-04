import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { Popup } from './popup/Popup.tsx';
import { Options } from './options/Options.tsx';
import { BlockedPage } from './pages/BlockedPage.tsx';
import './index.css';

function Root() {
  const path = window.location.pathname.toLowerCase();
  const searchParams = new URLSearchParams(window.location.search);
  const viewParam = searchParams.get('view');

  if (path.includes('popup') || viewParam === 'popup') {
    return (
      <div className="p-2 bg-neutral-950 min-h-screen flex items-center justify-center">
        <Popup />
      </div>
    );
  }

  if (path.includes('options') || viewParam === 'options') {
    return <Options />;
  }

  if (path.includes('blocked') || viewParam === 'blocked') {
    return <BlockedPage />;
  }

  return <App />;
}

createRoot(document.getElementById('root')!).render(<Root />);
