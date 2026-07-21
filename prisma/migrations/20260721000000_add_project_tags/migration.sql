-- CreateTable
CREATE TABLE "ProjectTagDefinition" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#6b7280',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectTagDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectTagAssignment" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectTagAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectTagDefinition_programId_idx" ON "ProjectTagDefinition"("programId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectTagDefinition_programId_label_key" ON "ProjectTagDefinition"("programId", "label");

-- CreateIndex
CREATE INDEX "ProjectTagAssignment_programId_projectId_idx" ON "ProjectTagAssignment"("programId", "projectId");

-- CreateIndex
CREATE INDEX "ProjectTagAssignment_programId_idx" ON "ProjectTagAssignment"("programId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectTagAssignment_tagId_projectId_key" ON "ProjectTagAssignment"("tagId", "projectId");

-- AddForeignKey
ALTER TABLE "ProjectTagDefinition" ADD CONSTRAINT "ProjectTagDefinition_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTagAssignment" ADD CONSTRAINT "ProjectTagAssignment_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "ProjectTagDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
