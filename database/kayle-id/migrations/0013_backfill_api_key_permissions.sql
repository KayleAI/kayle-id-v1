-- Backfill: any API key issued before scope enforcement landed has
-- `permissions = '[]'::jsonb`. Once the scope check is live those keys would
-- 403 on every gated v1 route. Grant the full scope set to the existing rows
-- so live integrations keep working; new and updated keys go through the
-- enum-validated `/v1/auth/api-keys` surface.
UPDATE "api_keys"
SET "permissions" = '["webhooks:read","webhooks:write","sessions:read","sessions:write","analytics:read"]'::jsonb
WHERE "permissions" = '[]'::jsonb;
