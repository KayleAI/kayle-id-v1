-- ID-48 follow-up: drop the RFC 2142 email OTP method. Owner-side feedback
-- found the dual-method UX confusing, and DNS TXT is materially stronger
-- proof of control (an attacker who can read admin@ on a customer's domain
-- can already do plenty of damage; an attacker who can publish DNS records
-- on the apex effectively *is* the domain owner). Tightening the CHECK
-- constraint here makes "email_otp" unrepresentable, which is the cleanest
-- way to keep the application code from re-introducing it by accident.

DELETE FROM "auth_organization_domain_challenges" WHERE "method" = 'email_otp';
--> statement-breakpoint
DELETE FROM "auth_organization_verified_domains" WHERE "verified_via" = 'email_otp';
--> statement-breakpoint
ALTER TABLE "auth_organization_verified_domains"
	DROP CONSTRAINT IF EXISTS "auth_organization_verified_domains_verified_via_check";
--> statement-breakpoint
ALTER TABLE "auth_organization_verified_domains"
	ADD CONSTRAINT "auth_organization_verified_domains_verified_via_check"
	CHECK ("verified_via" IN ('dns_txt'));
--> statement-breakpoint
ALTER TABLE "auth_organization_domain_challenges"
	DROP CONSTRAINT IF EXISTS "auth_organization_domain_challenges_method_check";
--> statement-breakpoint
ALTER TABLE "auth_organization_domain_challenges"
	ADD CONSTRAINT "auth_organization_domain_challenges_method_check"
	CHECK ("method" IN ('dns_txt'));
