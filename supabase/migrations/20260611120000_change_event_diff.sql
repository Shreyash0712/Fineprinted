-- Adds structured diff details to change_events so the admin review UI can
-- render added/modified/removed clauses (with excerpts for removed clauses,
-- whose content lives only in the previous snapshot).
--
-- Shape:
-- {
--   "added":    [{ "hash": "...", "excerpt": "..." }],
--   "modified": [{ "hash": "...", "old_hash": "...", "excerpt": "...", "old_excerpt": "...", "similarity": 0.91 }],
--   "removed":  [{ "hash": "...", "excerpt": "..." }],
--   "cosmetic_count": 3,
--   "unchanged_count": 41,
--   "llm_calls": 5
-- }

alter table change_events add column if not exists diff jsonb;
