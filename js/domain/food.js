// Identity of a food across sources/recents/custom foods/saved measures. Pure.
export const foodKey = f => [f.name, f.brand, f.source].join('|');
