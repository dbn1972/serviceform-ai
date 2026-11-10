import { useCallback, useMemo, useReducer } from 'react';

/**
 * Undo/redo history for a designer document. Consecutive edits with the same `coalesce` key (one
 * text input being typed into) merge into one step so undo restores the previous value, not the
 * previous keystroke.
 */
export interface History<T> {
  past: T[];
  present: T;
  future: T[];
  lastKey: string | null;
}

export type HistoryAction<T> =
  | { type: 'apply'; next: T; coalesce?: string }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'reset'; next: T };

const LIMIT = 100;

export function historyReducer<T>(state: History<T>, action: HistoryAction<T>): History<T> {
  switch (action.type) {
    case 'apply': {
      if (action.next === state.present) return state;
      if (action.coalesce && action.coalesce === state.lastKey) {
        return { ...state, present: action.next, future: [] };
      }
      return {
        past: [...state.past, state.present].slice(-LIMIT),
        present: action.next,
        future: [],
        lastKey: action.coalesce ?? null,
      };
    }
    case 'undo': {
      const prev = state.past[state.past.length - 1];
      if (prev === undefined) return state;
      return {
        past: state.past.slice(0, -1),
        present: prev,
        future: [state.present, ...state.future],
        lastKey: null,
      };
    }
    case 'redo': {
      const [next, ...rest] = state.future;
      if (next === undefined) return state;
      return { past: [...state.past, state.present], present: next, future: rest, lastKey: null };
    }
    case 'reset':
      return { past: [], present: action.next, future: [], lastKey: null };
    default:
      return state;
  }
}

export function useHistory<T>(initial: () => T) {
  const [state, dispatch] = useReducer(historyReducer<T>, undefined, () => ({
    past: [],
    present: initial(),
    future: [],
    lastKey: null,
  }));
  const apply = useCallback(
    (next: T, coalesce?: string) =>
      dispatch(coalesce ? { type: 'apply', next, coalesce } : { type: 'apply', next }),
    [],
  );
  const undo = useCallback(() => dispatch({ type: 'undo' }), []);
  const redo = useCallback(() => dispatch({ type: 'redo' }), []);
  const reset = useCallback((next: T) => dispatch({ type: 'reset', next }), []);
  return useMemo(
    () => ({
      value: state.present,
      canUndo: state.past.length > 0,
      canRedo: state.future.length > 0,
      apply,
      undo,
      redo,
      reset,
    }),
    [state, apply, undo, redo, reset],
  );
}
