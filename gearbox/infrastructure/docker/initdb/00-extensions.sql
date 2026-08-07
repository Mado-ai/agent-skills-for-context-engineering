-- Extensions the schema depends on. Created once at database initialisation so that
-- migrations never need superuser privileges.
CREATE EXTENSION IF NOT EXISTS citext;    -- case-insensitive email / handle / slug
CREATE EXTENSION IF NOT EXISTS postgis;   -- place geometry (docs/11 §11.5)
