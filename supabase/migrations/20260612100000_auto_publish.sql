-- =============================================================================
-- Auto-publish: the review gate is removed. The pipeline now publishes
-- change events itself and recomputes the grade at the end of every run —
-- no admin "Publish" click. Low-confidence classifications remain excluded
-- from grades automatically (the only gate left), and the UI carries an
-- "AI can make mistakes" disclaimer instead of human-review claims.
--
-- Existing draft events are folded in as published (published_at keeps the
-- creation time so history stays chronological). Dismissed events stay
-- dismissed. The enum keeps the 'draft' value; nothing writes it anymore.
-- =============================================================================

update change_events
   set status = 'published',
       published_at = coalesce(published_at, created_at)
 where status = 'draft';

-- Services that now have published events should be publicly visible.
-- (Scores/grades refresh on each service's next pipeline run; the static
-- exporter computes scores from published clauses itself, so the site is
-- correct as soon as data is exported.)
update services s
   set status = 'active'
 where s.status = 'pending'
   and exists (
     select 1
       from documents d
       join change_events e on e.document_id = d.id
      where d.service_id = s.id
        and e.status = 'published'
   );
