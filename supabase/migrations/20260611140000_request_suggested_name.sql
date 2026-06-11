-- Users can suggest a display name alongside the domain when requesting a
-- service ("Netflix" instead of "netflix.com"). Used when the admin approves
-- the request and the service row is created.

alter table service_requests add column if not exists suggested_name text;
