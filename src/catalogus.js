import catalogus from './catalogus.json'

export const groepen = catalogus.groepen

// slug -> { ...item, groep }
const opSlug = {}
for (const g of groepen) for (const it of g.items) opSlug[it.slug] = { ...it, groep: g.titel }

export const vindItem = (slug) => opSlug[slug] || null
