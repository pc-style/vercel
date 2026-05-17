import { packageName } from '../../util/pkg-name';

export const accountsCommand = {
  name: 'accounts',
  aliases: [],
  description: 'Switch between saved Vercel accounts.',
  arguments: [],
  options: [],
  examples: [
    {
      name: 'Switch between saved Vercel accounts.',
      value: `${packageName} accounts`,
    },
  ],
} as const;
