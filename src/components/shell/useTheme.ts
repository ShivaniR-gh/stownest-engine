import { useCallback, useEffect, useState } from 'react';

const KEY = 'sn.theme';

export function useTheme() {
  const [theme, setTheme] = useState<'light' | 'dark'>(
    () => (localStorage.getItem(KEY) as 'light' | 'dark') ?? 'light',
  );
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(KEY, theme);
  }, [theme]);
  return { theme, toggle: useCallback(() => setTheme(t => (t === 'light' ? 'dark' : 'light')), []) };
}

export function useCollapsed() {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sn.rail') === '1');
  useEffect(() => { localStorage.setItem('sn.rail', collapsed ? '1' : '0'); }, [collapsed]);
  return { collapsed, toggle: useCallback(() => setCollapsed(c => !c), []) };
}
