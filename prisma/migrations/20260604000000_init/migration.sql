-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "hcaId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "slackId" TEXT,
    "hackatimeId" TEXT,
    "isSuperAdmin" BOOLEAN NOT NULL DEFAULT false,
    "isProgramAuthor" BOOLEAN NOT NULL DEFAULT false,
    "hcbAccessToken" TEXT,
    "hcbRefreshToken" TEXT,
    "hcbTokenExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Program" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "yswsName" TEXT,
    "iconUrl" TEXT,
    "description" TEXT,
    "masterEndpoint" TEXT NOT NULL,
    "secretKey" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "hcbOrganizationId" TEXT,
    "hcbOrganizationName" TEXT,
    "hcbOrganizationSlug" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Program_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgramMembership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "invitedById" TEXT,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAccess" TIMESTAMP(3),
    "canViewReviews" BOOLEAN NOT NULL DEFAULT false,
    "canCreateReviews" BOOLEAN NOT NULL DEFAULT false,
    "canAuthorizeReviews" BOOLEAN NOT NULL DEFAULT false,
    "canViewFulfillments" BOOLEAN NOT NULL DEFAULT false,
    "canViewAddressData" BOOLEAN NOT NULL DEFAULT false,
    "canUpdateFulfillments" BOOLEAN NOT NULL DEFAULT false,
    "canUpdateProgram" BOOLEAN NOT NULL DEFAULT false,
    "isRoot" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ProgramMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckResult" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "shipId" TEXT NOT NULL,
    "checkId" TEXT NOT NULL,
    "family" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "passed" BOOLEAN NOT NULL DEFAULT false,
    "summary" TEXT NOT NULL DEFAULT '',
    "details" JSONB,
    "costUsd" DOUBLE PRECISION,
    "latencyMs" INTEGER,
    "ranAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CheckResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PendingInvite" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "invitedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PendingInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PendingApproval" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "shipId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "hoursAssigned" DOUBLE PRECISION NOT NULL,
    "feedbackMessage" TEXT NOT NULL,
    "justification" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "discardedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PendingApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardGrantTemplate" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "shopItemId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "purpose" TEXT,
    "oneTimeUse" BOOLEAN NOT NULL DEFAULT false,
    "preAuthorizationRequired" BOOLEAN NOT NULL DEFAULT false,
    "instructions" TEXT,
    "merchantLock" TEXT,
    "categoryLock" TEXT,
    "keywordLock" TEXT,
    "expirationDays" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CardGrantTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_hcaId_key" ON "User"("hcaId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ProgramMembership_userId_programId_key" ON "ProgramMembership"("userId", "programId");

-- CreateIndex
CREATE INDEX "CheckResult_programId_shipId_idx" ON "CheckResult"("programId", "shipId");

-- CreateIndex
CREATE INDEX "CheckResult_checkId_idx" ON "CheckResult"("checkId");

-- CreateIndex
CREATE UNIQUE INDEX "CheckResult_programId_shipId_checkId_key" ON "CheckResult"("programId", "shipId", "checkId");

-- CreateIndex
CREATE INDEX "AuditLog_programId_idx" ON "AuditLog"("programId");

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- CreateIndex
CREATE INDEX "PendingInvite_email_idx" ON "PendingInvite"("email");

-- CreateIndex
CREATE INDEX "PendingInvite_programId_idx" ON "PendingInvite"("programId");

-- CreateIndex
CREATE UNIQUE INDEX "PendingInvite_programId_email_key" ON "PendingInvite"("programId", "email");

-- CreateIndex
CREATE INDEX "PendingApproval_programId_idx" ON "PendingApproval"("programId");

-- CreateIndex
CREATE UNIQUE INDEX "PendingApproval_programId_shipId_reviewerId_key" ON "PendingApproval"("programId", "shipId", "reviewerId");

-- CreateIndex
CREATE INDEX "CardGrantTemplate_programId_idx" ON "CardGrantTemplate"("programId");

-- CreateIndex
CREATE UNIQUE INDEX "CardGrantTemplate_programId_shopItemId_key" ON "CardGrantTemplate"("programId", "shopItemId");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramMembership" ADD CONSTRAINT "ProgramMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramMembership" ADD CONSTRAINT "ProgramMembership_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckResult" ADD CONSTRAINT "CheckResult_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingInvite" ADD CONSTRAINT "PendingInvite_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingApproval" ADD CONSTRAINT "PendingApproval_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardGrantTemplate" ADD CONSTRAINT "CardGrantTemplate_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE;
