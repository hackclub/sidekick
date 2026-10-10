-- AlterTable
ALTER TABLE "ProgramMembership" ADD COLUMN     "canViewHeartbeats" BOOLEAN NOT NULL DEFAULT false;

-- Heartbeats were visible to every reviewer before this scope existed. Keep
-- them for members who already hold HQ-level permissions; everyone else falls
-- back to rough estimates until a root grants the scope.
UPDATE "ProgramMembership" SET "canViewHeartbeats" = true WHERE "isRoot" OR "canAuthorizeReviews";
