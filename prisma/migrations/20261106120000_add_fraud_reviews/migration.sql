-- CreateTable
CREATE TABLE "FraudReview" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "shipId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "note" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FraudReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FraudReview_programId_idx" ON "FraudReview"("programId");

-- CreateIndex
CREATE UNIQUE INDEX "FraudReview_programId_projectId_shipId_key" ON "FraudReview"("programId", "projectId", "shipId");

-- AddForeignKey
ALTER TABLE "FraudReview" ADD CONSTRAINT "FraudReview_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FraudReview" ADD CONSTRAINT "FraudReview_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

