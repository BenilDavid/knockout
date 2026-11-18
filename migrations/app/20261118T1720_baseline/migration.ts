#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/9e5c8e36fba19789563750276f6fe540118eb13b2b6e56f36760ee29d8184297/contract';
import endContract from '../../snapshots/9e5c8e36fba19789563750276f6fe540118eb13b2b6e56f36760ee29d8184297/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  col,
  fn,
  lit,
  primaryKey,
  sql,
} from '@prisma/orm-postgres/migration';

export default class M extends Migration<never, End> {
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createSchema({ schema: 'public' }),
      this.createTable({
        schema: 'public',
        table: 'account_sessions',
        columns: [
          col('createdAt', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('expiresAt', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('label', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('revoked', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('userId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'account_tokens',
        columns: [
          col('expiresAt', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('kind', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('used', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('userId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'accounts',
        columns: [
          col('createdAt', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('disabled', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('email', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('mfaEnabled', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('mfaLastStep', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('mfaPendingSecret', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('mfaSecret', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('notifications', 'bool', {
            notNull: true,
            default: lit(true),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('passwordHash', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('recoveryHashes', 'text', {
            notNull: true,
            default: lit('[]'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('role', 'text', {
            notNull: true,
            default: lit('participant'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('verified', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'ledger_entries',
        columns: [
          col('actorId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('availableDelta', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('createdAt', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('key', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('kind', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('reason', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('reservedDelta', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('walletId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'match_submissions',
        columns: [
          col('awayScore', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('createdAt', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('evidence', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('homeScore', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('matchId', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('response', 'text', {
            notNull: true,
            default: lit(''),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('status', 'text', {
            notNull: true,
            default: lit('pending'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('tournamentId', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('userId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'memberships',
        columns: [
          col('checkedIn', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('createdAt', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('kind', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('playerId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('role', 'text', {
            notNull: true,
            default: lit('participant'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('status', 'text', {
            notNull: true,
            default: lit('pending'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('tournamentId', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('userId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'players',
        columns: [
          col('document', 'jsonb', { notNull: true, codecRef: { codecId: 'pg/jsonb@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'prediction_markets',
        columns: [
          col('awayId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('homeId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('lockedAt', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('matchId', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('settledAt', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('stageId', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('state', 'text', {
            notNull: true,
            default: lit('open'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('tournamentId', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('winner', 'text', { codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'predictions',
        columns: [
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('marketId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('payout', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('side', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('stake', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('status', 'text', {
            notNull: true,
            default: lit('reserved'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('updatedAt', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('userId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'team_members',
        columns: [
          col('accepted', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('playerId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('role', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('userId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'tournaments',
        columns: [
          col('document', 'jsonb', { notNull: true, codecRef: { codecId: 'pg/jsonb@1' } }),
          col('id', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('revision', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('updatedAt', 'timestamp(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamp-date@1', typeParams: { precision: 3 } },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'wallets',
        columns: [
          col('available', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('reserved', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('tournamentId', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('userId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createIndex({
        schema: 'public',
        table: 'account_sessions',
        index: 'account_sessions_userId_idx',
        columns: ['userId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'account_tokens',
        index: 'account_tokens_userId_idx',
        columns: ['userId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'accounts',
        index: 'accounts_email_key',
        columns: ['email'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'ledger_entries',
        index: 'ledger_entries_key_key',
        columns: ['key'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'ledger_entries',
        index: 'ledger_entries_walletId_idx',
        columns: ['walletId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'match_submissions',
        index: 'match_submissions_tournamentId_matchId_idx',
        columns: ['tournamentId', 'matchId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'memberships',
        index: 'memberships_tournamentId_userId_key',
        columns: ['tournamentId', 'userId'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'prediction_markets',
        index: 'prediction_markets_tournamentId_stageId_matchId_key',
        columns: ['tournamentId', 'stageId', 'matchId'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'predictions',
        index: 'predictions_marketId_userId_key',
        columns: ['marketId', 'userId'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'team_members',
        index: 'team_members_playerId_userId_key',
        columns: ['playerId', 'userId'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'wallets',
        index: 'wallets_tournamentId_userId_key',
        columns: ['tournamentId', 'userId'],
        extras: { unique: true },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'account_sessions',
        foreignKey: {
          name: 'account_sessions_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'accounts', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'account_tokens',
        foreignKey: {
          name: 'account_tokens_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'accounts', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'ledger_entries',
        foreignKey: {
          name: 'ledger_entries_walletId_fkey',
          columns: ['walletId'],
          references: { schema: 'public', table: 'wallets', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'match_submissions',
        foreignKey: {
          name: 'match_submissions_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'accounts', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'match_submissions',
        foreignKey: {
          name: 'match_submissions_tournamentId_fkey',
          columns: ['tournamentId'],
          references: { schema: 'public', table: 'tournaments', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'memberships',
        foreignKey: {
          name: 'memberships_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'accounts', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'memberships',
        foreignKey: {
          name: 'memberships_tournamentId_fkey',
          columns: ['tournamentId'],
          references: { schema: 'public', table: 'tournaments', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'memberships',
        foreignKey: {
          name: 'memberships_playerId_fkey',
          columns: ['playerId'],
          references: { schema: 'public', table: 'players', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'prediction_markets',
        foreignKey: {
          name: 'prediction_markets_tournamentId_fkey',
          columns: ['tournamentId'],
          references: { schema: 'public', table: 'tournaments', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'predictions',
        foreignKey: {
          name: 'predictions_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'accounts', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'predictions',
        foreignKey: {
          name: 'predictions_marketId_fkey',
          columns: ['marketId'],
          references: { schema: 'public', table: 'prediction_markets', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'team_members',
        foreignKey: {
          name: 'team_members_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'accounts', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'team_members',
        foreignKey: {
          name: 'team_members_playerId_fkey',
          columns: ['playerId'],
          references: { schema: 'public', table: 'players', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'wallets',
        foreignKey: {
          name: 'wallets_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'accounts', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'wallets',
        foreignKey: {
          name: 'wallets_tournamentId_fkey',
          columns: ['tournamentId'],
          references: { schema: 'public', table: 'tournaments', columns: ['id'] },
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
