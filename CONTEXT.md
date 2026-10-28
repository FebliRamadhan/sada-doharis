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

**Password LDAP** — The secret an INTERNAL user types at login. It lives in, and is owned by, the directory (Zimbra's LDAP), whose own password rules apply to it; SADA verifies it against the directory and may change it on the user's behalf, but never stores it. Distinct from a local password, which no active User holds.

**Masa Berlaku Password** — The 90 days an INTERNAL user's Password LDAP stays valid, counted from its last change. The last change is the later of what the directory records and what SADA saw happen through itself, so a change made elsewhere counts too. Users with no known change date at go-live start counting from go-live. From day 76 the user is warned and may change it early; when the period runs out, login is blocked (after both factors are proven) until the Password LDAP is changed through SADA. There is no grace period. The period is SADA's rule, enforced only on logins through SADA; the directory itself does not expire the Password LDAP sooner (at most a longer safety-net limit).

**Wajibkan Ganti Password** — An admin action that ends a user's Masa Berlaku Password immediately and revokes their active sessions, so their next login hits the forced change. The admin never sees or sets the Password LDAP; the directory is untouched until the user changes it themselves.
