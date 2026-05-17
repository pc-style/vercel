import output from '../../output-manager';
import type Client from '../../util/client';
import { printError } from '../../util/error';
import { getFlagsSpecification } from '../../util/get-flags-specification';
import { parseArguments } from '../../util/get-args';
import { help } from '../help';
import { accountsCommand } from './command';
import {
  applyActiveAccount,
  getActiveAccountLabel,
  getAuthAccountLabels,
  getMultiAccountAuthConfig,
} from '../../util/auth-accounts';

export default async function accounts(client: Client): Promise<number> {
  let parsedArgs;
  const flagsSpecification = getFlagsSpecification(accountsCommand.options);

  try {
    parsedArgs = parseArguments(client.argv.slice(2), flagsSpecification);
  } catch (error) {
    printError(error);
    return 1;
  }

  if (parsedArgs.flags['--help']) {
    output.print(help(accountsCommand, { columns: client.stderr.columns }));
    return 0;
  }

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
