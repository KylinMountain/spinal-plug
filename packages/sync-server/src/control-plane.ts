import { createHash, randomBytes, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type {
  Account,
  AuthenticatedPrincipal,
  DeviceCredential,
  MemoryCompilation,
  ProjectSnapshot,
  ProjectSpace,
  RegisteredDevice,
  SpaceMembership,
  SpaceRole,
  SyncPullRequest,
  SyncPullResponse,
  SyncPushRequest,
  SyncPushResponse
} from "@mind-palace/protocol";
import { PersistentSyncServer } from "./persistent-server.js";

const controlPlaneSchema = `
CREATE TABLE IF NOT EXISTS control_accounts (
  account_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS control_users (
  user_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  account_role TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(account_id, email),
  FOREIGN KEY(account_id) REFERENCES control_accounts(account_id)
);

CREATE TABLE IF NOT EXISTS control_devices (
  device_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT,
  revoked_at TEXT,
  FOREIGN KEY(account_id) REFERENCES control_accounts(account_id),
  FOREIGN KEY(user_id) REFERENCES control_users(user_id)
);
CREATE INDEX IF NOT EXISTS idx_control_devices_account
  ON control_devices(account_id, status);

CREATE TABLE IF NOT EXISTS control_spaces (
  space_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  type TEXT NOT NULL,
  display_name TEXT NOT NULL,
  repository_json TEXT,
  metadata_json TEXT,
  created_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(account_id) REFERENCES control_accounts(account_id),
  FOREIGN KEY(created_by_user_id) REFERENCES control_users(user_id)
);
CREATE INDEX IF NOT EXISTS idx_control_spaces_account
  ON control_spaces(account_id, display_name);

CREATE TABLE IF NOT EXISTS control_space_members (
  space_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(space_id, user_id),
  FOREIGN KEY(space_id) REFERENCES control_spaces(space_id),
  FOREIGN KEY(user_id) REFERENCES control_users(user_id)
);
`;

const ROLE_LEVEL: Record<SpaceRole, number> = {
  viewer: 1,
  editor: 2,
  owner: 3
};

function now(): string {
  return new Date().toISOString();
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function createToken(): string {
  return `mpd_${randomBytes(32).toString("base64url")}`;
}

function parseDevice(row: Record<string, unknown>): RegisteredDevice {
  return {
    deviceId: String(row.device_id),
    accountId: String(row.account_id),
    userId: String(row.user_id),
    displayName: String(row.display_name),
    status: row.status as RegisteredDevice["status"],
    createdAt: String(row.created_at),
    lastSeenAt: row.last_seen_at ? String(row.last_seen_at) : undefined,
    revokedAt: row.revoked_at ? String(row.revoked_at) : undefined
  };
}

export class ControlPlaneError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string
  ) {
    super(message);
  }
}

export interface ProvisionAccountInput {
  accountName: string;
  ownerEmail: string;
  ownerName: string;
  deviceName: string;
}

export interface ProvisionAccountResult {
  account: Account;
  userId: string;
  credential: DeviceCredential;
}

/**
 * Account, device and Space authorization boundary around the event store.
 * Tokens are returned once; only their SHA-256 digest is persisted.
 */
export class MindPalaceControlPlane {
  private readonly database: DatabaseSync;
  private readonly sync: PersistentSyncServer;

  constructor(databasePath: string) {
    this.database = new DatabaseSync(databasePath);
    this.database.exec("PRAGMA journal_mode = WAL;");
    this.database.exec("PRAGMA foreign_keys = ON;");
    this.database.exec(controlPlaneSchema);
    this.sync = new PersistentSyncServer(databasePath);
  }

  provisionAccount(input: ProvisionAccountInput): ProvisionAccountResult {
    const createdAt = now();
    const account: Account = {
      accountId: `acc_${randomUUID()}`,
      displayName: input.accountName.trim(),
      createdAt
    };
    const userId = `usr_${randomUUID()}`;
    const token = createToken();
    const deviceId = `dev_${randomUUID()}`;
    try {
      this.database.exec("BEGIN IMMEDIATE TRANSACTION;");
      this.database.prepare(`
        INSERT INTO control_accounts (account_id, display_name, created_at)
        VALUES (?, ?, ?)
      `).run(account.accountId, account.displayName, createdAt);
      this.database.prepare(`
        INSERT INTO control_users (
          user_id, account_id, email, display_name, account_role, created_at
        ) VALUES (?, ?, ?, ?, 'owner', ?)
      `).run(userId, account.accountId, input.ownerEmail.trim().toLowerCase(), input.ownerName.trim(), createdAt);
      this.database.prepare(`
        INSERT INTO control_devices (
          device_id, account_id, user_id, display_name, token_hash, status, created_at
        ) VALUES (?, ?, ?, ?, ?, 'active', ?)
      `).run(deviceId, account.accountId, userId, input.deviceName.trim(), tokenHash(token), createdAt);
      this.database.exec("COMMIT;");
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }
    return {
      account,
      userId,
      credential: {
        token,
        device: {
          deviceId,
          accountId: account.accountId,
          userId,
          displayName: input.deviceName.trim(),
          status: "active",
          createdAt
        }
      }
    };
  }

  authenticate(token: string): AuthenticatedPrincipal {
    const row = this.database.prepare(`
      SELECT device_id, account_id, user_id, status
      FROM control_devices WHERE token_hash = ? LIMIT 1
    `).get(tokenHash(token)) as Record<string, unknown> | undefined;
    if (!row) throw new ControlPlaneError("Invalid device credential.", 401, "invalid_token");
    if (row.status !== "active") {
      throw new ControlPlaneError("Device credential has been revoked.", 401, "device_revoked");
    }
    const principal: AuthenticatedPrincipal = {
      accountId: String(row.account_id),
      userId: String(row.user_id),
      deviceId: String(row.device_id),
      deviceStatus: "active"
    };
    this.database.prepare(
      "UPDATE control_devices SET last_seen_at = ? WHERE device_id = ?"
    ).run(now(), principal.deviceId);
    return principal;
  }

  createUser(
    principal: AuthenticatedPrincipal,
    input: { email: string; displayName: string }
  ): string {
    this.requireAccountOwner(principal);
    const userId = `usr_${randomUUID()}`;
    this.database.prepare(`
      INSERT INTO control_users (
        user_id, account_id, email, display_name, account_role, created_at
      ) VALUES (?, ?, ?, ?, 'member', ?)
    `).run(
      userId,
      principal.accountId,
      input.email.trim().toLowerCase(),
      input.displayName.trim(),
      now()
    );
    return userId;
  }

  registerDevice(
    principal: AuthenticatedPrincipal,
    displayName: string,
    userId = principal.userId
  ): DeviceCredential {
    if (userId !== principal.userId) this.requireAccountOwner(principal);
    this.requireUserInAccount(userId, principal.accountId);
    const deviceId = `dev_${randomUUID()}`;
    const createdAt = now();
    const token = createToken();
    this.database.prepare(`
      INSERT INTO control_devices (
        device_id, account_id, user_id, display_name, token_hash, status, created_at
      ) VALUES (?, ?, ?, ?, ?, 'active', ?)
    `).run(
      deviceId,
      principal.accountId,
      userId,
      displayName.trim(),
      tokenHash(token),
      createdAt
    );
    return {
      token,
      device: {
        deviceId,
        accountId: principal.accountId,
        userId,
        displayName: displayName.trim(),
        status: "active",
        createdAt
      }
    };
  }

  revokeDevice(principal: AuthenticatedPrincipal, deviceId: string): void {
    if (deviceId !== principal.deviceId) this.requireAccountOwner(principal);
    const result = this.database.prepare(`
      UPDATE control_devices SET status = 'revoked', revoked_at = ?
      WHERE device_id = ? AND account_id = ? AND status = 'active'
    `).run(now(), deviceId, principal.accountId);
    if (Number(result.changes) === 0) {
      throw new ControlPlaneError("Active device not found.", 404, "device_not_found");
    }
  }

  listDevices(principal: AuthenticatedPrincipal): RegisteredDevice[] {
    return (this.database.prepare(`
      SELECT * FROM control_devices
      WHERE account_id = ? ORDER BY created_at ASC
    `).all(principal.accountId) as Record<string, unknown>[]).map(parseDevice);
  }

  createSpace(
    principal: AuthenticatedPrincipal,
    input: Omit<ProjectSpace, "schema">
  ): ProjectSpace {
    const space: ProjectSpace = {
      schema: "mind-palace.project-space/v0.1",
      ...input
    };
    const createdAt = now();
    this.database.prepare(`
      INSERT INTO control_spaces (
        space_id, account_id, type, display_name, repository_json,
        metadata_json, created_by_user_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      space.spaceId,
      principal.accountId,
      space.type,
      space.displayName,
      space.repository ? JSON.stringify(space.repository) : null,
      space.metadata ? JSON.stringify(space.metadata) : null,
      principal.userId,
      createdAt
    );
    this.database.prepare(`
      INSERT INTO control_space_members (space_id, user_id, role, created_at)
      VALUES (?, ?, 'owner', ?)
    `).run(space.spaceId, principal.userId, createdAt);
    return space;
  }

  listSpaces(principal: AuthenticatedPrincipal): Array<ProjectSpace & { role: SpaceRole }> {
    const rows = this.database.prepare(`
      SELECT s.*, m.role
      FROM control_spaces s
      JOIN control_space_members m ON m.space_id = s.space_id
      WHERE s.account_id = ? AND m.user_id = ?
      ORDER BY s.display_name ASC
    `).all(principal.accountId, principal.userId) as Record<string, unknown>[];
    return rows.map(row => ({
      schema: "mind-palace.project-space/v0.1",
      spaceId: String(row.space_id),
      type: row.type as ProjectSpace["type"],
      displayName: String(row.display_name),
      repository: row.repository_json
        ? JSON.parse(String(row.repository_json)) as ProjectSpace["repository"]
        : undefined,
      metadata: row.metadata_json
        ? JSON.parse(String(row.metadata_json)) as Record<string, string>
        : undefined,
      role: row.role as SpaceRole
    }));
  }

  setSpaceMember(
    principal: AuthenticatedPrincipal,
    spaceId: string,
    userId: string,
    role: SpaceRole
  ): SpaceMembership {
    this.authorizeSpace(principal, spaceId, "owner");
    this.requireUserInAccount(userId, principal.accountId);
    const createdAt = now();
    this.database.prepare(`
      INSERT INTO control_space_members (space_id, user_id, role, created_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(space_id, user_id) DO UPDATE SET role = excluded.role
    `).run(spaceId, userId, role, createdAt);
    return { spaceId, userId, role, createdAt };
  }

  async push(
    principal: AuthenticatedPrincipal,
    request: SyncPushRequest
  ): Promise<SyncPushResponse> {
    this.requireDevice(principal, request.deviceId);
    this.authorizeSpace(principal, request.spaceId, "editor");
    for (const event of request.events) {
      if (event.accountId !== principal.accountId) {
        throw new ControlPlaneError("Event account does not match credential.", 403, "account_mismatch");
      }
      if (event.actor.deviceId !== principal.deviceId) {
        throw new ControlPlaneError("Event device does not match credential.", 403, "device_mismatch");
      }
    }
    return this.sync.push(request);
  }

  async pull(
    principal: AuthenticatedPrincipal,
    request: SyncPullRequest
  ): Promise<SyncPullResponse> {
    this.requireDevice(principal, request.deviceId);
    this.authorizeSpace(principal, request.spaceId, "viewer");
    return this.sync.pull(request);
  }

  snapshot(principal: AuthenticatedPrincipal, spaceId: string): ProjectSnapshot {
    this.authorizeSpace(principal, spaceId, "viewer");
    return this.sync.snapshot(spaceId);
  }

  compilation(principal: AuthenticatedPrincipal, spaceId: string): MemoryCompilation {
    this.authorizeSpace(principal, spaceId, "viewer");
    return this.sync.compilation(spaceId);
  }

  close(): void {
    this.sync.close();
    this.database.close();
  }

  private requireDevice(principal: AuthenticatedPrincipal, deviceId: string): void {
    if (principal.deviceId !== deviceId) {
      throw new ControlPlaneError("Request device does not match credential.", 403, "device_mismatch");
    }
  }

  private authorizeSpace(
    principal: AuthenticatedPrincipal,
    spaceId: string,
    requiredRole: SpaceRole
  ): void {
    const row = this.database.prepare(`
      SELECT s.account_id, m.role
      FROM control_spaces s
      LEFT JOIN control_space_members m
        ON m.space_id = s.space_id AND m.user_id = ?
      WHERE s.space_id = ?
      LIMIT 1
    `).get(principal.userId, spaceId) as Record<string, unknown> | undefined;
    if (!row || row.account_id !== principal.accountId) {
      throw new ControlPlaneError("Project Space not found.", 404, "space_not_found");
    }
    const actualRole = row.role as SpaceRole | undefined;
    if (!actualRole || ROLE_LEVEL[actualRole] < ROLE_LEVEL[requiredRole]) {
      throw new ControlPlaneError("Project Space permission denied.", 403, "space_forbidden");
    }
  }

  private requireAccountOwner(principal: AuthenticatedPrincipal): void {
    const row = this.database.prepare(
      "SELECT account_role FROM control_users WHERE user_id = ? AND account_id = ?"
    ).get(principal.userId, principal.accountId) as Record<string, unknown> | undefined;
    if (row?.account_role !== "owner") {
      throw new ControlPlaneError("Account owner permission required.", 403, "owner_required");
    }
  }

  private requireUserInAccount(userId: string, accountId: string): void {
    const row = this.database.prepare(
      "SELECT 1 FROM control_users WHERE user_id = ? AND account_id = ?"
    ).get(userId, accountId);
    if (!row) throw new ControlPlaneError("User not found.", 404, "user_not_found");
  }
}
