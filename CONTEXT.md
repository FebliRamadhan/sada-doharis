# Context: SADA SSO

Glossary of the ubiquitous language for the PANRB SSO / OAuth2 authorization server.

## Terms

**Pegawai** — An internal employee of Kementerian PANRB, sourced from the read-only HR master data (MySQL). Identified canonically by NIP. Not every User is a Pegawai; only INTERNAL users can be resolved to one, by office or personal email.

**NIP** — Nomor Induk Pegawai, the government-wide employee identifier. Distinct from the LDAP uid (which is a login name, never a NIP).

**Jabatan** — The employee's position title (e.g. "Pranata Komputer Terampil"). A property of the unit-staf slot the employee occupies, not of the employee record itself.

**Unit Kerja** — The organizational unit an employee belongs to (e.g. "Biro Data dan Teknologi Informasi"). Resolved from the employee's unit-staf slot; when the slot itself carries no unit name, the parent slot's identity is used.

**Unit Staf** — A position slot in the organizational hierarchy. Slots form a tree via parent links; an employee occupies exactly one slot.

**Scope `pegawai`** — OAuth2 scope granting clients access to employee claims (pegawai_id, nip, fullname, jabatan, unit_kerja) in the UserInfo response. Only yields claims for INTERNAL users; for other user types the scope is inert.

**User types** — INTERNAL (PANRB employees, authenticate via LDAP), GOVERNMENT (ASN from other agencies, via SPLP SSO), EXTERNAL (everyone who is neither of those). EXTERNAL is also the type a User falls back to when nothing else is asserted, so a User being EXTERNAL is *not* evidence of who they are — an employee who first arrived by some route other than LDAP stays EXTERNAL even after authenticating as an employee. Read it as "unclassified", not as "member of the public".

**Pendaftaran Mandiri** — Self-registration: someone creating a User for themselves with an email and a password of their choosing, with no directory backing it, no email verification, and no approval. It is not a sanctioned way into SADA SSO; the sanctioned routes are LDAP for INTERNAL and SPLP for GOVERNMENT. Distinct from social login, which is also self-initiated but at least binds the User to an identity a provider vouches for.

**MFA** — TOTP-based second factor for user login, with single-use backup codes. A property of the User (auth identity), not the Pegawai (HR record). Its reach is defined by user type, not by choice: INTERNAL users are required to enrol, and everyone else is outside its scope entirely — there is no way for a non-INTERNAL User to hold a second factor. A User whose type is wrong is therefore also outside MFA, whatever their real employment.
