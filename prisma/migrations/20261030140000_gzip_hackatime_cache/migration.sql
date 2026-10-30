-- AlterTable
-- It's a cache, so drop the jsonb rows rather than convert them: converting
-- means decompressing every multi-MB payload at once, the very load this
-- change takes off Postgres. They refill from Hackatime as reviews are opened.
TRUNCATE TABLE "HackatimeCache";
ALTER TABLE "HackatimeCache" DROP COLUMN "payload";
ALTER TABLE "HackatimeCache" ADD COLUMN     "payload" BYTEA NOT NULL;

-- Payloads arrive gzipped, so don't spend CPU trying to compress them again.
ALTER TABLE "HackatimeCache" ALTER COLUMN "payload" SET STORAGE EXTERNAL;
