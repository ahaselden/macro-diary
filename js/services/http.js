// Network helper shared by the food-database services.
export async function getJSON(url){
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(url, {signal: ctl.signal});
    if (r.status === 429) throw new Error('rate limited – add your own USDA key in Settings');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } catch (e) { throw new Error(e.name === 'AbortError' ? 'timed out' : e.message === 'Failed to fetch' ? 'network error' : e.message); }
  finally { clearTimeout(t); }
}
