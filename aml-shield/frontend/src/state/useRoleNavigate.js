import { useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

function rolePrefix(pathname) {
  if (pathname.startsWith('/employee')) return '/employee';
  if (pathname.startsWith('/bsa'))      return '/bsa';
  return '/manager';
}

/**
 * Returns helpers that always prepend the current /manager or /employee prefix.
 *
 *   const { goTo, makePath, prefix } = useRoleNavigate();
 *   goTo('alerts')                 → /manager/alerts (or /employee/alerts)
 *   goTo(`sar-filing/${caseId}`)   → /manager/sar-filing/123
 *   <Link to={makePath('cases')} />
 *
 * Pass a string starting with "/" to bypass the prefix, e.g. goTo('/').
 */
export function useRoleNavigate() {
  const nav = useNavigate();
  const loc = useLocation();
  const prefix = rolePrefix(loc.pathname);

  const makePath = useCallback((segment) => {
    if (!segment) return prefix;
    if (segment.startsWith('/')) return segment;
    const trimmed = segment.replace(/^\/+/, '');
    return `${prefix}/${trimmed}`;
  }, [prefix]);

  const goTo = useCallback((segment, options) => {
    nav(makePath(segment), options);
  }, [nav, makePath]);

  return { goTo, makePath, prefix };
}
