import output from '../../output-manager';
import type Client from '../../util/client';
import { printError } from '../../util/error';
import { getFlagsSpecification } from '../../util/get-flags-specification';
import { parseArguments } from '../../util/get-args';
import getSubcommand from '../../util/get-subcommand';
import { type Command, help } from '../help';
import { accountsCommand, listSubcommand } from './command';
import {
  applyActiveAccount,
  getActiveAccountLabel,
  getAuthAccountLabels,
  getMultiAccountAuthConfig,
} from '../../util/auth-accounts';
import { AccountsTelemetryClient } from '../../util/telemetry/commands/accounts';
import { getCommandAliases } from '..';
import list from './list';

const COMMAND_CONFIG = {
  list: getCommandAliases(listSubcommand),
};

export default async function accounts(client: Client): Promise<number> {
  const telemetry = new AccountsTelemetryClient({
    opts: {
      store: client.telemetryEventStore,
    },
  });

  let parsedArgs;
  const flagsSpecification = getFlagsSpecification(accountsCommand.options);

  try {
    parsedArgs = parseArguments(client.argv.slice(2), flagsSpecification, {
      permissive: true,
    });
  } catch (error) {
    printError(error);
    return 1;
  }

  const { subcommand, args, subcommandOriginal } = getSubcommand(
    parsedArgs.args.slice(1),
    COMMAND_CONFIG
  );

  const needHelp = parsedArgs.flags['--help'];

  function printHelp(command: Command) {
    output.print(
      help(command, { parent: accountsCommand, columns: client.stderr.columns })
    );
  }

  if (subcommand === 'list') {
    if (needHelp) {
      telemetry.trackCliFlagHelp('accounts', subcommandOriginal);
      printHelp(listSubcommand);
      return 2;
    }
    telemetry.trackCliSubcommandList(subcommandOriginal);
    return list(client, args);
  }

  if (!subcommand && args.length > 0) {
    output.error(`Unknown argument or option: ${args[0]}`);
    return 1;
  }

  if (needHelp) {
    telemetry.trackCliFlagHelp('accounts');
    output.print(help(accountsCommand, { columns: client.stderr.columns }));
    return 2;
  }

  // Default behavior: interactive account switcher.
  const accountLabels = getAuthAccountLabels(client.authConfig);
  if (accountLabels.length === 0) {
    output.error('No saved accounts found. Run `vercel login` to add one.');
    return 1;
  }

  if (client.nonInteractive) {
    output.error('Cannot switch accounts in non-interactive mode.');
    return 1;
  }

  const activeAccount = getActiveAccountLabel(client.authConfig);
  const selectedAccount = await client.input.select({
    message: 'Select an account:',
    choices: accountLabels.map(label => ({
      name: activeAccount === label ? `${label} (active)` : label,
      value: label,
    })),
  });

  client.authConfig = applyActiveAccount({
    ...getMultiAccountAuthConfig(client.authConfig),
    activeAccount: selectedAccount,
  });
  client.writeToAuthConfigFile();

  output.log(`Switched to ${selectedAccount}`);
  return 0;
}
