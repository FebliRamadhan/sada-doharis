# Context: SADA SSO

Glossary of the ubiquitous language for the PANRB SSO / OAuth2 authorization server.

## Terms

**Pegawai** — An internal employee of Kementerian PANRB, sourced from the read-only HR master data (MySQL). Identified canonically by NIP. Not every User is a Pegawai; only INTERNAL users can be resolved to one, by office or personal email.

**NIP** — Nomor Induk Pegawai, the government-wide employee identifier. Distinct from the LDAP uid (which is a login name, never a NIP).

**Jabatan** — The employee's position title (e.g. "Pranata Komputer Terampil"). A property of the unit-staf slot the employee occupies, not of the employee record itself.

**Unit Kerja** — The organizational unit an employee belongs to (e.g. "Biro Data dan Teknologi Informasi"). Resolved from the employee's unit-staf slot; when the slot itself carries no unit name, the parent slot's identity is used.

**Unit Staf** — A position slot in the organizational hierarchy. Slots form a tree via parent links; an employee occupies exactly one slot.

**Scope `pegawai`** — OAuth2 scope granting clients access to employee claims (pegawai_id, nip, fullname, jabatan, unit_kerja) in the UserInfo response. Only yields claims for INTERNAL users; for other user types the scope is inert.

**User types** — INTERNAL (PANRB employees, authenticate via LDAP), GOVERNMENT (ASN from other agencies, via SPLP SSO), EXTERNAL (the public, via Google/Facebook).

**MFA** — Optional TOTP-based second factor for user login, with single-use backup codes. A property of the User (auth identity), not the Pegawai (HR record).
