-- AlterTable
ALTER TABLE "User" ADD COLUMN     "pinnedProgramId" TEXT;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_pinnedProgramId_fkey" FOREIGN KEY ("pinnedProgramId") REFERENCES "Program"("id") ON DELETE SET NULL ON UPDATE CASCADE;
