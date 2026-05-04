import { defineRelations } from "drizzle-orm";
import {
	auth_accounts,
	auth_invitations,
	auth_organization_members,
	auth_organizations,
	auth_passkeys,
	auth_sessions,
	auth_two_factors,
	auth_users,
	auth_verifications,
} from "./auth";

const schema = {
	auth_accounts,
	auth_invitations,
	auth_organization_members,
	auth_organizations,
	auth_passkeys,
	auth_sessions,
	auth_two_factors,
	auth_users,
	auth_verifications,
};

export const relations = defineRelations(schema, (r) => ({
	auth_users: {
		auth_sessionss: r.many.auth_sessions({
			from: r.auth_users.id,
			to: r.auth_sessions.userId,
		}),
		auth_accountss: r.many.auth_accounts({
			from: r.auth_users.id,
			to: r.auth_accounts.userId,
		}),
		auth_organization_memberss: r.many.auth_organization_members({
			from: r.auth_users.id,
			to: r.auth_organization_members.userId,
		}),
		auth_invitationss: r.many.auth_invitations({
			from: r.auth_users.id,
			to: r.auth_invitations.inviterId,
		}),
		auth_passkeyss: r.many.auth_passkeys({
			from: r.auth_users.id,
			to: r.auth_passkeys.userId,
		}),
		auth_two_factorss: r.many.auth_two_factors({
			from: r.auth_users.id,
			to: r.auth_two_factors.userId,
		}),
	},
	auth_passkeys: {
		auth_users: r.one.auth_users({
			from: r.auth_passkeys.userId,
			to: r.auth_users.id,
		}),
	},
	auth_two_factors: {
		auth_users: r.one.auth_users({
			from: r.auth_two_factors.userId,
			to: r.auth_users.id,
		}),
	},
	auth_sessions: {
		auth_users: r.one.auth_users({
			from: r.auth_sessions.userId,
			to: r.auth_users.id,
		}),
	},
	auth_accounts: {
		auth_users: r.one.auth_users({
			from: r.auth_accounts.userId,
			to: r.auth_users.id,
		}),
	},
	auth_organizations: {
		auth_organization_memberss: r.many.auth_organization_members({
			from: r.auth_organizations.id,
			to: r.auth_organization_members.organizationId,
		}),
		auth_invitationss: r.many.auth_invitations({
			from: r.auth_organizations.id,
			to: r.auth_invitations.organizationId,
		}),
	},
	auth_organization_members: {
		auth_organizations: r.one.auth_organizations({
			from: r.auth_organization_members.organizationId,
			to: r.auth_organizations.id,
		}),
		auth_users: r.one.auth_users({
			from: r.auth_organization_members.userId,
			to: r.auth_users.id,
		}),
	},
	auth_invitations: {
		auth_organizations: r.one.auth_organizations({
			from: r.auth_invitations.organizationId,
			to: r.auth_organizations.id,
		}),
		auth_users: r.one.auth_users({
			from: r.auth_invitations.inviterId,
			to: r.auth_users.id,
		}),
	},
}));
