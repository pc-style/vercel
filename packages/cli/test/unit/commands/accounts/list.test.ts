import { describe, beforeEach, expect, it } from 'vitest';
import { client } from '../../../mocks/client';
import accounts from '../../../../src/commands/accounts';

describe('accounts list', () => {
  beforeEach(() => {
    client.reset();
  });

  it('lists the locally-configured accounts as a table', async () => {
    client.authConfig = {
      token: 'token_work',
      skipWrite: true,
      accounts: {
        personal: {
          token: 'token_personal',
          email: 'personal@example.com',
          userId: 'u_personal',
        },
        work: {
          token: 'token_work',
          email: 'work@example.com',
          userId: 'u_work',
        },
      },
      activeAccount: 'work',
    } as any;
    client.config = { currentTeam: 'team_alpha' };

    client.setArgv('accounts', 'list');
    const exitCode = await accounts(client);

    expect(exitCode).toBe(0);

    const out = (client.stdout as any).getFullOutput() as string;
    expect(out).toContain('email');
    expect(out).toContain('team');
    expect(out).toContain('active');
    expect(out).toContain('personal@example.com');
    expect(out).toContain('work@example.com');
    // currentTeam should appear next to the active row
    expect(out).toContain('team_alpha');
    expect(out).toMatch(/yes/);

    await expect(client.stderr).toOutput('Found 2 accounts.');
  });

  it('supports the `ls` alias', async () => {
    client.authConfig = {
      token: 'token_work',
      skipWrite: true,
      accounts: {
        work: {
          token: 'token_work',
          email: 'work@example.com',
          userId: 'u_work',
        },
      },
      activeAccount: 'work',
    } as any;

    client.setArgv('accounts', 'ls');
    const exitCode = await accounts(client);

    expect(exitCode).toBe(0);

    expect(client.telemetryEventStore).toHaveTelemetryEvents([
      {
        key: 'subcommand:list',
        value: 'ls',
      },
    ]);
  });

  it('emits valid JSON when --json is set', async () => {
    client.authConfig = {
      token: 'token_work',
      skipWrite: true,
      accounts: {
        personal: {
          token: 'token_personal',
          email: 'personal@example.com',
          userId: 'u_personal',
        },
        work: {
          token: 'token_work',
          email: 'work@example.com',
          userId: 'u_work',
        },
      },
      activeAccount: 'work',
    } as any;
    client.config = { currentTeam: 'team_alpha' };

    client.setArgv('accounts', 'list', '--json');
    const exitCode = await accounts(client);

    expect(exitCode).toBe(0);

    const out = (client.stdout as any).getFullOutput() as string;
    const parsed = JSON.parse(out);
    expect(parsed.activeAccount).toBe('work');
    expect(Array.isArray(parsed.accounts)).toBe(true);
    expect(parsed.accounts).toHaveLength(2);

    const work = parsed.accounts.find((a: any) => a.label === 'work');
    expect(work).toBeDefined();
    expect(work.email).toBe('work@example.com');
    expect(work.active).toBe(true);
    expect(work.team).toBe('team_alpha');

    const personal = parsed.accounts.find((a: any) => a.label === 'personal');
    expect(personal.active).toBe(false);
    expect(personal.team).toBeNull();

    expect(client.telemetryEventStore).toHaveTelemetryEvents([
      {
        key: 'subcommand:list',
        value: 'list',
      },
      {
        key: 'flag:json',
        value: 'TRUE',
      },
    ]);
  });

  it('falls back to a single-row list when no `accounts` map exists', async () => {
    client.authConfig = {
      token: 'token_dummy',
      skipWrite: true,
      userId: 'u_solo',
    } as any;
    client.config = { currentTeam: 'team_solo' };

    client.setArgv('accounts', 'list', '--json');
    const exitCode = await accounts(client);

    expect(exitCode).toBe(0);

    const out = (client.stdout as any).getFullOutput() as string;
    const parsed = JSON.parse(out);
    expect(parsed.accounts).toHaveLength(1);
    expect(parsed.accounts[0].active).toBe(true);
    expect(parsed.accounts[0].userId).toBe('u_solo');
    expect(parsed.accounts[0].team).toBe('team_solo');
    expect(parsed.activeAccount).toBeNull();
  });
});
