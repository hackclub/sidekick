-- CreateTable
CREATE TABLE "ProgramStatsSnapshot" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "pendingReviewCount" INTEGER NOT NULL,
    "pendingFulfillmentCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProgramStatsSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProgramStatsSnapshot_programId_date_key" ON "ProgramStatsSnapshot"("programId", "date");

-- AddForeignKey
ALTER TABLE "ProgramStatsSnapshot" ADD CONSTRAINT "ProgramStatsSnapshot_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE;
