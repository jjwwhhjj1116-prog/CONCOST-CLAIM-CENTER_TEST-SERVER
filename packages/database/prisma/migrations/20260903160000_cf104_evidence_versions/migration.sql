-- CF104: additive SQLite handoff. Does NOT enable the legacy Node /documents API as a Drive proxy.
-- No original DocumentVersion, credential or business record is rewritten.
CREATE TABLE IF NOT EXISTS "EvidenceVersion" (
  "id" TEXT PRIMARY KEY NOT NULL, "organizationId" TEXT NOT NULL, "caseId" TEXT NOT NULL,
  "category" TEXT NOT NULL, "documentVersionId" TEXT UNIQUE, "groupId" TEXT NOT NULL,
  "versionNumber" INTEGER NOT NULL CHECK("versionNumber">=1),
  "isLatest" BOOLEAN NOT NULL DEFAULT 1 CHECK("isLatest" IN (0,1)), "supersedesId" TEXT UNIQUE,
  "changeSummaryJson" TEXT NOT NULL DEFAULT '[]' CHECK(json_valid("changeSummaryJson")), "modelCode" TEXT NOT NULL DEFAULT '',
  FOREIGN KEY("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT,
  FOREIGN KEY("caseId") REFERENCES "CaseItem"("id") ON DELETE RESTRICT,
  FOREIGN KEY("documentVersionId") REFERENCES "DocumentVersion"("id") ON DELETE RESTRICT,
  FOREIGN KEY("supersedesId") REFERENCES "EvidenceVersion"("id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX IF NOT EXISTS "EvidenceVersion_groupId_versionNumber_key" ON "EvidenceVersion"("groupId","versionNumber");
CREATE INDEX IF NOT EXISTS "EvidenceVersion_organizationId_caseId_category_isLatest_idx" ON "EvidenceVersion"("organizationId","caseId","category","isLatest");
CREATE TRIGGER IF NOT EXISTS "EvidenceVersion_parent_guard" BEFORE INSERT ON "EvidenceVersion" WHEN NEW."supersedesId" IS NOT NULL BEGIN
  SELECT RAISE(ABORT,'evidence version conflict') WHERE NOT EXISTS (
    SELECT 1 FROM "EvidenceVersion" p WHERE p.id=NEW."supersedesId" AND p."organizationId"=NEW."organizationId"
      AND p."caseId"=NEW."caseId" AND p.category=NEW.category AND p."groupId"=NEW."groupId"
      AND p."isLatest"=1 AND NEW."versionNumber"=p."versionNumber"+1
  );
END;
CREATE TRIGGER IF NOT EXISTS "EvidenceVersion_archive" AFTER INSERT ON "EvidenceVersion" WHEN NEW."supersedesId" IS NOT NULL BEGIN
  UPDATE "EvidenceVersion" SET "isLatest"=0 WHERE id=NEW."supersedesId";
END;
CREATE TRIGGER IF NOT EXISTS "EvidenceVersion_update_guard" BEFORE UPDATE ON "EvidenceVersion" BEGIN
  SELECT RAISE(ABORT,'version identity is immutable') WHERE
    NEW.id IS NOT OLD.id OR NEW."organizationId" IS NOT OLD."organizationId" OR NEW."caseId" IS NOT OLD."caseId"
    OR NEW.category IS NOT OLD.category OR NEW."documentVersionId" IS NOT OLD."documentVersionId"
    OR NEW."groupId" IS NOT OLD."groupId" OR NEW."versionNumber" IS NOT OLD."versionNumber"
    OR NEW."supersedesId" IS NOT OLD."supersedesId" OR NEW."changeSummaryJson" IS NOT OLD."changeSummaryJson"
    OR NEW."modelCode" IS NOT OLD."modelCode" OR NOT (OLD."isLatest"=1 AND NEW."isLatest"=0);
END;
CREATE TRIGGER IF NOT EXISTS "EvidenceVersion_delete_guard" BEFORE DELETE ON "EvidenceVersion" BEGIN SELECT RAISE(ABORT,'versions are retained'); END;
CREATE TABLE IF NOT EXISTS "EvidenceUploadReview" (
  "id" TEXT PRIMARY KEY NOT NULL, "organizationId" TEXT NOT NULL, "caseId" TEXT NOT NULL,
  "category" TEXT NOT NULL, "userId" TEXT NOT NULL, "fingerprint" TEXT NOT NULL, "baseId" TEXT NOT NULL,
  "snapshotHash" TEXT NOT NULL, "analysisJson" TEXT NOT NULL CHECK(json_valid("analysisJson")), "modelCode" TEXT NOT NULL,
  "expiresAt" DATETIME NOT NULL, "consumedAt" DATETIME,
  FOREIGN KEY("caseId") REFERENCES "CaseItem"("id") ON DELETE RESTRICT,
  FOREIGN KEY("userId") REFERENCES "User"("id") ON DELETE RESTRICT
);
CREATE TABLE IF NOT EXISTS "EvidenceUploadLock" (
  "organizationId" TEXT NOT NULL, "caseId" TEXT NOT NULL, "category" TEXT NOT NULL,
  "id" TEXT NOT NULL UNIQUE, "userId" TEXT NOT NULL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY("organizationId","caseId","category"),
  FOREIGN KEY("caseId") REFERENCES "CaseItem"("id") ON DELETE RESTRICT,
  FOREIGN KEY("userId") REFERENCES "User"("id") ON DELETE RESTRICT
);
