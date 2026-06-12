-- AlterTable
ALTER TABLE "Program" ADD COLUMN     "theseusApiKey" TEXT;

-- CreateTable
CREATE TABLE "WarehouseTemplate" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "shopItemId" TEXT NOT NULL,
    "tags" TEXT NOT NULL,
    "userFacingTitle" TEXT,
    "metadata" JSONB,
    "contents" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WarehouseTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WarehouseTemplate_programId_idx" ON "WarehouseTemplate"("programId");

-- CreateIndex
CREATE UNIQUE INDEX "WarehouseTemplate_programId_shopItemId_key" ON "WarehouseTemplate"("programId", "shopItemId");

-- AddForeignKey
ALTER TABLE "WarehouseTemplate" ADD CONSTRAINT "WarehouseTemplate_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE;
