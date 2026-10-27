-- AlterTable
-- Additive: existing approvals default to the "hq" queue and no member is
-- routed to or reviewing the fraud queue until a root opts them in.
ALTER TABLE "PendingApproval" ADD COLUMN     "queue" TEXT NOT NULL DEFAULT 'hq';
ALTER TABLE "ProgramMembership" ADD COLUMN     "routeToFraudQueue" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ProgramMembership" ADD COLUMN     "canReviewFraudQueue" BOOLEAN NOT NULL DEFAULT false;
