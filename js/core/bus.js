// Tiny publish/subscribe bus. Lets one screen react to a change in another without importing it
// (avoids circular imports: e.g. the amount picker emits 'diary:changed', the diary view re-renders).
// Events used so far: 'diary:changed' (entries added/edited/removed or state replaced), 'settings:changed'.
const handlers = new Map();

export function on(event, fn) {
  if (!handlers.has(event)) handlers.set(event, []);
  handlers.get(event).push(fn);
  return () => handlers.set(event, handlers.get(event).filter(h => h !== fn)); // unsubscribe
}

export function emit(event, detail) {
  for (const fn of handlers.get(event) || []) fn(detail);
}
