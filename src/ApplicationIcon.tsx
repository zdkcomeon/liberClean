import { memo, useEffect, useRef, useState } from 'react';
import { AppWindow } from 'lucide-react';
import { mole } from './api';
import type { InstalledApp } from './types';

interface Props {
  app: Pick<InstalledApp, 'id' | 'path'>;
  revision?: string | null;
  compact?: boolean;
}

/** Let macOS resolve the bundle's icon, including custom icons and app updates. */
export const ApplicationIcon = memo(function ApplicationIcon({ app, revision, compact = false }: Props) {
  const element = useRef<HTMLSpanElement>(null);
  const [image, setImage] = useState<{ id: string; src: string | null }>();
  const src = image?.id === app.id ? image.src : null;

  useEffect(() => {
    const target = element.current;
    const bridge = mole;
    if (!target || !bridge?.getApplicationIcon) return;
    let active = true;
    let requested = false;
    let observer: IntersectionObserver | undefined;
    const load = () => {
      if (requested) return;
      requested = true;
      observer?.disconnect();
      void bridge.getApplicationIcon(app.id).then(icon => {
        if (active) setImage({ id: app.id, src: icon });
      }).catch(() => {
        if (active) setImage({ id: app.id, src: null });
      });
    };
    if (typeof IntersectionObserver === 'undefined') load();
    else {
      observer = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) load();
      }, { rootMargin: '120px' });
      observer.observe(target);
    }
    return () => { active = false; observer?.disconnect(); };
  }, [app.id, app.path, revision]);

  return <span ref={element} className={`application-icon${compact ? ' compact-icon' : ''}${src ? '' : ' icon-placeholder'}`} aria-hidden="true">
    {src ? <img src={src} alt="" decoding="async" draggable={false} onError={() => setImage({ id: app.id, src: null })} /> : <AppWindow size={compact ? 14 : 20} strokeWidth={1.5} />}
  </span>;
});
