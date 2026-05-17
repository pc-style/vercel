import { packageName } from '../../util/pkg-name';

export const listSubcommand = {
  name: 'list',
  aliases: ['ls'],
  description: 'List locally-configured Vercel CLI accounts.',
  arguments: [],
  options: [
    {
      name: 'json',
      shorthand: null,
      type: Boolean,
      deprecated: false,
      description: 'Output the list of accounts as JSON.',
    },
  ],
  examples: [
    {
      name: 'List all locally-configured accounts',
      value: `${packageName} accounts list`,
    },
    {
      name: 'List accounts as JSON for scripting',
      value: `${packageName} accounts list --json`,
    },
  ],
} as const;

export const accountsCommand = {
  name: 'accounts',
  aliases: [],
  description: 'Manage and switch between saved Vercel accounts.',
  arguments: [],
  subcommands: [
    // Hidden placeholder so the help synopsis renders [command] as optional
    // (help.ts treats `command` as required unless a subcommand has `default: true`)
    {
      name: 'switch',
      aliases: [],
      description: '',
      default: true,
      hidden: true,
      arguments: [],
      options: [],
      examples: [],
    },
    listSubcommand,
  ],
  options: [],
  examples: [
    {
      name: 'Switch between saved Vercel accounts.',
      value: `${packageName} accounts`,
    },
    {
      name: 'List locally-configured accounts.',
      value: `${packageName} accounts list`,
    },
  ],
} as const;
