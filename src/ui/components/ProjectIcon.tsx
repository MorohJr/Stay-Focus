import { useEffect, useMemo } from 'react';
import type { Project } from '../../domain/schemas';
import { Q } from '../../services/queries';
import { useLive } from '../hooks';

/** An object URL for a stored image; revoked when the blob changes or the component unmounts. */
export function useBlobUrl(attachmentId: string | undefined): string | undefined {
  const a = useLive(() => (attachmentId ? Q.attachment(attachmentId) : Promise.resolve(null)), [attachmentId]);
  const url = useMemo(() => (a ? URL.createObjectURL(a.blob) : undefined), [a]);
  useEffect(() => {
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [url]);
  return url;
}

/** R-PRJ-3: the uploaded logo if there is one, else the emoji icon. */
export function ProjectIcon({ project, size = 40, radius = 12 }: { project: Pick<Project, 'icon' | 'logoId'>; size?: number; radius?: number }) {
  const url = useBlobUrl(project.logoId);
  const box = { width: size, height: size, borderRadius: radius, flex: 'none' as const, display: 'grid', placeItems: 'center', background: 'var(--surface2)', overflow: 'hidden', fontSize: Math.round(size * 0.55) };
  if (project.logoId && url) return <span style={box}><img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /></span>;
  return <span style={box}>{project.icon}</span>;
}

/** R-PRJ-3: the cover image as a background, or nothing. */
export function ProjectCover({ project, height, children }: { project: Pick<Project, 'coverId'>; height: number; children?: React.ReactNode }) {
  const url = useBlobUrl(project.coverId);
  if (!project.coverId || !url) return null;
  return (
    <div style={{ height, backgroundImage: `url(${url})`, backgroundSize: 'cover', backgroundPosition: 'center', position: 'relative' }} role="img" aria-label="תמונת רקע">
      {children}
    </div>
  );
}
