-- CreateEnum
CREATE TYPE "LdapDirectory" AS ENUM ('PRIMARY', 'SECONDARY');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "ldapDirectory" "LdapDirectory";

-- Sebelum fitur ini hanya ada satu direktori: semua user LDAP terikat ke PRIMARY.
UPDATE "User" SET "ldapDirectory" = 'PRIMARY' WHERE "provider" = 'ldap' OR "ldapDn" IS NOT NULL;
