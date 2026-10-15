import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { LazyMotion, MotionConfig } from 'motion/react';
import { motionTokens } from './tokens';
import './motion.css';

const Preference = createContext({ reduced: false });
const loadFeatures = () => import('./motion-features').then(module => module.default);
export function useMotionPreference() { return useContext(Preference); }
export function MotionProvider({ children }: { children: ReactNode }) {
  const [reduced, setReduced] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!media) return;
    const update = () => setReduced(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.reducedMotion = String(reduced);
    for (const [name, value] of Object.entries(motionTokens)) {
      if (typeof value === 'number') root.style.setProperty(`--motion-${name.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`, `${value}ms`);
      else root.style.setProperty(`--motion-${name}`, `cubic-bezier(${value.join(',')})`);
    }
  }, [reduced]);
  return <Preference value={{ reduced }}><LazyMotion features={loadFeatures} strict><MotionConfig reducedMotion={reduced ? 'always' : 'never'}>{children}</MotionConfig></LazyMotion></Preference>;
}
