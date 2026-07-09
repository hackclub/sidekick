-- CreateTable
CREATE TABLE "RejectionTemplate" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "feedbackMessage" TEXT NOT NULL,
    "internalMessage" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RejectionTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RejectionTemplate_programId_idx" ON "RejectionTemplate"("programId");

-- AddForeignKey
ALTER TABLE "RejectionTemplate" ADD CONSTRAINT "RejectionTemplate_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE;
