-- Account lockout fields
ALTER TABLE "User" ADD COLUMN "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "lockedUntil" TIMESTAMP(3);

-- Authorization code single-use enforcement
ALTER TABLE "OAuthAuthorizationCode" ADD COLUMN "used" BOOLEAN NOT NULL DEFAULT false;
