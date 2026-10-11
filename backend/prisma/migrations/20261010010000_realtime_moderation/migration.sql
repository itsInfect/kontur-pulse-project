ALTER TABLE "Conference" ADD COLUMN "hiddenAt" TIMESTAMP(3);
ALTER TABLE "Participant" ADD COLUMN "mediaConnected" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "ConferenceModerator" (
    "conferenceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "canEnd" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ConferenceModerator_pkey" PRIMARY KEY ("conferenceId","userId")
);

CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "conferenceId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "actorId" TEXT,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AuditEvent_conferenceId_version_key" ON "AuditEvent"("conferenceId", "version");
CREATE INDEX "AuditEvent_conferenceId_createdAt_idx" ON "AuditEvent"("conferenceId", "createdAt");

ALTER TABLE "ConferenceModerator" ADD CONSTRAINT "ConferenceModerator_conferenceId_fkey" FOREIGN KEY ("conferenceId") REFERENCES "Conference"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConferenceModerator" ADD CONSTRAINT "ConferenceModerator_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_conferenceId_fkey" FOREIGN KEY ("conferenceId") REFERENCES "Conference"("id") ON DELETE CASCADE ON UPDATE CASCADE;
