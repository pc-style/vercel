import chalk from 'chalk';
import type Client from '../../util/client';
import { printError } from '../../util/error';
import { parseArguments } from '../../util/get-args';
import { getFlagsSpecification } from '../../util/get-flags-specification';
import output from '../../output-manager';
import table from '../../util/output/table';
import { getMultiAccountAuthConfig } from '../../util/auth-accounts';
import { AccountsTelemetryClient } from '../../util/telemetry/commands/accounts';
import { listSubcommand } from './command';

interface AccountRow {
  label: string | null;
  email: string | null;
  userId: string | null;
  team: string | null;
  active: boolean;
  tokenSource: string | null;
}

export default async function list(
  client: Client,
  argv: string[]
): Promise<number> {
  const telemetry = new AccountsTelemetryClient({
    opts: {
      store: client.telemetryEventStore,
    },
  });

  let parsedArgs;
  const flagsSpecification = getFlagsSpecification(listSubcommand.options);

  try {
    parsedArgs = parseArguments(argv, flagsSpecification);
  } catch (err) {
    printError(err);
    return 1;
  }

  const asJson = parsedArgs.flags['--json'] === true;
  telemetry.trackCliFlagJson(asJson);

  try {
    const { authConfig } = client;
    const multi = getMultiAccountAuthConfig(authConfig);
    const currentTeam = client.config?.currentTeam ?? null;
    const accountEntries = multi.accounts
      ? Object.entries(multi.accounts).sort(([a], [b]) => a.localeCompare(b))
      : [];

    let rows: AccountRow[] = [];
    let activeLabel: string | null = null;

    if (accountEntries.length > 0) {
      activeLabel =
        multi.activeAccount && multi.accounts?.[multi.activeAccount]
          ? multi.activeAccount
          : null;

      rows = accountEntries.map(([label, account]) => {
        const isActive = label === activeLabel;
        return {
          label,
          email: account.email ?? null,
          userId: account.userId ?? null,
          team: isActive ? currentTeam : null,
          active: isActive,
          tokenSource: isActive ? (multi.tokenSource ?? null) : null,
        };
      });
    } else if (authConfig.token) {
      // Single-account fallback: no `accounts` map yet, but a token is configured.
      rows = [
        {
          label: null,
          email: null,
          userId: authConfig.userId ?? null,
          team: currentTeam,
          active: true,
          tokenSource: authConfig.tokenSource ?? null,
        },
      ];
    }

    if (asJson) {
      output.stopSpinner();
      client.stdout.write(
        `${JSON.stringify(
          {
            accounts: rows,
            activeAccount: activeLabel,
          },
          null,
          2
        )}\n`
      );
      return 0;
    }

    if (rows.length === 0) {
      output.log(
        'No accounts found. Run `vercel login` to authenticate the CLI.'
      );
      return 0;
    }

    output.log(`Found ${rows.length} account${rows.length === 1 ? '' : 's'}.`);

    const header = ['email', 'team', 'active'].map(h => chalk.gray(h));
    const body = rows.map(row => [
      row.email ?? row.label ?? row.userId ?? chalk.gray('(unknown)'),
      row.team ?? chalk.gray('–'),
      row.active ? chalk.green('yes') : '',
    ]);

    const rendered = table([header, ...body], {
      align: ['l', 'l', 'c'],
      hsep: 4,
    });
    client.stdout.write(`${rendered}\n`);

    return 0;
  } catch (err) {
    printError(err);
    return 1;
  }
}
