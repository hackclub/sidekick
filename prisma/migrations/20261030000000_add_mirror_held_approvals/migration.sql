-- AlterTable
-- Additive: off for every existing program, which keeps holding approvals
-- locally until someone opts it in.
ALTER TABLE "Program" ADD COLUMN     "mirrorHeldApprovals" BOOLEAN NOT NULL DEFAULT false;
