// The persisted database stays version 1 for backup/cloud compatibility.
// v42 reused three IDs for both a family and its first child. Keep the family
// IDs and preserve their old, ambiguous rating on the newly distinct child.
function upgradeTasteProfileDb(db) {
  if (!db || db.version !== 1 || !db.people || typeof db.people !== "object" ||
      Array.isArray(db.people) || Number(db.taxonomyVersion || 0) >= 2) {
    return { db, changed: false };
  }
  const children = { folk: "folk-general", reggae: "reggae-general", classical: "classical-general" };
  for (const person of Object.values(db.people)) {
    const ratings = person?.genres;
    if (!ratings || typeof ratings !== "object" || Array.isArray(ratings)) continue;
    for (const [family, child] of Object.entries(children)) {
      if (Object.hasOwn(ratings, family) && !Object.hasOwn(ratings, child) &&
          ["like", "ok", "no"].includes(ratings[family])) {
        ratings[child] = ratings[family];
      }
    }
  }
  db.taxonomyVersion = 2;
  return { db, changed: true };
}
